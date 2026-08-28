// ============================================================
// view-legacy.js — 遗产商店 UI
// ============================================================
import { getLegacyMeta, purchaseBonus, LEGACY_BONUSES, recordRun } from './legacy.js';
import { openModal, closeModal } from './view-modal.js';

export function showLegacyShop() {
  const meta = getLegacyMeta();

  let html = '<div class="legacyShop">';
  html += '<h2>🏪 遗产商店</h2>';
  html += `<div class="legacyPoints">遗产点：<strong>${meta.points}</strong> · 对局：${meta.totalRuns} · 最高分：${meta.bestScore}</div>`;
  html += '<div class="legacyItems">';

  for (const bonus of LEGACY_BONUSES) {
    const owned = meta.unlockedBonuses.includes(bonus.id);
    const canAfford = meta.points >= bonus.cost;
    html += `<div class="legacyItem ${owned ? 'owned' : ''} ${canAfford ? '' : 'cant'}">`
      + `<div class="liName">${bonus.name}</div>`
      + `<div class="liDesc">${bonus.desc}</div>`
      + `<div class="liCost">${owned ? '✓ 已拥有' : (canAfford ? `<button data-bonus="${bonus.id}">购买 ${bonus.cost} 点</button>` : `需要 ${bonus.cost} 点`)}</div>`
      + `</div>`;
  }

  html += '</div>';
  html += '<div class="legacyNote">遗产点通过对局获得：存活回合×1 + 章节×50 + 道德×10 + 特殊结局奖励</div>';
  html += '<button class="alt" id="legacyClose">关闭</button>';
  html += '</div>';

  openModal(html);

  // 绑定购买按钮
  const shop = document.querySelector('.legacyShop');
  if (shop) {
    shop.querySelectorAll('button[data-bonus]').forEach(btn => {
      btn.onclick = () => {
        const bonusId = btn.dataset.bonus;
        const result = purchaseBonus(bonusId);
        if (result.success) {
          showLegacyShop(); // 刷新
        } else {
          btn.textContent = result.reason === 'insufficient_points' ? '点数不足' : '已拥有';
          btn.disabled = true;
        }
      };
    });
  }
  const closeBtn = document.getElementById('legacyClose');
  if (closeBtn) closeBtn.onclick = closeModal;
}

/** 显示遗产结算界面 */
export function showLegacyResult(runResult) {
  const result = recordRun(runResult);
  const meta = result.meta;

  let html = '<div class="legacyResult">';
  html += '<h2>📜 对局结束</h2>';
  html += `<div class="lrEarned">获得 <strong>${result.pointsEarned}</strong> 遗产点</div>`;
  html += `<div class="lrTotal">总遗产点：${result.totalPoints}</div>`;
  html += `<div class="lrStats">存活回合：${runResult.turns || 0} · 道德：${runResult.moral || 0} · 章节：${runResult.chaptersCompleted || 0}</div>`;
  html += '<button class="alt" id="legacyContinue">继续</button>';
  html += '</div>';

  openModal(html);

  const btn = document.getElementById('legacyContinue');
  if (btn) btn.onclick = closeModal;
}

export { recordRun };
