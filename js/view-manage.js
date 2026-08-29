// 资产面板与交易
import { G } from './state.js';
import { TILES } from './data.js';
import {
  mortgage, unmortgage, aiTradeAccept, netWorth
} from './rules.js';
import { afterHumanAction } from './game.js';
import { sfx } from './audio.js';
import { render, log } from './view-core.js';
import { openModal, closeModal } from './view-modal.js';
import { escapeHtml } from './view-util.js';

export function renderManage() {
  const p = G.turnPlayer; if (!p) return;
  const owned = TILES.filter(t => (t.type === 'prop' || t.type === 'rail' || t.type === 'util') && t.owner === p.id);
  let html = `<h2>资产管理 // ${escapeHtml(p.name)}</h2>`;
  html += `<div class="nw">净身家 ${netWorth(p)} 盖 · 现金 ${p.caps} 盖</div>`;
  html += `<div style="margin:8px 0;border-top:1px solid var(--line);padding-top:8px"><b style="color:var(--amber)">抵押 / 赎回</b><br>`;
  if (owned.length === 0) html += '<div style="font-size:11px;color:var(--dim)">暂无资产</div>';
  owned.forEach(t => {
    const mv = Math.floor(t.price / 2), um = Math.floor(t.price * 0.55);
    if (t.mortgaged) html += `<div class="row" style="margin:4px 0"><span>${escapeHtml(t.name)} <span style="color:var(--gang)">[抵押中]</span></span><button class="alt" id="um${t.id}" ${p.caps < um ? 'disabled' : ''}>赎回(${um})</button></div>`;
    else html += `<div class="row" style="margin:4px 0"><span>${escapeHtml(t.name)} L${t.level}</span><button class="alt" id="mg${t.id}" ${t.level > 0 ? 'disabled' : ''}>抵押(+${mv})</button></div>`;
  });
  html += `</div>`;
  const others = G.players.filter(x => x.id !== p.id && !x.bankrupt);
  if (others.length) {
    const wpOpts = others.flatMap(o => TILES.filter(t => t.type === 'prop' && t.owner === o.id)
      .map(t => `<option value="${t.id}">${o.short}:${escapeHtml(t.name)}${t.mortgaged ? '(押)' : ''}</option>`)).join('');
    html += `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:8px"><b style="color:var(--amber)">发起交易</b><br>`;
    html += `目标 <select id="trg">${others.map(o => `<option value="${o.id}">${escapeHtml(o.name)}${o.isAI ? ' 🤖' : ''}</option>`).join('')}</select><br>`;
    html += `<div style="margin-top:6px">你给出：<select id="gp"><option value="">（无地块）</option>${owned.map(t => `<option value="${t.id}">${escapeHtml(t.name)}${t.mortgaged ? '(押)' : ''}</option>`).join('')}</select> + <input id="gc" type="number" value="0" style="width:60px">盖</div>`;
    html += `<div style="margin-top:6px">换回：<select id="wp"><option value="">（无地块）</option>${wpOpts}</select> + <input id="wc" type="number" value="0" style="width:60px">盖</div>`;
    html += `<div id="modalActions" style="margin-top:10px"><button id="prop">提议</button><button class="alt" id="cls">关闭</button></div></div>`;
  } else {
    html += `<div id="modalActions" style="margin-top:10px"><button class="alt" id="cls">关闭</button></div>`;
  }
  openModal(html);
  owned.forEach(t => {
    if (t.mortgaged) { const el = document.getElementById('um' + t.id); if (el) el.onclick = () => { unmortgage(p, t); renderManage(); }; }
    else { const el = document.getElementById('mg' + t.id); if (el) el.onclick = () => { mortgage(p, t); renderManage(); }; }
  });
  const cls = document.getElementById('cls'); if (cls) cls.onclick = () => { closeModal(); afterHumanAction(p); };
  const prop = document.getElementById('prop'); if (prop) prop.onclick = proposeTrade;
}

export function proposeTrade() {
  const a = G.turnPlayer;
  const b = G.players[+document.getElementById('trg').value];
  const gp = document.getElementById('gp').value;
  const gc = +document.getElementById('gc').value || 0;
  const wp = document.getElementById('wp').value;
  const wc = +document.getElementById('wc').value || 0;
  const aProps = gp !== '' ? [TILES[+gp]] : [];
  const bProps = wp !== '' ? [TILES[+wp]] : [];
  if (bProps.length && bProps[0].owner !== b.id) { alert('换回地块不属于该目标'); return; }
  if (aProps.some(t => t.owner !== a.id) || bProps.some(t => t.owner !== b.id)) { alert('资产归属错误'); return; }
  if (a.caps < gc || b.caps < wc) { alert('瓶盖不足'); return; }
  if ((aProps.length === 0 && gc <= 0) || (bProps.length === 0 && wc <= 0)) { alert('交易不能两边都为空'); return; }
  const trade = { a, b, aProps, gc, bProps, wc };
  if (b.isAI) {
    if (aiTradeAccept(b, aProps, gc, bProps, wc)) { applyTrade(trade); closeModal(); afterHumanAction(a); }
    else alert('对方拒绝了交易');
  } else {
    openModal(`<h2>玩家${b.short} 是否接受交易？</h2>
      <div style="font-size:12px;line-height:1.8">
      ${escapeHtml(a.name)} 给出：${aProps.map(t => escapeHtml(t.name)).join('、') || '无'}${gc ? (' +' + gc + '盖') : ''}<br>
      ${escapeHtml(b.name)} 给出：${bProps.map(t => escapeHtml(t.name)).join('、') || '无'}${wc ? (' +' + wc + '盖') : ''}
      </div>
      <div id="modalActions" style="margin-top:12px"><button id="acc">接受</button><button class="alt" id="rej">拒绝</button></div>`);
    document.getElementById('acc').onclick = () => { applyTrade(trade); closeModal(); afterHumanAction(a); };
    document.getElementById('rej').onclick = () => { closeModal(); renderManage(); };
  }
}

export function applyTrade(tr) {
  const { a, b, aProps, gc, bProps, wc } = tr;
  a.caps -= gc; b.caps += gc; b.caps -= wc; a.caps += wc;
  aProps.forEach(t => t.owner = b.id);
  bProps.forEach(t => t.owner = a.id);
  log(`交易成交：${a.name} ↔ ${b.name}`, true); sfx('buy'); render();
}
