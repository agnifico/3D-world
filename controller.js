// Grassland World — input, character control, camera. Owns the `char` group,
// all movement/physics flags, boarding, and the orbit camera.
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
    result.mixer.addEventListener('finished', () => {
      const wasStep = stepping; stepping = false;
      if (wasStep) autoStepT = 0.4;
      if (swimming || isJumping || riding) return;
      locomotion.resume();
    });
  }).catch(e => console.warn(`[character] ${CHARACTER} model failed, using placeholder:`, e.message));

  function updateLocomotion(dt, moving, running) {
    if (!locomotion) {
      // placeholder bob while the real model streams in
      char.children[0].children[0].position.y = 0.72 + (moving ? Math.abs(Math.sin(performance.now() * 0.009)) * 0.06 : 0);
      return;
    }
    // a one-shot clip (jump/dive airborne, the boat step-out) or an emote owns the pose
    if (!isJumping && !stepping && !emoting) {
      if (swimming) locomotion.setState(moving ? 'swim' : 'tread');
      else if (waterDepth > WADE_START) locomotion.setState(moving ? 'walk' : 'idle'); // wading: walk pace, no run/jump pop
      else locomotion.setState(window.__forceState || (!moving ? 'idle' : running ? 'run' : 'walk'));
    }
    locomotion.update(dt);
  }
  if (BIOME.lantern) {
    const lamp = new THREE.PointLight(0xffc37a, 30, 22, 1.8);
    lamp.position.y = 2.2;
    char.add(lamp);
  }

  const keys = {};
  let jumpVel = 0, isJumping = false, diving = false, swimming = false, groundY = 0, waterDepth = 0, curRunning = false, curMoving = false;
  let riding = null, activeInteract = null;
  // swim tuning: depth = water surface (WATER_Y) minus the ground/bed under the character
  const GRAV = 20, SWIM_DEPTH = 1.2, SWIM_SINK = 1.05, WADE_START = 0.45, DIVE_TRIGGER = 0.6, DIVE_FWD = 6.0;
  const WATER_Y = -0.9;
  let stepping = false; // a grounded one-shot (boat step-out) owns the pose until it finishes
  let autoStepT = 0, stepOutQueued = false; // after a dive/leap lands, force a short walk/swim step so the pose doesn't freeze on the clip's last frame
  let airFwd = 0; // horizontal speed applied while airborne on a disembark leap → a forward arc
  let emoting = false; // an emote pose owns the locomotion state until you move
  let stepSfxT = 0, rippleT = 0; // footstep-SFX / water-ripple cadence timers
  const clearInput = () => { for (const k in keys) keys[k] = false; endPan(); };
  addEventListener('keydown', e => {
    if (!e.isTrusted) return;
    keys[e.code] = true;
    if (e.code === 'KeyG') onToggleGallery();
    if (e.code === 'KeyN') { const p = new URLSearchParams(location.search); p.set('mode', modeKey === 'night' ? 'day' : 'night'); location.search = p.toString(); }
    if (e.code === 'KeyC') { const ks = Object.keys(CHARACTERS); const p = new URLSearchParams(location.search); p.set('char', ks[(ks.indexOf(CHARACTER) + 1) % ks.length]); location.search = p.toString(); }
    if (locomotion && !riding && !isJumping && !swimming && !stepping) {
      const em = { Digit1: 'emote1', Digit2: 'emote2', Digit3: 'emote3' }[e.code];
      if (em && clips[em]) { emoting = true; locomotion.setState(em, { fade: 0.25 }); }
    }
    if (e.code === 'KeyE') {
      if (riding) disembark();
      else if (activeInteract) activeInteract.run();
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!isJumping && !swimming && !isGalleryOpen() && !riding) {
        sfxJump();
        // jumping toward (or standing over) deep water dives; otherwise a gait-matched jump
        // Sample several steps ahead so gently-sloping shores still read as "into
        // the water" — a shallow gradient no longer devolves the dive into a jump.
        let aheadDepth = waterDepth;
        for (const d of [2.2, 3.6, 5.0])
          aheadDepth = Math.max(aheadDepth, WATER_Y - groundHeight(char.position.x + Math.sin(heading) * d, char.position.z + Math.cos(heading) * d));
        const dive = aheadDepth > DIVE_TRIGGER;
        if (dive) {
          isJumping = true; diving = true; jumpVel = 6.0; stepOutQueued = true;
          if (locomotion) locomotion.setState(clips.dive ? 'dive' : 'jump', { oneShot: true, fade: 0.1 });
        } else {
          isJumping = true; jumpVel = 7.8;
          const want = !curMoving ? 'jumpIdle' : curRunning ? 'jump' : 'jumpWalk';
          if (locomotion) locomotion.setState(clips[want] ? want : 'jump', { oneShot: true, fade: 0.12 });
        }
      }
    }
  });
  addEventListener('keyup', e => { if (e.isTrusted) keys[e.code] = false; });
  // focus loss (new tab, fullscreen toggle, context switch) can eat keyup events — reset everything
  addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

  let heading = 0, camPos = null;
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
    const text = riding ? 'Hop out' : (activeInteract ? activeInteract.label() : '');
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
  function board(b) {
    riding = b; b.ridden = true;
    activeInteract = null;
    swimming = false; isJumping = false; diving = false; jumpVel = 0;
    curMoving = curRunning = false;
    b.heading = b.obj.rotation.y;
    b.speed = 0;
    sfxBoard();
    if (locomotion) locomotion.setState(clips[b.def.sitClip] ? b.def.sitClip : 'idle', { fade: 0.3 });
  }
  setBoardHandler(board);
  function disembark() {
    const b = riding;
    riding = null; b.ridden = false;
    heading = b.heading + b.def.faceOffset;                 // face the way the rider sat
    if ((b.def.disembark || 'leap') === 'step') {
      // Climb down onto the surface beside the boat — NO ballistic jump. Like
      // hopping from a tall cab to the road; the step-out clip plays as we settle.
      const off = b.def.stepOff ?? 1.8;
      char.position.x += Math.sin(heading) * off;
      char.position.z += Math.cos(heading) * off;
      isJumping = diving = false; jumpVel = 0;
      const depth = WATER_Y - groundHeight(char.position.x, char.position.z);
      swimming = depth > SWIM_DEPTH;
      groundY = swimming ? (WATER_Y - SWIM_SINK) : groundHeight(char.position.x, char.position.z);
      char.position.y = groundY;
      if (locomotion && clips.hopOut) { stepping = true; locomotion.setState('hopOut', { oneShot: true, fade: 0.15 }); }
    } else {
      // Leap off in an arc — up (jumpVel) + forward (airFwd) with the running-jump
      // clip, heading already pointing off the boat via faceOffset, then a forced step.
      isJumping = true; diving = false; jumpVel = 5.6; airFwd = 4.5; stepOutQueued = true; sfxJump();
      if (locomotion) locomotion.setState(clips.jump ? 'jump' : 'jumpIdle', { oneShot: true, fade: 0.12 });
    }
  }

  function updateCharacter(dt) {
    // arrows = camera
    if (keys.ArrowLeft) camYaw += dt * 2.0;
    if (keys.ArrowRight) camYaw -= dt * 2.0;
    if (keys.ArrowUp) camPitch += dt * 1.4;
    if (keys.ArrowDown) camPitch -= dt * 1.4;
    camPitch = Math.max(0.02, Math.min(1.45, camPitch));
    if (emoting && (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD)) emoting = false;
    if (riding) { updateBoat(dt, riding, keys, char); if (locomotion) locomotion.update(dt); refreshPrompt(); return; }
    updateInteract();
    refreshPrompt();
    // water depth under the character (surface minus supporting ground/deck): drives wade drag, swim, dive
    waterDepth = WATER_Y - groundHeight(char.position.x, char.position.z);
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
      if (swimming) speed = shift ? 5 : 3.6;            // swim pace
      else if (waterDepth > WADE_START) speed *= 0.5;   // wading drag through shallow water
      const nx = char.position.x + Math.sin(heading) * speed * dt;
      const nz = char.position.z + Math.cos(heading) * speed * dt;
      if (Math.abs(nx) < 95 && Math.abs(nz) < 95) {     // water is walkable now — depth drives wade/swim
        char.position.x = nx; char.position.z = nz;
      }
    } else if (autoStepT > 0) {
      // forced forward step out of a just-landed dive/leap — moves + plays walk/swim
      // so the character breaks out of the clip's clamped final frame.
      const speed = swimming ? 3.6 : 4;
      const nx = char.position.x + Math.sin(heading) * speed * dt;
      const nz = char.position.z + Math.cos(heading) * speed * dt;
      if (Math.abs(nx) < 95 && Math.abs(nz) < 95) { char.position.x = nx; char.position.z = nz; }
      moving = true;
    }
    if (autoStepT > 0) autoStepT -= dt;
    char.rotation.y = heading;
    curRunning = moving && running;
    curMoving = moving;
    // footsteps on land, ripples in water (moving, not airborne)
    if (moving && !isJumping) {
      if (swimming || waterDepth > WADE_START) {
        rippleT += dt; if (rippleT > 0.34) { rippleT = 0; spawnRipple(char.position.x, char.position.z, swimming ? 1 : 0.7); }
      } else {
        stepSfxT += dt; if (stepSfxT > (curRunning ? 0.28 : 0.4)) { stepSfxT = 0; sfxStep(); }
      }
    }
    // ---- vertical: terrain-follow · swim float · jump/dive arc ----
    const support = groundHeight(char.position.x, char.position.z); // deck or bed the body rests on
    if (isJumping) {
      jumpVel -= GRAV * dt;
      char.position.y += jumpVel * dt;
      if (diving) { // lunge forward so the dive carries into the water even from a standstill
        const nx = char.position.x + Math.sin(heading) * DIVE_FWD * dt;
        const nz = char.position.z + Math.cos(heading) * DIVE_FWD * dt;
        if (Math.abs(nx) < 95 && Math.abs(nz) < 95) { char.position.x = nx; char.position.z = nz; }
      }
      if (airFwd) { // horizontal travel during a leap → parabolic arc off the boat, not a vertical pop
        const nx = char.position.x + Math.sin(heading) * airFwd * dt;
        const nz = char.position.z + Math.cos(heading) * airFwd * dt;
        if (Math.abs(nx) < 95 && Math.abs(nz) < 95) { char.position.x = nx; char.position.z = nz; }
      }
      const swimY = WATER_Y - SWIM_SINK;
      const depthHere = WATER_Y - groundHeight(char.position.x, char.position.z);
      // A dive settles into a swim at the surface line over ANY real water and is
      // clamped at swimY, so it never plunges to the bed ("davy jones"). A plain
      // jump only starts swimming once the water is properly deep.
      const toSwim = diving ? depthHere > DIVE_TRIGGER : depthHere > SWIM_DEPTH;
      if (toSwim && char.position.y <= swimY) {              // splashdown → swim at surface
        char.position.y = groundY = swimY; isJumping = diving = false; swimming = true; jumpVel = 0; airFwd = 0;
        spawnSplash(char.position.x, char.position.z); sfxSplash();
        if (stepOutQueued) { autoStepT = 0.5; stepOutQueued = false; }
      } else if (!toSwim && char.position.y <= support) {    // touch dry ground / shallow bed
        char.position.y = groundY = support; isJumping = diving = false; jumpVel = 0; airFwd = 0;
        if (stepOutQueued) { autoStepT = 0.5; stepOutQueued = false; }
      }
    } else {
      if (!swimming && waterDepth > SWIM_DEPTH) swimming = true;         // waded past waist → float
      if (swimming && waterDepth < SWIM_DEPTH - 0.3) swimming = false;   // reached the shallows → stand
      const restY = swimming ? (WATER_Y - SWIM_SINK) : support;
      groundY += (restY - groundY) * Math.min(1, dt * 14);
      char.position.y = groundY;
    }
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
  window.__keys = keys; window.__step = dt => { if (riding) updateBoat(dt || 0.1, riding, keys, char); };
  window.__seat = () => riding ? { boat: riding.name, char: char.position.toArray().map(v=>+v.toFixed(2)), boatPos: riding.obj.position.toArray().map(v=>+v.toFixed(2)), heading:+riding.heading.toFixed(2), spd:+riding.speed.toFixed(2), paddleX: riding.paddles ? +riding.paddles.rotation.x.toFixed(3) : null } : 'not riding';

  // per-frame guards, run before the animated list: no input while unfocused;
  // stale pan self-cancels (right-click held, then focus/DOM state got weird)
  function frameGuards() {
    if (!document.hasFocus()) clearInput();
    if (panX !== null && performance.now() - panT > 400) endPan();
  }

  return { char, updateCharacter, updateCamera, getHeading: () => heading, frameGuards };
}
