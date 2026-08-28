// WebAudio 合成音效（无外部音频文件）
let AC = null;
let muted = false;
function ac() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type = 'square', vol = 0.07, when = 0) {
  const a = ac(); if (!a || muted) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(a.destination);
  const t = a.currentTime + when;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur);
}
function noise(dur, vol = 0.04, when = 0) {
  const a = ac(); if (!a || muted) return;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
  const n = a.createBufferSource(); n.buffer = buf;
  const g = a.createGain();
  const t = a.currentTime + when;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(g); g.connect(a.destination);
  n.start(t); n.stop(t + dur);
}

/** 导弹井发射序列：密钥确认蜂鸣 + 上升呼啸 */
function sfxNukeLaunch() {
  tone(180, 0.12, 'sine', 0.05, 0);
  tone(240, 0.12, 'sine', 0.05, 0.14);
  tone(320, 0.14, 'square', 0.045, 0.28);
  tone(480, 0.18, 'triangle', 0.04, 0.42);
  noise(0.35, 0.035, 0.55);
  for (let i = 0; i < 10; i++) {
    tone(120 + i * 55, 0.07, 'sawtooth', 0.028, 0.62 + i * 0.05);
  }
  noise(0.5, 0.05, 0.9);
  tone(880, 0.08, 'square', 0.03, 1.05);
}

/** 核爆：低频冲击 + 白噪声火球 + 余震 */
function sfxNukeStrike() {
  tone(42, 1.1, 'sine', 0.11, 0);
  tone(68, 0.85, 'sawtooth', 0.07, 0.04);
  tone(28, 1.6, 'triangle', 0.09, 0.08);
  noise(1.4, 0.13, 0);
  noise(0.9, 0.08, 0.25);
  noise(0.6, 0.05, 0.55);
  noise(0.45, 0.035, 0.85);
  for (let i = 0; i < 4; i++) tone(90 - i * 12, 0.25, 'sawtooth', 0.04 - i * 0.006, 0.35 + i * 0.22);
}

export function sfx(n) {
  if (muted) return;
  switch (n) {
    case 'roll': noise(0.08, 0.03); break;
    case 'tick': tone(200 + Math.random() * 80, 0.04, 'square', 0.025); break;
    case 'buy': tone(620, 0.08, 'square', 0.07); tone(940, 0.1, 'square', 0.05, 0.06); break;
    case 'rent': tone(300, 0.12, 'sawtooth', 0.06); tone(170, 0.14, 'sawtooth', 0.05, 0.09); break;
    case 'event': tone(480, 0.1, 'triangle', 0.06); break;
    case 'bad': tone(130, 0.28, 'sawtooth', 0.08); break;
    case 'good': tone(680, 0.1, 'triangle', 0.06); tone(1020, 0.12, 'triangle', 0.05, 0.07); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.32, 'square', 0.06, i * 0.12)); break;
    case 'nukeLaunch': sfxNukeLaunch(); break;
    case 'nukeStrike': sfxNukeStrike(); break;
  }
}

/** 发射前音效时长（与 launchNuke 动画对齐） */
export const NUKE_LAUNCH_SFX_MS = 1500;

export function toggleMute() {
  muted = !muted;
  const b = document.getElementById('muteBtn');
  if (b) b.textContent = muted ? '🔇' : '🔊';
}
export function isMuted() { return muted; }
