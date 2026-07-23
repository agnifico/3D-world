// Grassland World — input, character control, camera. Owns the `char` group
// and the character state machine: GROUND (idle/walk/run/wade), AIRBORNE
// (jump/dive/leap), SWIM, RIDING(boat), EMOTE, STEP_OUT.
import * as THREE from 'three';
import { terrainHeight, groundHeight } from './world.js';
import { boats, interactables, updateBoat, setBoardHandler } from './boats.js';
import { CHARACTERS, CHARACTER, loadCharacter } from './character.js';
import { BIOME, modeKey } from './lighting.js';
import { isGalleryOpen } from './gallery.js';
import * as A from './assets.js';

export function initController(scene, animated, opts) {
  const { canvas, spawnRipple, spawnSplash, sfxSplash, sfxStep, sfxJump, sfxBoard, onToggleGallery } = opts;

  const char = new THREE.Group();
  char.position.set(25, terrainHeight(25, 37), 37);
  const placeholder = A.createCharacter();
  char.add(placeholder);
  scene.add(char);

  const clips = {};
  let locomotion = null;

  loadCharacter(CHARACTER).then(result => {
    if (!result) return;
    char.remove(placeholder);
    char.add(result.model);
    Object.assign(clips, result.clips);
    locomotion = result.locomotion;
    if (clips.idle) locomotion.setState('idle');
    window.__setState = n => locomotion.setState(n); // console/debug hook
    window.__clips = clips; window.__model = result.model; window.__mixer = result.mixer; // console/debug hooks
    // one-shot clips (jump, dive, hopOut) hand control back to whatever state
    // they belong to — only AIRBORNE and STEP_OUT ever play one, so only they
    // define onClipFinished; every other state's finish is a no-op.
    result.mixer.addEventListener('finished', () => { STATES[state.name].onClipFinished?.(); });
  }).catch(e => console.warn(`[character] ${CHARACTER} model failed, using placeholder:`, e.message));

  if (BIOME.lantern) {
    const lamp = new THREE.PointLight(0xffc37a, 30, 22, 1.8);
    lamp.position.y = 2.2;
    char.add(lamp);
  }

  const keys = {};
  let heading = 0, groundY = 0, waterDepth = 0, curRunning = false, curMoving = false;
  let activeInteract = null;
  // swim tuning: depth = water surface (WATER_Y) minus the ground/bed under the character
  const GRAV = 20, SWIM_DEPTH = 1.2, SWIM_SINK = 1.05, WADE_START = 0.45, DIVE_TRIGGER = 0.6, DIVE_FWD = 6.0;
  const WATER_Y = -0.9;
  let stepSfxT = 0, rippleT = 0; // footstep-SFX / water-ripple cadence timers

  // ================= character state machine =================
  // Each state: enter(params), update(dt) [vertical/physics only — WASD
  // movement itself is shared across every non-riding state below, since the
  // original allowed air control / in-place drift during AIRBORNE and
  // STEP_OUT too], exit(), and (for AIRBORNE/STEP_OUT) onClipFinished().
  let state = { name: 'GROUND', impulseT: 0 };
  function transition(name, params = {}) {
    STATES[state.name].exit?.(state);
    state = { name, ...params };
    STATES[name].enter?.(params);
  }
  // true while the current state's locomotion pose should read as "swimming"
  // pace/SFX — GROUND/AIRBORNE never do; SWIM always does; STEP_OUT tracks its
  // own copy (set at disembark time, can still flip via the hysteresis below).
  function isSwimNow() { return state.name === 'SWIM' || (state.name === 'STEP_OUT' && state.swimming); }

  const STATES = {
    GROUND: {
      enter(p) { state.impulseT = p.impulseT ?? 0; },
      update(dt) {
        const support = groundHeight(char.position.x, char.position.z);
        if (waterDepth > SWIM_DEPTH) { const carry = state.impulseT; transition('SWIM', { impulseT: carry }); }
        const restY = state.name === 'SWIM' ? (WATER_Y - SWIM_SINK) : support;
        groundY += (restY - groundY) * Math.min(1, dt * 14);
        char.position.y = groundY;
      },
      exit() {},
    },
    SWIM: {
      enter(p) { state.impulseT = p.impulseT ?? 0; },
      update(dt) {
        const support = groundHeight(char.position.x, char.position.z);
        if (waterDepth < SWIM_DEPTH - 0.3) { const carry = state.impulseT; transition('GROUND', { impulseT: carry }); }
        const restY = state.name === 'SWIM' ? (WATER_Y - SWIM_SINK) : support;
        groundY += (restY - groundY) * Math.min(1, dt * 14);
        char.position.y = groundY;
      },
      exit() {},
    },
    AIRBORNE: {
      enter(p) {
        state.kind = p.kind; state.vy = p.vy; state.airFwd = p.airFwd || 0; state.queueImpulse = !!p.queueImpulse;
        if (locomotion) locomotion.setState(p.clipName, { oneShot: true, fade: p.fade });
      },
      update(dt) {
        state.vy -= GRAV * dt;
        char.position.y += state.vy * dt;
        if (state.kind === 'dive') { // lunge forward so the dive carries into the water even from a standstill
          const nx = char.position.x + Math.sin(heading) * DIVE_FWD * dt;
          const nz = char.position.z + Math.cos(heading) * DIVE_FWD * dt;
          if (Math.abs(nx) < 95 && Math.abs(nz) < 95) { char.position.x = nx; char.position.z = nz; }
        }
        if (state.airFwd) { // horizontal travel during a leap → parabolic arc off the boat, not a vertical pop
          const nx = char.position.x + Math.sin(heading) * state.airFwd * dt;
          const nz = char.position.z + Math.cos(heading) * state.airFwd * dt;
          if (Math.abs(nx) < 95 && Math.abs(nz) < 95) { char.position.x = nx; char.position.z = nz; }
        }
        const swimY = WATER_Y - SWIM_SINK;
        const support = groundHeight(char.position.x, char.position.z);
        const depthHere = WATER_Y - support;
        // A dive settles into a swim at the surface line over ANY real water and is
        // clamped at swimY, so it never plunges to the bed ("davy jones"). A plain
        // jump only starts swimming once the water is properly deep.
        const toSwim = state.kind === 'dive' ? depthHere > DIVE_TRIGGER : depthHere > SWIM_DEPTH;
        if (toSwim && char.position.y <= swimY) {              // splashdown → swim at surface
          char.position.y = groundY = swimY;
          spawnSplash(char.position.x, char.position.z); sfxSplash();
          transition('SWIM', { impulseT: state.queueImpulse ? 0.5 : 0 });
        } else if (!toSwim && char.position.y <= support) {    // touch dry ground / shallow bed
          char.position.y = groundY = support;
          transition('GROUND', { impulseT: state.queueImpulse ? 0.5 : 0 });
        }
      },
      exit() {},
      onClipFinished() {}, // clip clamps on its last frame — physics above decides when to land
    },
    RIDING: {
      enter(p) {
        const b = p.boat;
        state.boat = b;
        b.ridden = true;
        activeInteract = null;
        curMoving = curRunning = false;
        b.heading = b.obj.rotation.y;
        b.speed = 0;
        sfxBoard();
        if (locomotion) locomotion.setState(clips[b.def.sitClip] ? b.def.sitClip : 'idle', { fade: 0.3 });
      },
      exit() {},
    },
    EMOTE: {
      enter(p) { if (locomotion) locomotion.setState(p.clipName, { fade: 0.25 }); },
      update(dt) {
        const support = groundHeight(char.position.x, char.position.z);
        groundY += (support - groundY) * Math.min(1, dt * 14);
        char.position.y = groundY;
      },
      exit() {},
    },
    STEP_OUT: {
      enter(p) {
        state.swimming = p.swimming;
        if (locomotion && clips.hopOut) locomotion.setState('hopOut', { oneShot: true, fade: 0.15 });
      },
      update(dt) {
        const support = groundHeight(char.position.x, char.position.z);
        if (!state.swimming && waterDepth > SWIM_DEPTH) state.swimming = true;
        if (state.swimming && waterDepth < SWIM_DEPTH - 0.3) state.swimming = false;
        const restY = state.swimming ? (WATER_Y - SWIM_SINK) : support;
        groundY += (restY - groundY) * Math.min(1, dt * 14);
        char.position.y = groundY;
      },
      exit() {},
      onClipFinished() {
        const wasSwimming = state.swimming;
        transition(wasSwimming ? 'SWIM' : 'GROUND', { impulseT: 0.4 });
        if (!wasSwimming) locomotion.resume();
      },
    },
  };

  function updateLocomotion(dt, moving, running) {
    if (!locomotion) {
      // placeholder bob while the real model streams in
      char.children[0].children[0].position.y = 0.72 + (moving ? Math.abs(Math.sin(performance.now() * 0.009)) * 0.06 : 0);
      return;
    }
    // a one-shot clip (jump/dive airborne, the boat step-out) or an emote owns the pose
    if (state.name === 'GROUND' || state.name === 'SWIM') {
      if (state.name === 'SWIM') locomotion.setState(moving ? 'swim' : 'tread');
      else if (waterDepth > WADE_START) locomotion.setState(moving ? 'walk' : 'idle'); // wading: walk pace, no run/jump pop
      else locomotion.setState(window.__forceState || (!moving ? 'idle' : running ? 'run' : 'walk'));
    }
    locomotion.update(dt);
  }

  const clearInput = () => { for (const k in keys) keys[k] = false; endPan(); };
  addEventListener('keydown', e => {
    if (!e.isTrusted) return;
    keys[e.code] = true;
    if (e.code === 'KeyG') onToggleGallery();
    if (e.code === 'KeyN') { const p = new URLSearchParams(location.search); p.set('mode', modeKey === 'night' ? 'day' : 'night'); location.search = p.toString(); }
    if (e.code === 'KeyC') { const ks = Object.keys(CHARACTERS); const p = new URLSearchParams(location.search); p.set('char', ks[(ks.indexOf(CHARACTER) + 1) % ks.length]); location.search = p.toString(); }
    if (locomotion && (state.name === 'GROUND' || state.name === 'EMOTE')) {
      const em = { Digit1: 'emote1', Digit2: 'emote2', Digit3: 'emote3' }[e.code];
      if (em && clips[em]) transition('EMOTE', { clipName: em });
    }
    if (e.code === 'KeyE') {
      if (state.name === 'RIDING') disembark();
      else if (activeInteract) activeInteract.run();
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.name === 'GROUND' && !isGalleryOpen()) {
        sfxJump();
        // jumping toward (or standing over) deep water dives; otherwise a gait-matched jump
        // Sample several steps ahead so gently-sloping shores still read as "into
        // the water" — a shallow gradient no longer devolves the dive into a jump.
        let aheadDepth = waterDepth;
        for (const d of [2.2, 3.6, 5.0])
          aheadDepth = Math.max(aheadDepth, WATER_Y - groundHeight(char.position.x + Math.sin(heading) * d, char.position.z + Math.cos(heading) * d));
        const dive = aheadDepth > DIVE_TRIGGER;
        if (dive) {
          transition('AIRBORNE', { kind: 'dive', vy: 6.0, airFwd: 0, queueImpulse: true, clipName: clips.dive ? 'dive' : 'jump', fade: 0.1 });
        } else {
          const want = !curMoving ? 'jumpIdle' : curRunning ? 'jump' : 'jumpWalk';
          transition('AIRBORNE', { kind: 'jump', vy: 7.8, airFwd: 0, queueImpulse: false, clipName: clips[want] ? want : 'jump', fade: 0.12 });
        }
      }
    }
  });
  addEventListener('keyup', e => { if (e.isTrusted) keys[e.code] = false; });
  // focus loss (new tab, fullscreen toggle, context switch) can eat keyup events — reset everything
  addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

  let camPos = null;
  let camYaw = 0, camPitch = 0.36; // orbit state — mouse/arrows drive this
  const alwaysRunEl = document.getElementById('alwaysRun');
  addEventListener('contextmenu', e => e.preventDefault());
  // Pan hardening: only trusted mouse pointer events, right button, canvas-captured,
  // per-event delta clamped, watchdog-cancelled. Synthetic/re-dispatched events
  // (editor overlays, etc.) are ignored entirely — they caused runaway spin.
  let panX = null, panY = null, panId = -1, panT = 0;
  const cv = canvas;
  function endPan() {
    if (panId !== -1) { try { cv.releasePointerCapture(panId); } catch {} }
    panX = null; panY = null; panId = -1;
  }
  cv.addEventListener('pointerdown', e => {
    if (!e.isTrusted || e.pointerType !== 'mouse') return;
    if (e.button === 2) { panX = e.clientX; panY = e.clientY; panId = e.pointerId; panT = performance.now(); cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointerup', e => { if (e.button === 2 || e.pointerId === panId) endPan(); });
  cv.addEventListener('pointercancel', endPan);
  cv.addEventListener('pointermove', e => {
    if (isGalleryOpen() || panX === null) return;
    if (!e.isTrusted || e.pointerId !== panId) return;
    if (!(e.buttons & 2)) { endPan(); return; }
    const dx = Math.max(-60, Math.min(60, e.clientX - panX));
    const dy = Math.max(-60, Math.min(60, e.clientY - panY));
    camYaw -= dx * 0.0032;
    camPitch += dy * 0.0034; // drag matches horizontal orbit feel
    camPitch = Math.max(0.02, Math.min(1.45, camPitch));
    panX = e.clientX; panY = e.clientY; panT = performance.now();
  });

  // ================= boating & interactions =================
  const promptEl = document.getElementById('prompt');
  const promptLabelEl = document.getElementById('promptLabel');
  let lastPrompt = '';
  function refreshPrompt() {
    const text = state.name === 'RIDING' ? 'Hop out' : (activeInteract ? activeInteract.label() : '');
    if (text === lastPrompt) return;
    lastPrompt = text;
    promptLabelEl.textContent = text;
    promptEl.classList.toggle('on', !!text);
  }
  function updateInteract() {
    let best = null, bestD = Infinity;
    for (const it of interactables) {
      if (it.enabled && !it.enabled()) continue;
      const p = it.pos();
      const d = Math.hypot(char.position.x - p.x, char.position.z - p.z);
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
    }
    activeInteract = best;
  }
  function board(b) { transition('RIDING', { boat: b }); }
  setBoardHandler(board);
  function disembark() {
    const b = state.boat;
    b.ridden = false;
    heading = b.heading + b.def.faceOffset;                 // face the way the rider sat
    if ((b.def.disembark || 'leap') === 'step') {
      // Climb down onto the surface beside the boat — NO ballistic jump. Like
      // hopping from a tall cab to the road; the step-out clip plays as we settle.
      const off = b.def.stepOff ?? 1.8;
      char.position.x += Math.sin(heading) * off;
      char.position.z += Math.cos(heading) * off;
      const depth = WATER_Y - groundHeight(char.position.x, char.position.z);
      const swimmingNow = depth > SWIM_DEPTH;
      groundY = swimmingNow ? (WATER_Y - SWIM_SINK) : groundHeight(char.position.x, char.position.z);
      char.position.y = groundY;
      if (locomotion && clips.hopOut) transition('STEP_OUT', { swimming: swimmingNow });
      else transition(swimmingNow ? 'SWIM' : 'GROUND', { impulseT: 0 });
    } else {
      // Leap off in an arc — up (vy) + forward (airFwd) with the running-jump
      // clip, heading already pointing off the boat via faceOffset, then a forced step.
      sfxJump();
      transition('AIRBORNE', { kind: 'leap', vy: 5.6, airFwd: 4.5, queueImpulse: true, clipName: clips.jump ? 'jump' : 'jumpIdle', fade: 0.12 });
    }
  }

  function updateCharacter(dt) {
    // arrows = camera
    if (keys.ArrowLeft) camYaw += dt * 2.0;
    if (keys.ArrowRight) camYaw -= dt * 2.0;
    if (keys.ArrowUp) camPitch += dt * 1.4;
    if (keys.ArrowDown) camPitch -= dt * 1.4;
    camPitch = Math.max(0.02, Math.min(1.45, camPitch));
    if (state.name === 'EMOTE' && (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD)) transition('GROUND', { impulseT: 0 });
    if (state.name === 'RIDING') { updateBoat(dt, state.boat, keys, char); if (locomotion) locomotion.update(dt); refreshPrompt(); return; }
    updateInteract();
    refreshPrompt();
    // water depth under the character (surface minus supporting ground/deck): drives wade drag, swim, dive
    waterDepth = WATER_Y - groundHeight(char.position.x, char.position.z);
    const isSwim = isSwimNow();
    // WASD movement runs for every non-riding state, including AIRBORNE/STEP_OUT
    // (air control / drift during a leap or the step-out one-shot) — matches the
    // original, which never gated this block on isJumping/stepping either.
    let ix = 0, iz = 0;
    if (keys.KeyW) iz -= 1;
    if (keys.KeyS) iz += 1;
    if (keys.KeyA) ix -= 1;
    if (keys.KeyD) ix += 1;
    let moving = ix !== 0 || iz !== 0;
    let running = false;
    if (moving) {
      // view-relative: W runs away from camera, S runs toward it (camera backs off, face to screen)
      const target = Math.atan2(ix, iz) + camYaw;
      let d = target - heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      heading += d * Math.min(1, dt * 10);
      const shift = keys.ShiftLeft || keys.ShiftRight;
      const run = alwaysRunEl.checked ? !shift : shift;
      running = run;
      let speed = run ? 8 : 4;
      if (isSwim) speed = shift ? 5 : 3.6;               // swim pace
      else if (waterDepth > WADE_START) speed *= 0.5;    // wading drag through shallow water
      const nx = char.position.x + Math.sin(heading) * speed * dt;
      const nz = char.position.z + Math.cos(heading) * speed * dt;
      if (Math.abs(nx) < 95 && Math.abs(nz) < 95) {      // water is walkable now — depth drives wade/swim
        char.position.x = nx; char.position.z = nz;
      }
    } else if ((state.name === 'GROUND' || state.name === 'SWIM') && state.impulseT > 0) {
      // forced forward step out of a just-landed dive/leap/step-out — moves +
      // plays walk/swim so the character breaks out of the clip's clamped final frame.
      const speed = isSwim ? 3.6 : 4;
      const nx = char.position.x + Math.sin(heading) * speed * dt;
      const nz = char.position.z + Math.cos(heading) * speed * dt;
      if (Math.abs(nx) < 95 && Math.abs(nz) < 95) { char.position.x = nx; char.position.z = nz; }
      moving = true;
    }
    if ((state.name === 'GROUND' || state.name === 'SWIM') && state.impulseT > 0) state.impulseT -= dt;
    char.rotation.y = heading;
    curRunning = moving && running;
    curMoving = moving;
    // footsteps on land, ripples in water (moving, not airborne)
    if (moving && state.name !== 'AIRBORNE') {
      if (isSwim || waterDepth > WADE_START) {
        rippleT += dt; if (rippleT > 0.34) { rippleT = 0; spawnRipple(char.position.x, char.position.z, isSwim ? 1 : 0.7); }
      } else {
        stepSfxT += dt; if (stepSfxT > (curRunning ? 0.28 : 0.4)) { stepSfxT = 0; sfxStep(); }
      }
    }
    // ---- vertical: terrain-follow · swim float · jump/dive arc — per current state ----
    STATES[state.name].update(dt);
    updateLocomotion(dt, moving, running);
  }

  let camDist = 7.5, camDistDyn = 7.5;
  addEventListener('wheel', e => {
    if (isGalleryOpen()) return;
    camDist = Math.max(1.6, Math.min(16, camDist + e.deltaY * 0.008));
  }, { passive: true });
  function updateCamera(dt, camera) {
    // Genshin/WuWa feel: pull back a little while running, ease back in when stopping
    const targetDist = camDist + (curRunning ? 2.4 : 0);
    const k = curRunning ? 3.5 : 1.6; // out fast, in slow
    camDistDyn += (targetDist - camDistDyn) * (1 - Math.exp(-dt * k));
    const dist = camDistDyn;
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const tx = char.position.x + Math.sin(camYaw) * cp * dist;
    const tz = char.position.z + Math.cos(camYaw) * cp * dist;
    let ty = char.position.y + 1.6 + sp * dist;
    ty = Math.max(ty, terrainHeight(tx, tz) + 0.6);
    if (!camPos) camPos = new THREE.Vector3(tx, ty, tz);
    camPos.lerp(new THREE.Vector3(tx, ty, tz), 1 - Math.exp(-dt * 10));
    camera.position.copy(camPos);
    // as the camera tilts overhead, aim lower so the ground/feet stay in frame
    const lookH = 1.6 - Math.max(0, camPitch - 0.55) * 1.5;
    camera.lookAt(char.position.x, char.position.y + Math.max(0.35, lookH), char.position.z);
  }

  window.__tp = (x, z) => { char.position.set(x, groundHeight(x, z), z); }; // debug teleport
  window.__boats = boats; window.__board = i => board(boats[i]); window.__off = () => disembark();
  window.__view = (yaw, pitch, dist) => { camYaw = yaw; camPitch = pitch; camDist = dist; camDistDyn = dist; };
  window.__ci = () => ({ camYaw, camPitch, camDist, camDistDyn, aerial: window.__aerial, inGallery: isGalleryOpen() });
  window.__keys = keys; window.__step = dt => { if (state.name === 'RIDING') updateBoat(dt || 0.1, state.boat, keys, char); };
  window.__seat = () => state.name === 'RIDING' ? { boat: state.boat.name, char: char.position.toArray().map(v=>+v.toFixed(2)), boatPos: state.boat.obj.position.toArray().map(v=>+v.toFixed(2)), heading:+state.boat.heading.toFixed(2), spd:+state.boat.speed.toFixed(2), paddleX: state.boat.paddles ? +state.boat.paddles.rotation.x.toFixed(3) : null } : 'not riding';
  window.__stateName = () => state.name; // console/debug hook

  // per-frame guards, run before the animated list: no input while unfocused;
  // stale pan self-cancels (right-click held, then focus/DOM state got weird)
  function frameGuards() {
    if (!document.hasFocus()) clearInput();
    if (panX !== null && performance.now() - panT > 400) endPan();
  }

  return { char, updateCharacter, updateCamera, getHeading: () => heading, frameGuards };
}
