#!/usr/bin/env node
// 独立 Node 进程跑 Kokoro，避开 Electron 主进程卡住 / IPC 丢大数组
import { init, speak } from './kokoro-node.js';

let chain = Promise.resolve();

function reply(msg) {
  if (typeof process.send === 'function') process.send(msg);
}

process.on('message', (msg) => {
  chain = chain.then(() => handle(msg)).catch((e) => {
    reply({ id: msg && msg.id, ok: false, error: String(e && e.message || e) });
  });
});

async function handle(msg) {
  const id = msg && msg.id;
  if (msg.cmd === 'init') {
    const info = await init();
    reply({ id, ...info });
    return;
  }
  if (msg.cmd === 'speak') {
    const r = await speak(msg.text, { ...(msg.opts || {}), includePcm: false });
    if (!r || !r.wav) {
      reply({ id, ok: false, error: 'speak 空结果' });
      return;
    }
    reply({
      id,
      ok: true,
      sampleRate: r.sampleRate,
      voice: r.voice,
      sid: r.sid,
      wav: Buffer.from(r.wav),
    });
    return;
  }
  reply({ id, ok: false, error: 'unknown cmd' });
}
