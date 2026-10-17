/* ============================================================
   physics · 页面外壳
   模块清单（唯一数据源）→ 左侧导航 / 底部标签栏 / 首页卡片 / 路由
   当前阶段：S0 外观已定稿（纸质档）。
   ============================================================ */

import { $, el, safeDecode } from './dom.js?v=19';
import { renderPhysicsList, renderDemoStage } from '../apps/physics/demos.js?v=19';
import {
  renderHwlog, bindRerender as bindHwlogRerender, primeHwlog,
} from '../apps/hwlog/hwlog.js?v=19';
import {
  renderScore, bindRerender as bindScoreRerender, primeScore,
} from '../apps/score/score.js?v=19';
import { captureSessionFromUrl, isSignedIn, currentEmail } from './supabase.js?v=19';

/* ------------------------------------------------------------
   0. 外部配置（改地址去 assets/config.js，不要改这里）
   ------------------------------------------------------------ */
const CFG = window.PHYSICS_CONFIG || {};
const PUBLISH_URL = CFG.publish?.url || '#';
const PUBLISH_EXTERNAL = CFG.publish?.external !== false;
const LINKS = Array.isArray(CFG.links) ? CFG.links : [];

/* ------------------------------------------------------------
   1. 模块清单 —— 导航、卡片、路由全部由这里生成
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   1. 模块清单 —— 导航、卡片、路由全部由这里生成
   ------------------------------------------------------------
   注：物理演示与杂项的页面不在 ROUTES 里由循环生成，
       而是在下面 ROUTES 中单独注册（否则会被占位页覆盖）。
   ------------------------------------------------------------ */
const MODULES = [
  {
    id: 'physics', no: '01', path: '#/physics',
    name: '物理过程演示', short: '演示', tag: 'S1',
    store: 'GitHub 仓库',
    desc: '追及相遇、匀变速运动的动态演示，与 v–t / x–t 图像同步。',
    meta: { state: 'ok', mark: '●', text: '放进仓库目录就自动出现' },
    cta: '打开演示',
    note: '课堂上用：参数可调、可单步、可慢放。演示文件放在仓库的 apps/physics/demos/ 里，'
        + '页面打开时自动列目录，加文件不用改代码。',
  },
  {
    id: 'publish', no: '02',
    path: PUBLISH_URL, external: PUBLISH_EXTERNAL,
    name: '作业发布', short: '发布', tag: '',
    store: 'Gitee',
    desc: '2 班 / 6 班的每日作业，学生打开链接即可看，不需要登录。',
    meta: { state: 'ok', mark: '●', text: '沿用现有线上地址' },
    cta: '去发布',
    note: '本模块不搬进来，直接跳转到现有网站 —— 学生手里的书签和二维码继续有效。',
  },
  {
    id: 'hwlog', no: '03', path: '#/hwlog',
    name: '作业登记', short: '作业', tag: 'S3',
    store: 'Supabase',
    desc: '花名册打钩录入，未交名单一键复制，连续未交自动标出。',
    meta: { state: 'warn', mark: '◐', text: '本地版已有，待搬到云端' },
    cta: '建班级',
    note: '本地版（backup/作业登记系统）已经在用，搬到云端后多设备可用、可上传历史 Excel。',
  },
  {
    id: 'score', no: '04', path: '#/score',
    name: '成绩归档', short: '成绩', tag: 'S4',
    store: '私有存储',
    desc: '按学期 / 考试分级归档学情分析，随时翻出来看。',
    meta: { state: 'ok', mark: '●', text: '分级目录 + 私有存储' },
    cta: '打开归档',
    note: '只做「存 · 找 · 看」：把你生成好的学情分析传上来按学期分目录留档，'
        + '不再散在文件夹里。报告含学生姓名分数，走的是私有存储桶，只有登录后你自己能看。',
  },
  {
    id: 'misc', no: '05', path: '#/misc',
    name: '杂项', short: '杂项', tag: '',
    store: '外链集合',
    desc: '大巴点名表、以及以后各种零散的工具和页面，都放这儿。',
    meta: { state: 'ok', mark: '●', text: `${LINKS.length} 个链接` },
    cta: '打开',
    note: '新链接写在 assets/config.js 的 links 数组里，加一条就多一行，不用改别的代码。',
  },
];

const HOME_NAV = { no: '00', path: '#/', name: '工作台', short: '工作台' };
const MORE_NAV = { no: '', path: '#/more', name: '更多', short: '更多' };
const EXTRA_NAV = [{ no: '', path: '#/settings', name: '设置', short: '设置' }];

/* 手机底栏容量有限：超过这个数就折叠成「更多」，
   以后加板块不会把底栏挤爆。 */
const TAB_MAX = 4;

/* ------------------------------------------------------------
   2. 环境状态
   ------------------------------------------------------------ */
const ENV_STATUS = [
  { mark: '●', state: 'ok',  label: '本机存储', value: '可用' },
  { mark: '○', state: 'off', label: 'Supabase', value: '未连接' },
  { mark: '●', state: 'ok',  label: '作业发布', value: '沿用现有地址' },
];

const BUILD = { stage: 'S0 外观定稿', version: 'v0.4' };

/* ------------------------------------------------------------
   3. 小工具
   ------------------------------------------------------------ */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatToday(d = new Date()) {
  return {
    full: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    week: `星期${WEEKDAYS[d.getDay()]}`,
    iso: d.toISOString().slice(0, 10),
  };
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '');
  const clean = raw.split('?')[0];
  return clean.startsWith('/') ? clean : `/${clean}`;
}

let toastTimer = null;
function toast(msg) {
  const box = $('#toast');     // ⚠️ 别叫 el —— 会遮蔽上面 import 进来的 el()
  if (!box) return;
  box.textContent = msg;
  box.dataset.show = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.dataset.show = '0'; }, 3200);
}

/** 路由片段（已解码）：'#/physics/abc.html' → ['physics','abc.html'] */
function parseSegments() {
  return parseRoute().split('/').filter(Boolean).map(safeDecode);
}

/** 状态标记：● 就绪 / ◐ 待配置 / ○ 未启用 */
function marker(state, mark) {
  const s = el('span', 'mk', mark || '○');
  s.dataset.state = state;
  s.setAttribute('aria-hidden', 'true');
  return s;
}

/** 小节标题：名称 + 计数 + 一条撑满的细线 */
function section(title, count) {
  const s = el('div', 'sect');
  s.appendChild(el('h2', null, title));
  if (count != null) s.appendChild(el('span', 'cnt', String(count)));
  s.appendChild(el('span', 'rule'));
  return s;
}

/** 一行链接 —— 名称 / 说明 / 网址 / 箭头，整行可点 */
function linkRow(item) {
  const a = el('a', 'linkrow');
  a.href = item.path || item.url;
  if (!item.path) { a.target = '_blank'; a.rel = 'noopener'; }
  a.appendChild(el('span', 'link-name', item.name));
  a.appendChild(el('span', 'link-desc', item.desc || ''));
  const u = item.path ? (item.path) : String(item.url || '').replace(/^https?:\/\//, '');
  a.appendChild(el('span', 'link-url', u));
  a.appendChild(el('span', 'link-go', item.path ? '→' : '↗'));
  return a;
}

/* ------------------------------------------------------------
   4. 导航
   ------------------------------------------------------------ */
function mainNav() {
  return [HOME_NAV, ...MODULES, ...EXTRA_NAV];
}

/** 手机底栏：模块太多就折叠成「更多」，避免以后加板块挤爆 */
function tabbarNav() {
  if (MODULES.length <= TAB_MAX) return mainNav();
  return [HOME_NAV, ...MODULES.slice(0, TAB_MAX), MORE_NAV];
}

function navLink(m, withIdx) {
  const a = el('a', withIdx ? 'navlink' : null);
  a.href = m.path;
  if (m.external) { a.target = '_blank'; a.rel = 'noopener'; }
  if (withIdx) a.appendChild(el('span', 'idx', m.no));
  a.appendChild(el('span', null, withIdx ? m.name : (m.short || m.name)));
  return a;
}

function renderNav() {
  const rail = $('#rail');
  const tabbar = $('#tabbar');

  rail.innerHTML = '';
  rail.appendChild(el('div', 'rail-label', '模块'));
  for (const m of mainNav()) rail.appendChild(navLink(m, true));

  const foot = el('div', 'rail-foot');
  foot.innerHTML = `${BUILD.stage}<br>版本 ${BUILD.version}`;
  rail.appendChild(foot);

  tabbar.innerHTML = '';
  for (const m of tabbarNav()) tabbar.appendChild(navLink(m, false));
}

function syncNav() {
  const here = parseRoute();
  document.querySelectorAll('.rail .navlink, .tabbar a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('http')) { a.removeAttribute('aria-current'); return; }
    if (href.replace(/^#/, '') === here) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ------------------------------------------------------------
   5. 首页
   ------------------------------------------------------------ */
function cardView(m) {
  const a = el('a', 'card');
  a.href = m.path;
  if (m.external) { a.target = '_blank'; a.rel = 'noopener'; }

  a.appendChild(el('span', 'card-no', m.no));
  a.appendChild(el('h2', 'card-title', m.name));
  a.appendChild(el('p', 'card-desc', m.desc));

  const meta = el('div', 'card-meta');
  meta.appendChild(marker(m.meta.state, m.meta.mark));
  const t = el('span');
  t.innerHTML = `<b>${m.meta.text}</b>`;
  meta.appendChild(t);
  a.appendChild(meta);

  const foot = el('div', 'card-foot');
  const cta = el('span', 'card-cta', m.cta);
  if (m.external) cta.appendChild(el('span', 'ext', '↗'));
  foot.appendChild(cta);
  foot.appendChild(el('span', 'card-store', m.tag ? `${m.tag} · ${m.store}` : m.store));
  a.appendChild(foot);

  return a;
}

function pageHead(title, sub) {
  const head = el('div', 'page-head');
  head.appendChild(el('h1', null, title));
  head.appendChild(el('p', 'page-sub', sub));
  return head;
}

/** 幽灵格：把最后一行补满。
    —— 网格是「1px 缝隙连成的台账表格」，底色是线色；
       最后一行缺格时，那块底色会糊成一大片土黄（踩过）。
    补成 4 的倍数即可同时被 4 列和 2 列整除；1 列时（≤700px）被 CSS 隐藏。 */
function ghostCells() {
  const n = (4 - (MODULES.length % 4)) % 4;
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = el('div', 'card card-ghost');
    g.setAttribute('aria-hidden', 'true');
    out.push(g);
  }
  return out;
}

function renderHome() {
  const frag = document.createDocumentFragment();
  const today = formatToday();

  frag.appendChild(pageHead('工作台', `${today.full} ${today.week} · 高一 2 班 / 6 班`));

  const status = el('div', 'status');
  for (const s of ENV_STATUS) {
    const item = el('div', 'status-item');
    item.appendChild(marker(s.state, s.mark));
    const span = el('span');
    span.innerHTML = `${s.label} <b>${s.value}</b>`;
    item.appendChild(span);
    status.appendChild(item);
  }
  frag.appendChild(status);

  const grid = el('div', 'grid');
  for (const m of MODULES) grid.appendChild(cardView(m));
  for (const g of ghostCells()) grid.appendChild(g);
  frag.appendChild(grid);

  return frag;
}

/* ------------------------------------------------------------
   6. 杂项页 —— 零散外链
   ------------------------------------------------------------ */
function renderMisc() {
  const frag = document.createDocumentFragment();

  frag.appendChild(pageHead('杂项', '零散的工具和页面，放一起。'));
  frag.appendChild(section('站外链接', LINKS.length));

  const list = el('div', 'linklist');
  if (LINKS.length) {
    for (const it of LINKS) list.appendChild(linkRow(it));
  } else {
    const empty = el('div', 'linkadd');
    empty.appendChild(el('span', 'why', '还没有链接。'));
    list.appendChild(empty);
  }

  const add = el('div', 'linkadd');
  add.appendChild(el('span', 'mk', '＋'));
  add.appendChild(el('span', 'why', '「在首页加板块」的功能会随 Supabase 一起做，那时这里也能直接加'));
  list.appendChild(add);
  frag.appendChild(list);

  return frag;
}

/* ------------------------------------------------------------
   7. 更多页 —— 手机底栏折叠后的去处
   ------------------------------------------------------------ */
function renderMore() {
  const frag = document.createDocumentFragment();
  frag.appendChild(pageHead('更多', '全部模块和系统设置。'));

  frag.appendChild(section('模块', MODULES.length));
  const mlist = el('div', 'linklist');
  for (const m of MODULES) {
    mlist.appendChild(linkRow({
      name: m.name, desc: m.desc,
      path: m.external ? null : m.path,
      url: m.external ? m.path : null,
    }));
  }
  frag.appendChild(mlist);

  frag.appendChild(section('系统'));
  const slist = el('div', 'linklist');
  slist.appendChild(linkRow({ name: '设置', desc: '班级与花名册、数据导出、账号登录', path: '#/settings' }));
  frag.appendChild(slist);

  return frag;
}

/* ------------------------------------------------------------
   8. 占位页
   ------------------------------------------------------------ */
function placeholderBox(no, title, desc, note) {
  const box = el('div', 'placeholder');
  box.appendChild(el('span', 'ph-no', no));
  box.appendChild(el('h1', null, title));
  box.appendChild(el('p', null, desc));
  const n = el('p', 'ph-note');
  n.innerHTML = note;
  box.appendChild(n);

  const back = el('a', 'btn btn-primary', '← 返回工作台');
  back.href = '#/';
  box.appendChild(back);
  return box;
}

function renderPlaceholder(mod) {
  const frag = document.createDocumentFragment();
  frag.appendChild(mod
    ? placeholderBox(
        `模块 ${mod.no}`,
        mod.name,
        mod.desc,
        `${mod.note}<br>该模块排在 <b>${mod.tag || 'S5'}</b>，尚未开始实现。`)
    : placeholderBox('未知模块', '页面不存在', '这个地址没有对应的页面。', '检查一下地址，或者回到工作台。'));
  return frag;
}

function renderSettings() {
  const frag = document.createDocumentFragment();
  frag.appendChild(placeholderBox(
    '设置', '设置',
    '班级与花名册管理、数据导出、账号登录。',
    '班级花名册随 <b>S3</b> 作业登记一起做；登录随 <b>Supabase</b> 接入时开通（邮箱 Magic Link）。'));
  return frag;
}

/* ------------------------------------------------------------
   9. 路由
   ------------------------------------------------------------ */
const ROUTES = {
  '/': renderHome,
  '/physics': () => renderPhysicsList(CFG.repo),
  '/hwlog': () => renderHwlog([]),
  '/score': () => renderScore([]),
  '/misc': renderMisc,
  '/more': renderMore,
  '/settings': renderSettings,
};
const TITLES = {
  '/': '工作台', '/physics': '物理过程演示', '/hwlog': '作业登记', '/score': '成绩归档',
  '/misc': '杂项', '/more': '更多', '/settings': '设置',
};

// 外链模块（作业发布）不进路由表；
// ⚠️ 已有专页的模块（物理演示、杂项）也必须跳过 —— 否则会被占位页覆盖掉（踩过）。
for (const m of MODULES) {
  if (m.external || ROUTES[`/${m.id}`]) continue;
  ROUTES[`/${m.id}`] = () => renderPlaceholder(m);
  TITLES[`/${m.id}`] = m.name;
}

/** 顶栏登录按钮跟着登录态走。放在 render() 末尾调用 ——
    会话可能在任何一次请求里被清掉（401），按钮要跟着变。 */
function paintLogin() {
  const btn = $('#btn-login');
  if (!btn) return;
  btn.textContent = isSignedIn() ? (currentEmail().split('@')[0] || '已登录') : '登录';
  btn.title = isSignedIn() ? currentEmail() + '（点击去作业登记）' : '邮箱 Magic Link 登录';
}

function render() {
  const path = parseRoute();
  const segs = parseSegments();
  const main = $('#main');

  main.innerHTML = '';

  // 演示文件的站内视图：'#/physics/<文件名>'
  if (segs[0] === 'physics' && segs[1]) {
    main.appendChild(renderDemoStage(CFG.repo, segs[1]));
    document.title = `${segs[1]} · physics`;
    syncNav();
    paintLogin();
    return;
  }

  // 作业登记（含子路由，交给模块自己分派）
  if (segs[0] === 'hwlog') {
    main.appendChild(renderHwlog(segs));
    document.title = '作业登记 · physics';
    syncNav();
    paintLogin();
    // 已登录且本会话还没拉过数据 → 拉一次，拿到后重绘
    primeHwlog().then((changed) => { if (changed) { render(); } });
    return;
  }

  // 成绩归档（目录树 + 私有存储，同样交给模块分派）
  if (segs[0] === 'score') {
    main.appendChild(renderScore(segs));
    document.title = '成绩归档 · physics';
    syncNav();
    paintLogin();
    primeScore().then((changed) => { if (changed) { render(); } });
    return;
  }

  const view = ROUTES[path];
  main.appendChild(view ? view() : renderPlaceholder(null));

  document.title = `${TITLES[path] || '页面不存在'} · physics`;
  syncNav();
  paintLogin();
}

/* ------------------------------------------------------------
   10. 启动
   ------------------------------------------------------------ */
function boot() {
  bindHwlogRerender(render);
  bindScoreRerender(render);

  const today = formatToday();
  const dateEl = $('#top-date');
  if (dateEl) {
    dateEl.innerHTML =
      `<time datetime="${today.iso}">${today.full}</time><span class="wk">${today.week}</span>`;
  }

  renderNav();

  const login = $('#btn-login');
  paintLogin();

  /**
   * 收 Magic Link 回跳带的 token。
   * 🔴 两个时机都要调用：
   *    ① 首次加载 —— 从邮件客户端点链接过来，是一次真正的页面加载
   *    ② hashchange —— 如果 Magic Link 是在**已开着的标签页**里打开的，
   *       那只是一次同文档 hash 变化，**浏览器不会重新加载、boot() 不会再跑**，
   *       不在这里再收一次，token 就白白丢了。
   *    收成功后 replaceState 把 token 从地址栏抹掉（replaceState 不触发
   *    hashchange，所以不会死循环），再落到作业登记页。
   */
  function handleAuthRedirect() {
    const cap = captureSessionFromUrl();
    if (cap.ok) toast('登录成功：' + cap.email);
    else if (cap.error) toast('登录链接有问题：' + cap.error);
    else return false;

    history.replaceState(null, '', location.pathname + location.search + '#/hwlog');
    paintLogin();
    return true;
  }

  handleAuthRedirect();

  render();
  paintLogin();

  window.addEventListener('hashchange', () => {
    handleAuthRedirect();
    render();
  });

  if (login) {
    login.addEventListener('click', () => {
      location.hash = '#/hwlog';
      if (!isSignedIn()) toast('用邮箱和密码登录；第一次用点「创建账号」。');
    });
  }
}

boot();
