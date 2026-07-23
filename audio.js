// Grassland World — asset-free Web-Audio synth SFX.
// AudioContext starts on the first user gesture (browser policy).
let _actx = null;
function _audio() { if (!_actx) { try { _actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (_actx && _actx.state === 'suspended') _actx.resume(); return _actx; }
addEventListener('pointerdown', _audio); addEventListener('keydown', _audio);
function _noise(dur, freq, q, gain, type = 'bandpass') {
  const c = _audio(); if (!c) return;
  const n = (c.sampleRate * dur) | 0, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = gain; s.connect(f); f.connect(g); g.connect(c.destination); s.start();
}
function _tone(freq, dur, gain, type, slideTo) {
  const c = _audio(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.value = gain; g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
}
export const sfxSplash = () => { _noise(0.55, 950, 0.6, 0.55, 'lowpass'); _tone(300, 0.28, 0.09, 'sine', 130); };
export const sfxStep   = () => _noise(0.07, 480, 1.4, 0.10, 'bandpass');
export const sfxJump   = () => _tone(300, 0.18, 0.12, 'triangle', 540);
export const sfxBoard  = () => { _tone(170, 0.16, 0.11, 'sine', 120); _noise(0.13, 280, 0.7, 0.14, 'lowpass'); };
