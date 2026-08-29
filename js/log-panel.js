// 战报面板升级：分类标签 + 类别过滤 + 关键字搜索 + 折叠
// 只做表现层；无 DOM / mock 环境（node 冒烟测试）下全部降级为空操作。

const TAG_LABEL = {
  money: '💰 资金', buy: '🏴 地产', build: '🔧 建造', rent: '💸 租金',
  event: '📻 事件', moral: '⚖ 道德', camp: '📖 章节', warn: '💀 警报',
  nuke: '☢ 核弹', sys: '系统',
};

const KIND_ORDER = ['money', 'buy', 'build', 'rent', 'event', 'moral', 'camp', 'warn', 'nuke', 'sys'];

let mutedKinds = new Set();   // 被屏蔽的类别；空集 = 全部显示
let searchText = '';
let logEl = null, barEl = null, foldBtn = null;
const chipEls = {};

function isEl(el) {
  return el && typeof el === 'object' && el.classList
    && typeof el.classList.add === 'function' && typeof el.classList.toggle === 'function';
}

/** 单条战报的类别小标签 */
export function makeLogTag(kind) {
  if (typeof document === 'undefined') return null;
  const s = document.createElement('span');
  const k = kind || 'sys';
  s.className = 'logTag logTag-' + k;
  s.textContent = TAG_LABEL[k] || TAG_LABEL.sys;
  return s;
}

/** 按当前过滤条件显隐单条战报（log() 追加时同步调用） */
export function applyEntryFilter(d) {
  if (!isEl(d)) return;
  const kind = (d.dataset && d.dataset.kind) || 'sys';
  const okKind = !mutedKinds.has(kind);      // chip 语义：点亮=显示，点掉=屏蔽该类别
  const text = String((d.dataset && d.dataset.text) || '').toLowerCase();
  const okText = !searchText || text.includes(searchText);
  d.classList.toggle('logHidden', !(okKind && okText));
}

function refilterAll() {
  if (!logEl || !logEl.children || !logEl.children.length) return;
  Array.from(logEl.children).forEach(applyEntryFilter);
}

function syncChips() {
  const all = !mutedKinds.size;
  if (isEl(barEl)) barEl.classList.toggle('logAllMode', all);
  KIND_ORDER.forEach(k => {
    const c = chipEls[k];
    if (isEl(c)) c.classList.toggle('on', !mutedKinds.has(k));
  });
}

export function initLogPanel() {
  if (typeof document === 'undefined' || barEl) return;
  logEl = document.getElementById('log');
  // mock DOM 中 parentNode 缺失：静默跳过，不影响主流程
  if (!logEl || !logEl.parentNode || typeof logEl.parentNode.insertBefore !== 'function') return;

  barEl = document.createElement('div');
  barEl.id = 'logBar';
  barEl.className = 'logBar';

  const head = document.createElement('div');
  head.className = 'logHead';

  const chips = document.createElement('div');
  chips.className = 'logChips';
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'logChip logChipAll on';
  allChip.textContent = '全部';
  allChip.onclick = () => { mutedKinds.clear(); syncChips(); refilterAll(); };
  chips.appendChild(allChip);
  KIND_ORDER.forEach(k => {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'logChip on';
    c.textContent = TAG_LABEL[k];
    c.onclick = () => {
      if (mutedKinds.has(k)) mutedKinds.delete(k); else mutedKinds.add(k);
      syncChips(); refilterAll();
    };
    chipEls[k] = c;
    chips.appendChild(c);
  });
  head.appendChild(chips);

  foldBtn = document.createElement('button');
  foldBtn.type = 'button';
  foldBtn.className = 'logChip logFold';
  foldBtn.textContent = '▾ 折叠';
  foldBtn.onclick = () => {
    const collapsed = !barEl.classList.contains('collapsed');
    barEl.classList.toggle('collapsed', collapsed);
    logEl.classList.toggle('logCollapsed', collapsed);
    foldBtn.textContent = collapsed ? '▸ 展开战报' : '▾ 折叠';
  };
  head.appendChild(foldBtn);
  barEl.appendChild(head);

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'logSearch';
  search.placeholder = '🔍 搜索战报…';
  if (typeof search.addEventListener === 'function') {
    search.addEventListener('input', () => {
      searchText = String(search.value || '').trim().toLowerCase();
      refilterAll();
    });
  }
  barEl.appendChild(search);

  logEl.parentNode.insertBefore(barEl, logEl);
  syncChips();
}
