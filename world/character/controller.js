// World Shell — input, character control, camera. Owns the `char` group and
// the character state machine: GROUND (idle/walk/run/wade), AIRBORNE
// (jump/dive/leap), SWIM, RIDING(boat), EMOTE, STEP_OUT. Shell-level: created
// ONCE at startup and persists across every zone crossing (same Mia, same
// locomotion/state machine — only the zone content and palette swap around
// it, per Brief 6's "character persists across the crossing").
//
// Adapted from grassland/controller.js: WATER_Y/terrainHeight now come from
// whichever zone is currently active (updated via setActiveZone, since they
// differ per zone) instead of a single hardcoded module import; the
// height/collision registries and boats/interactables are shared shell
// services (ctx) instead of one zone's private singletons.
import * as THREE from 'three';
import { CHARACTERS, CHARACTER, loadCharacter } from './character.js';
import { boats, updateBoat, setBoardHandler } from '../core/boats.js';
import * as Interactables from '../core/interactables.js';

function createPlaceholder() {
  const mat = c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 4, 8), mat(0xe8c468));
  body.position.set(0, 0.72, 0); body.castShadow = body.receiveShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 8, 6), mat(0xecd9b0));
  head.position.set(0, 1.42, 0); head.castShadow = head.receiveShadow = true;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 5).rotateX(Math.PI / 2), mat(0xd9b98c));
  nose.position.set(0, 1.42, 0.27); nose.castShadow = nose.receiveShadow = true;
  g.add(body, head, nose);
  g.userData.name = 'Character (placeholder)';
  return g;
}

export function initController(scene, sharedAnimated, opts) {
  const {
    canvas, spawnRipple, spawnSplash, sfxSplash, sfxStep, sfxJump, sfxBoard,
    heightRegistry, collisionRegistry, lighting,
    onSwapStateChange, onCharacterChanged,
  } = opts;

  const char = new THREE.Group();
  char.position.set(0, 0, 0);
  const placeholder = createPlaceholder();
  let currentModel = placeholder;
  char.add(placeholder);
  scene.add(char);

  // A soft top-down "aura" lantern, palette-driven (grassland's night
  // palette carries a `lantern{color,intensity}` field; a zone whose
  // palettes have no such field simply never drives it — day starts at
  // intensity 0 either way, so this is inert until a zone's blend sets it).
  // Character-owned (rides `char`), so it's created once here and persists
  // across every zone crossing, rather than being zone-owned like the rest
  // of a night palette's dressing.
  const lantern = new THREE.SpotLight(0xffc37a, 0, 24, 0.6, 1.0, 1.2);
  lantern.position.set(0, 9, 0.6);
  lantern.target.position.set(0, 0.4, 0);
  char.add(lantern, lantern.target);
  lighting.onBlend((PA, PB, localT) => {
    if (!PA.lantern || !PB.lantern) return; // active zone's palette doesn't define one — leave as last set
    const p = localT < 0.5 ? PA.lantern : PB.lantern; // binary hard-step, matching the original day/night switch
    lantern.color.set(p.color);
    lantern.intensity = p.intensity;
  });

  // ================= active-zone binding =================
  // Swapped by the shell on every zone build; the state machine below reads
  // these closure vars rather than importing one zone's world.js directly.
  let WATER_Y = 0;
  let terrainHeightFn = () => 0;
  let zoneHooks = { isOverlayOpen: () => false };
  function setActiveZone(zone, hooks = {}) {
    WATER_Y = zone.WATER_Y;
    terrainHeightFn = zone.terrainHeight;
    zoneHooks = { isOverlayOpen: () => false, ...hooks };
  }
  function placeAt(x, y, z, h = 0) {
    char.position.set(x, y, z);
    heading = h;
    groundY = y;
    state.impulseT = 0;
  }

  const clips = {};
  let locomotion = null;
  let currentCharName = CHARACTER;
  const characterCache = {}; // loadCharacter() called at most once per name, ever

  // Swaps in an already-resolved loadCharacter() result — used for both the
  // initial load and every hot-swap. Position/heading/FSM state are
  // untouched (this only ever runs while state.name is GROUND/SWIM — see
  // swapCharacter below); the pose resets to idle immediately so there's no
  // T-pose flash before the next updateLocomotion tick picks the right one.
  function applyCharacterResult(result, name) {
    char.remove(currentModel);
    currentModel = result.model;
    char.add(currentModel);
    currentCharName = name;
    for (const k in clips) delete clips[k];
    Object.assign(clips, result.clips);
    locomotion = result.locomotion;
    if (clips.idle) locomotion.setState('idle');
    window.__setState = n => locomotion.setState(n); // console/debug hook
    window.__clips = clips; window.__model = currentModel; window.__mixer = result.mixer; // console/debug hooks
    // one-shot clips (jump, dive, hopOut) hand control back to whatever state
    // they belong to — only AIRBORNE and STEP_OUT ever play one, so only they
    // define onClipFinished; every other state's finish is a no-op.
    result.mixer.addEventListener('finished', () => { STATES[state.name].onClipFinished?.(); });
    onCharacterChanged?.(name);
  }

  loadCharacter(CHARACTER).then(result => {
    if (!result) return;
    characterCache[CHARACTER] = result;
    applyCharacterResult(result, CHARACTER);
  }).catch(e => console.warn(`[character] ${CHARACTER} model failed, using placeholder:`, e.message));

  // Hot-swap (C key). AIRBORNE/RIDING/STEP_OUT own a one-shot pose or are
  // mid-physics — queue the request and apply it once GROUND/SWIM is
  // reached (checked at the top of updateCharacter) rather than risk a
  // visual glitch or a stuck state. EMOTE just cancels back to GROUND first;
  // preserving an arbitrary emote through a model swap isn't worth it.
  let swapping = false, pendingSwapName = null;
  async function swapCharacter(name) {
    if (name === currentCharName || swapping) return;
    if (state.name === 'AIRBORNE' || state.name === 'RIDING' || state.name === 'STEP_OUT') { pendingSwapName = name; return; }
    if (state.name === 'EMOTE') transition('GROUND', { impulseT: 0 });
    swapping = true;
    onSwapStateChange?.(true);
    if (!characterCache[name]) characterCache[name] = await loadCharacter(name);
    swapping = false;
    onSwapStateChange?.(false);
    const result = characterCache[name];
    if (!result) return; // load failed — loadCharacter already warned; keep current character
    applyCharacterResult(result, name);
  }

  const keys = {};
  let heading = 0, groundY = 0, waterDepth = 0, curRunning = false, curMoving = false;
  let activeInteract = null;
  // swim tuning: depth = water surface (WATER_Y) minus the ground/bed under the character
  const GRAV = 20, SWIM_DEPTH = 1.2, SWIM_SINK = 1.05, WADE_START = 0.45, DIVE_TRIGGER = 0.6, DIVE_FWD = 6.0;
  const CHAR_RADIUS = 0.35; // horizontal collision radius, resolveMovement() calls below
  const CHAR_HEIGHT = 1.7, STEP_UP = 0.5; // vertical band height, step-up threshold
  let stepSfxT = 0, rippleT = 0; // footstep-SFX / water-ripple cadence timers

  // "depth at my feet" — never negative-but-meaningless once clamped, support
  // >= WATER_Y (solid footing, deck or dry land) always reads as exactly dry.
  // feetY (optional) filters out contributors — like a bridge deck — that
  // are more than STEP_UP above the character's actual current Y, so a
  // swimmer passing under a bridge doesn't get read as "on the deck" just
  // because the deck is the tallest thing at that (x,z). Omitted by
  // disembark()'s call (boarding bypasses the filter, per the original brief).
  function waterDepthAt(x, z, feetY) {
    const support = feetY !== undefined ? heightRegistry.resolveSupport(x, z, feetY, STEP_UP).height : heightRegistry.groundHeight(x, z);
    return support >= WATER_Y ? 0 : WATER_Y - support;
  }

  // ================= character state machine =================
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
        const support = heightRegistry.resolveSupport(char.position.x, char.position.z, char.position.y, STEP_UP).height;
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
        const support = heightRegistry.resolveSupport(char.position.x, char.position.z, char.position.y, STEP_UP).height;
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
          const dx = Math.sin(heading) * DIVE_FWD * dt, dz = Math.cos(heading) * DIVE_FWD * dt;
          const r = collisionRegistry.resolveMovement(char.position.x, char.position.z, CHAR_RADIUS, dx, dz, { feetY: char.position.y, headY: char.position.y + CHAR_HEIGHT, stepUp: STEP_UP });
          if (Math.abs(r.x) < 95 && Math.abs(r.z) < 95) { char.position.x = r.x; char.position.z = r.z; }
        }
        if (state.airFwd) { // horizontal travel during a leap → parabolic arc off the boat, not a vertical pop
          const dx = Math.sin(heading) * state.airFwd * dt, dz = Math.cos(heading) * state.airFwd * dt;
          const r = collisionRegistry.resolveMovement(char.position.x, char.position.z, CHAR_RADIUS, dx, dz, { feetY: char.position.y, headY: char.position.y + CHAR_HEIGHT, stepUp: STEP_UP });
          if (Math.abs(r.x) < 95 && Math.abs(r.z) < 95) { char.position.x = r.x; char.position.z = r.z; }
        }
        const swimY = WATER_Y - SWIM_SINK;
        const support = heightRegistry.resolveSupport(char.position.x, char.position.z, char.position.y, STEP_UP).height;
        const depthHere = support >= WATER_Y ? 0 : WATER_Y - support;
        // A dive settles into a swim at the surface line over ANY real water and is
        // clamped at swimY, so it never plunges to the bed. A plain jump only
        // starts swimming once the water is properly deep.
        const toSwim = state.kind === 'dive' ? depthHere > DIVE_TRIGGER : depthHere > SWIM_DEPTH;
        if (toSwim && char.position.y <= swimY) {              // splashdown → swim at surface
          char.position.y = groundY = swimY;
          spawnSplash(char.position.x, char.position.z, WATER_Y); sfxSplash();
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
        const support = heightRegistry.resolveSupport(char.position.x, char.position.z, char.position.y, STEP_UP).height;
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
        const support = heightRegistry.resolveSupport(char.position.x, char.position.z, char.position.y, STEP_UP).height;
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
    if (e.code === 'KeyN') lighting.requestToggle();
    if (e.code === 'KeyC') { const ks = Object.keys(CHARACTERS); swapCharacter(ks[(ks.indexOf(currentCharName) + 1) % ks.length]); }
    if (locomotion && (state.name === 'GROUND' || state.name === 'EMOTE')) {
      const em = { Digit1: 'emote1', Digit2: 'emote2', Digit3: 'emote3' }[e.code];
      if (em && clips[em]) transition('EMOTE', { clipName: em });
    }
    // Generic — fires whichever candidate the resolver picked this frame,
    // as long as the pressed key matches THAT candidate's own declared key
    // (per-candidate, not hardcoded to E here — see core/interactables.js).
    // No state.name check: portal-vs-disembark-vs-board priority is decided
    // entirely by the registered numbers, not a pairwise special case.
    if (activeInteract && e.code === activeInteract.key) activeInteract.onActivate();
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.name === 'GROUND' && !zoneHooks.isOverlayOpen()) {
        sfxJump();
        // jumping toward (or standing over) deep water dives; otherwise a gait-matched jump
        let aheadDepth = waterDepth;
        for (const d of [2.2, 3.6, 5.0])
          aheadDepth = Math.max(aheadDepth, WATER_Y - heightRegistry.groundHeight(char.position.x + Math.sin(heading) * d, char.position.z + Math.cos(heading) * d));
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
    if (zoneHooks.isOverlayOpen() || panX === null) return;
    if (!e.isTrusted || e.pointerId !== panId) return;
    if (!(e.buttons & 2)) { endPan(); return; }
    const dx = Math.max(-60, Math.min(60, e.clientX - panX));
    const dy = Math.max(-60, Math.min(60, e.clientY - panY));
    camYaw -= dx * 0.0032;
    camPitch += dy * 0.0034; // drag matches horizontal orbit feel
    camPitch = Math.max(0.02, Math.min(1.45, camPitch));
    panX = e.clientX; panY = e.clientY; panT = performance.now();
  });

  // ================= footing debug =================
  // window.__footing(true) shows a live {winning contributor, support height,
  // terrain height, computed water depth} line.
  const footingEl = document.createElement('div');
  footingEl.style.cssText = 'position:fixed; left:50%; bottom:64px; transform:translateX(-50%); z-index:5; display:none; font:12px ui-monospace, monospace; color:#eafff2; background:rgba(10,14,12,.78); border-radius:6px; padding:5px 12px; white-space:pre; pointer-events:none;';
  document.body.appendChild(footingEl);
  let footingOn = false;
  window.__footing = (v = true) => { footingOn = v; footingEl.style.display = v ? '' : 'none'; };

  // ================= boating & interactions =================
  const promptEl = document.getElementById('prompt');
  const promptLabelEl = document.getElementById('promptLabel');
  let lastPrompt = '';
  function refreshPrompt() {
    // Generic — whatever the resolver picked wins the prompt too. No more
    // hardcoded "RIDING means Hop out": disembark is just another registered
    // candidate now, so if a higher-priority one (a portal) is also in
    // range, ITS label shows instead — that's the actual fix, not a
    // special case bolted on here.
    const text = activeInteract ? activeInteract.label() : '';
    if (text === lastPrompt) return;
    lastPrompt = text;
    promptLabelEl.textContent = text;
    promptEl.classList.toggle('on', !!text);
  }
  function updateInteract() {
    activeInteract = Interactables.resolve(char);
  }
  function board(b) { transition('RIDING', { boat: b }); }
  setBoardHandler(board);
  // Seeded interaction: disembarking. Registered once, persists across every
  // zone crossing (persistent: true survives Interactables.reset(), which
  // the shell calls before every zone build) since it's character-state-
  // driven, not tied to any particular zone's content. Lower priority than
  // a portal (core/zone.js's registerPortals) so a boat-borne crossing wins
  // over hopping out when both are in range at once; higher than boarding
  // a different nearby boat (core/boats.js), matching the original
  // behavior where you could never board another boat while riding one.
  const DISEMBARK_PRIORITY = 50;
  Interactables.register({
    id: 'disembark',
    priority: DISEMBARK_PRIORITY,
    persistent: true,
    inRange: () => state.name === 'RIDING',
    distanceTo: () => 0,
    label: () => 'Hop out',
    key: 'KeyE',
    onActivate: () => disembark(),
  });
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
      const depth = waterDepthAt(char.position.x, char.position.z);
      const swimmingNow = depth > SWIM_DEPTH;
      groundY = swimmingNow ? (WATER_Y - SWIM_SINK) : heightRegistry.groundHeight(char.position.x, char.position.z);
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
  // Externally callable mount (shell-driven, e.g. re-seating the rider after
  // a boat-borne portal crossing) — same transition board() uses, just not
  // gated behind the nearest-interactable check.
  function mountBoat(b) { board(b); }
  // What the shell needs to know before crossing a portal: is the character
  // riding, and if so which kind of boat + its heading, so the destination
  // zone can spawn the same kind afloat and re-seat the rider.
  function getCrossingState() {
    if (state.name !== 'RIDING') return { riding: false };
    return { riding: true, boatType: state.boat.name, heading: state.boat.heading };
  }

  function updateCharacter(dt) {
    // arrows = camera
    if (keys.ArrowLeft) camYaw += dt * 2.0;
    if (keys.ArrowRight) camYaw -= dt * 2.0;
    if (keys.ArrowUp) camPitch += dt * 1.4;
    if (keys.ArrowDown) camPitch -= dt * 1.4;
    camPitch = Math.max(0.02, Math.min(1.45, camPitch));
    if (state.name === 'EMOTE' && (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD)) transition('GROUND', { impulseT: 0 });
    if (state.name === 'RIDING') {
      updateBoat(dt, state.boat, keys, char, terrainHeightFn);
      if (locomotion) locomotion.update(dt);
      // Still resolve interactions while riding — this is the actual fix:
      // a portal in range must be able to win over disembark, which it can
      // only do if the resolver actually runs every frame, riding included.
      updateInteract();
      refreshPrompt();
      return;
    }
    if (pendingSwapName && (state.name === 'GROUND' || state.name === 'SWIM')) { const n = pendingSwapName; pendingSwapName = null; swapCharacter(n); }
    updateInteract();
    refreshPrompt();
    // water depth under the character (surface minus supporting ground/deck): drives wade drag, swim, dive
    waterDepth = waterDepthAt(char.position.x, char.position.z, char.position.y);
    if (footingOn) {
      const r = heightRegistry.resolveSupport(char.position.x, char.position.z, char.position.y, STEP_UP);
      const th = terrainHeightFn(char.position.x, char.position.z);
      footingEl.textContent = `support: ${r.contributor} @ ${r.height.toFixed(3)}  |  terrain: ${th.toFixed(3)}  |  waterDepth: ${waterDepth.toFixed(3)}  |  state: ${state.name}`;
    }
    const isSwim = isSwimNow();
    // WASD movement runs for every non-riding state, including AIRBORNE/STEP_OUT
    // (air control / drift during a leap or the step-out one-shot).
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
      const dx = Math.sin(heading) * speed * dt, dz = Math.cos(heading) * speed * dt;
      const r = collisionRegistry.resolveMovement(char.position.x, char.position.z, CHAR_RADIUS, dx, dz, { feetY: char.position.y, headY: char.position.y + CHAR_HEIGHT, stepUp: STEP_UP });
      if (Math.abs(r.x) < 95 && Math.abs(r.z) < 95) {    // water is walkable now — depth drives wade/swim
        char.position.x = r.x; char.position.z = r.z;
      }
    } else if ((state.name === 'GROUND' || state.name === 'SWIM') && state.impulseT > 0) {
      // forced forward step out of a just-landed dive/leap/step-out — moves +
      // plays walk/swim so the character breaks out of the clip's clamped final frame.
      const speed = isSwim ? 3.6 : 4;
      const dx = Math.sin(heading) * speed * dt, dz = Math.cos(heading) * speed * dt;
      const r = collisionRegistry.resolveMovement(char.position.x, char.position.z, CHAR_RADIUS, dx, dz, { feetY: char.position.y, headY: char.position.y + CHAR_HEIGHT, stepUp: STEP_UP });
      if (Math.abs(r.x) < 95 && Math.abs(r.z) < 95) { char.position.x = r.x; char.position.z = r.z; }
      moving = true;
    }
    if ((state.name === 'GROUND' || state.name === 'SWIM') && state.impulseT > 0) state.impulseT -= dt;
    char.rotation.y = heading;
    curRunning = moving && running;
    curMoving = moving;
    // footsteps on land, ripples in water (moving, not airborne)
    if (moving && state.name !== 'AIRBORNE') {
      if (isSwim || waterDepth > WADE_START) {
        rippleT += dt; if (rippleT > 0.34) { rippleT = 0; spawnRipple(char.position.x, char.position.z, WATER_Y, isSwim ? 1 : 0.7); }
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
    if (zoneHooks.isOverlayOpen()) return;
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
    ty = Math.max(ty, terrainHeightFn(tx, tz) + 0.6);
    if (!camPos) camPos = new THREE.Vector3(tx, ty, tz);
    camPos.lerp(new THREE.Vector3(tx, ty, tz), 1 - Math.exp(-dt * 10));
    camera.position.copy(camPos);
    // as the camera tilts overhead, aim lower so the ground/feet stay in frame
    const lookH = 1.6 - Math.max(0, camPitch - 0.55) * 1.5;
    camera.lookAt(char.position.x, char.position.y + Math.max(0.35, lookH), char.position.z);
  }

  window.__tp = (x, z) => { char.position.set(x, heightRegistry.groundHeight(x, z), z); }; // debug teleport
  window.__boats = boats; window.__board = i => board(boats[i]); window.__off = () => disembark();
  window.__view = (yaw, pitch, dist) => { camYaw = yaw; camPitch = pitch; camDist = dist; camDistDyn = dist; };
  window.__ci = () => ({ camYaw, camPitch, camDist, camDistDyn, inGallery: zoneHooks.isOverlayOpen() });
  window.__keys = keys; window.__step = dt => { if (state.name === 'RIDING') updateBoat(dt || 0.1, state.boat, keys, char, terrainHeightFn); };
  window.__seat = () => state.name === 'RIDING' ? { boat: state.boat.name, char: char.position.toArray().map(v=>+v.toFixed(2)), boatPos: state.boat.obj.position.toArray().map(v=>+v.toFixed(2)), heading:+state.boat.heading.toFixed(2), spd:+state.boat.speed.toFixed(2), paddleX: state.boat.paddles ? +state.boat.paddles.rotation.x.toFixed(3) : null } : 'not riding';
  window.__stateName = () => state.name; // console/debug hook

  // per-frame guards, run before the animated list: no input while unfocused;
  // stale pan self-cancels (right-click held, then focus/DOM state got weird)
  function frameGuards() {
    if (!document.hasFocus()) clearInput();
    if (panX !== null && performance.now() - panT > 400) endPan();
  }

  return { char, updateCharacter, updateCamera, getHeading: () => heading, frameGuards, setActiveZone, placeAt, getCrossingState, mountBoat };
}
