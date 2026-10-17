/* ============================================================
   physics · 页面外壳
   模块清单（唯一数据源）→ 左侧导航 / 底部标签栏 / 首页卡片 / 路由
   当前阶段：S0 外观已定稿（纸质档）。
   ============================================================ */

import { $, el, safeDecode } from './dom.js?v=38';
import { renderPhysicsList, renderDemoStage } from '../apps/physics/demos.js?v=38';
import {
  renderHwlog, bindRerender as bindHwlogRerender, primeHwlog,
} from '../apps/hwlog/hwlog.js?v=38';
import {
  renderScore, bindRerender as bindScoreRerender, primeScore,
} from '../apps/score/score.js?v=38';
import { captureSessionFromUrl, isSignedIn, currentDisplayName, currentEmail } from './supabase.js?v=38';
import {
  loadLinks, customLinks, resetLinks, addLink, removeLink, normalizeUrl,
} from './links.js?v=38';
import { renderMisc, bindRerender as bindMiscRerender, primeMisc } from '../apps/misc/misc.js?v=38';
import { renderSettings as renderSettingsPage } from '../apps/settings/settings.js?v=38';
import { applyStoredTheme } from './theme.js?v=38';
import { applyOverride, setOverride, clearOverride } from './overrides.js?v=38';

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
    desc: '花名册打钩录入，未交名单一键复制，整个班导出一张表。',
    meta: { state: 'ok', mark: '●', text: '云端可用，手机也能录' },
    cta: '打开',
    note: '点一下循环切换 √→○→补→假，改动自动保存。'
        + '「未交名单」一键复制可直接贴群里，「全部已交」适合先重置再挑个别人。'
        + '数据在 Supabase，手机和电脑看到的是同一份。',
  },
  {
    id: 'score', no: '04', path: '#/score',
    name: '成绩归档', short: '成绩', tag: 'S4',
    store: '私有存储',
    desc: '按学期 / 考试分级归档学情分析，可重命名、可移动、随时翻出来看。',
    meta: { state: 'ok', mark: '●', text: '分级目录 + 私有存储' },
    cta: '打开归档',
    note: '只做「存 · 找 · 看」：把你生成好的学情分析传上来按学期分目录留档，'
        + '不再散在文件夹里。报告含学生姓名分数，走的是私有存储桶，只有登录后你自己能看。',
  },
  {
    id: 'misc', no: '05', path: '#/misc',
    name: '杂项', short: '杂项', tag: '',
    store: '外链 + 上传',
    desc: '大巴点名表、自己上传的页面、零散外链，都放这儿。',
    meta: { state: 'ok', mark: '●', text: `${LINKS.length} 个固定外链` },
    cta: '打开',
    note: '固定外链写在 assets/config.js 的 links 数组里（不登录也看得到）；'
        + '登录后还能上传 HTML、加外链，存在 Supabase 的私有桶里。',
  },
];

const HOME_NAV = { no: '00', path: '#/', name: '工作台', short: '工作台' };
const MORE_NAV = { no: '', path: '#/more', name: '更多', short: '更多' };
const EXTRA_NAV = [{ no: '', path: '#/settings', name: '设置', short: '设置' }];

/* 手机底栏容量有限：超过这个数就折叠成「更多」，
   以后加板块不会把底栏挤爆。 */
const TAB_MAX = 4;

/* ------------------------------------------------------------
   2. （已移除）环境状态 —— 挪到设置页 apps/settings/settings.js
   ------------------------------------------------------------ */
const BUILD = { stage: 'S6 加板块 · 杂项上传', version: 'v0.6' };

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
    补成 4 的倍数即可同时被 4 列和 2 列整除；1 列时（≤700px）被 CSS 隐藏。
    ⚠️ 传的是**卡片总数**（内建 + 自己加的板块），不是 MODULES.length ——
       自己加过板块之后，只按内建数量补格就补错了。 */
function ghostCells(count) {
  const n = (4 - (count % 4)) % 4;
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = el('div', 'card card-ghost');
    g.setAttribute('aria-hidden', 'true');
    out.push(g);
  }
  return out;
}

/* ------------------------------------------------------------
   自己加的板块（Supabase 的 custom_links 表）
   ------------------------------------------------------------
   🔴 只能加「站外跳转」型：一个名字 + 一个网址。
      站内应用是代码写出来的，点一下「添加」长不出来。
   ------------------------------------------------------------ */
const HOME = { addOpen: false, edit: null };   // edit = { kind:'builtin', mod } 或 { kind:'custom', link }

/** 上一次渲染时的登录态 —— 用来发现「登录了 / 退出了」，好清掉板块缓存 */
let lastSignedState = null;

/** 把一条自定义链接包装成 cardView 认识的样子（编号接着内建的往下排） */
function customCardModel(link, i) {
  return {
    no: String(MODULES.length + 1 + i).padStart(2, '0'),
    path: link.url,
    external: true,
    name: link.title,
    desc: link.note || '自己加的板块',
    meta: { state: 'ok', mark: '↗', text: '站外页面' },
    cta: '打开',
    store: '外链 · 自己加的',
    tag: '',
  };
}

/** 内建模块卡片：套 .card-wrap，右上角放一个「编辑」按钮（改标题/描述）。
    内建模块的 id/路径/跳转不能动，只有 name/desc 能改（存 localStorage）。 */
function builtinCard(m) {
  const model = applyOverride(m);
  const wrap = el('div', 'card-wrap');
  wrap.appendChild(cardView(model));

  const edit = el('button', 'card-del card-edit');
  edit.type = 'button';
  edit.title = '改标题 / 描述';
  edit.textContent = '✎';
  edit.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    HOME.edit = { kind: 'builtin', mod: m };
    render();
  });
  wrap.appendChild(edit);
  return wrap;
}

/** 编辑表单：内建（覆盖 name/desc）或自定义（改 title/note）通用 */
function editForm() {
  const e = HOME.edit;
  const isBuiltin = e.kind === 'builtin';
  const title = isBuiltin ? applyOverride(e.mod).name : e.link.title;
  const desc = isBuiltin ? applyOverride(e.mod).desc : (e.link.note || '');

  const box = el('div', 'formpanel');
  box.appendChild(el('p', 'formpanel-title', isBuiltin ? `编辑「${e.mod.name}」` : `编辑「${e.link.title}」`));

  if (isBuiltin) {
    const hint = el('p', 'formhint');
    hint.innerHTML = '只改卡片上显示的<b>标题</b>和<b>描述</b>，跳转目标不变。'
      + '改的是本机偏好（存浏览器），换设备或清缓存会还原。';
    box.appendChild(hint);
  }

  const rows = el('div', 'formrows');
  const fTitle = inputEl('');
  fTitle.value = title;
  const fDesc = inputEl('一句话说明，可空');
  fDesc.value = desc;
  rows.appendChild(fieldRow('标题', fTitle));
  rows.appendChild(fieldRow('描述', fDesc));
  box.appendChild(rows);

  const err = el('p', 'form-hint');

  const bar = el('div', 'formbar');
  const save = el('button', 'btn btn-primary');
  save.type = 'button';
  save.textContent = '保存';
  const cancel = el('button', 'btn');
  cancel.type = 'button';
  cancel.textContent = '取消';
  const close = () => { HOME.edit = null; render(); };
  cancel.addEventListener('click', close);

  save.addEventListener('click', async () => {
    const t = fTitle.value.trim();
    if (!t) { err.dataset.kind = 'bad'; err.textContent = '标题不能空着。'; fTitle.focus(); return; }
    save.disabled = true; save.textContent = '保存中…';
    err.dataset.kind = ''; err.textContent = '';
    try {
      if (isBuiltin) {
        setOverride(e.mod.id, { name: t, desc: fDesc.value });
      } else {
        const { renameLink } = await import('./links.js?v=38');
        await renameLink(e.link.id, t, fDesc.value);
      }
      HOME.edit = null;
      toast('已保存');
      render();
    } catch (err2) {
      err.dataset.kind = 'bad';
      err.textContent = '保存失败：' + err2.message;
      save.disabled = false; save.textContent = '保存';
    }
  });

  for (const inp of [fTitle, fDesc]) {
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save.click(); });
  }

  bar.appendChild(save);
  bar.appendChild(cancel);
  box.appendChild(bar);
  box.appendChild(err);
  setTimeout(() => fTitle.focus(), 0);
  return box;
}

function customCard(link, i) {
  const wrap = el('div', 'card-wrap');
  wrap.appendChild(cardView(customCardModel(link, i)));

  // 编辑按钮（✎）
  const edit = el('button', 'card-del card-edit');
  edit.type = 'button';
  edit.title = '改标题 / 描述';
  edit.textContent = '✎';
  edit.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    HOME.edit = { kind: 'custom', link };
    render();
  });
  wrap.appendChild(edit);

  // 卡片本身是 <a>，里面不能再塞 <button>（HTML 不允许交互元素嵌套），
  // 所以删除按钮做成它的**兄弟**，绝对定位压在角上。
  const del = el('button', 'card-del');
  del.type = 'button';
  del.title = '移除这个板块';
  del.textContent = '×';
  del.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (del.dataset.armed !== '1') {
      // 两步确认：第一下只是「举起手」，4 秒不点就自己收回
      del.dataset.armed = '1';
      del.textContent = '移除?';
      setTimeout(() => {
        if (del.isConnected && del.dataset.armed === '1') {
          del.dataset.armed = '';
          del.textContent = '×';
        }
      }, 4000);
      return;
    }
    del.dataset.armed = '';
    del.disabled = true;
    del.textContent = '…';
    try {
      await removeLink(link.id);
      toast('已移除「' + link.title + '」');
    } catch (e) {
      toast('移除失败：' + e.message);
    }
    render();
  });
  wrap.appendChild(del);
  return wrap;
}

function inputEl(placeholder) {
  const i = document.createElement('input');
  i.type = 'text';
  i.className = 'input';
  if (placeholder) i.placeholder = placeholder;
  return i;
}

function fieldRow(label, node) {
  const w = el('label', 'field');
  w.appendChild(el('span', 'field-label', label));
  w.appendChild(node);
  return w;
}

function addLinkForm() {
  const box = el('div', 'formpanel');
  box.appendChild(el('p', 'formpanel-title', '添加板块'));

  const hint = el('p', 'formhint');
  hint.innerHTML = '只能加<b>站外跳转</b>型板块 —— 填个名字和网址，点开就跳过去。'
    + '物理演示 / 作业登记 / 成绩归档这些站内模块不在这里加。';
  box.appendChild(hint);

  const rows = el('div', 'formrows');
  const fTitle = inputEl('例如：班级相册');
  const fUrl = inputEl('https://…（不写 https:// 也行）');
  const fDesc = inputEl('一句话说明，可空');
  rows.appendChild(fieldRow('板块名', fTitle));
  rows.appendChild(fieldRow('网址', fUrl));
  rows.appendChild(fieldRow('说明', fDesc));
  box.appendChild(rows);

  const err = el('p', 'form-hint');

  const bar = el('div', 'formbar');
  const save = el('button', 'btn btn-primary');
  save.type = 'button';
  save.textContent = '添加';
  const cancel = el('button', 'btn');
  cancel.type = 'button';
  cancel.textContent = '取消';

  const close = () => { HOME.addOpen = false; render(); };
  cancel.addEventListener('click', close);

  save.addEventListener('click', async () => {
    const t = fTitle.value.trim();
    const u = normalizeUrl(fUrl.value);
    if (!t) { err.dataset.kind = 'bad'; err.textContent = '板块名不能空着。'; fTitle.focus(); return; }
    if (!u) { err.dataset.kind = 'bad'; err.textContent = '网址填得不对，要像 https://example.com 这样。'; fUrl.focus(); return; }
    if (customLinks().some((l) => l.url === u)) {
      err.dataset.kind = 'bad'; err.textContent = '这个网址已经加过了。'; return;
    }
    save.disabled = true; save.textContent = '添加中…';
    err.dataset.kind = ''; err.textContent = '';
    try {
      await addLink({ title: t, url: u, note: fDesc.value });
      HOME.addOpen = false;
      toast('已添加「' + t + '」');
      render();
    } catch (e) {
      err.dataset.kind = 'bad';
      err.textContent = '添加失败：' + e.message;
      save.disabled = false; save.textContent = '添加';
    }
  });

  // 回车 = 添加，别逼人去找按钮
  for (const inp of [fTitle, fUrl, fDesc]) {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  }

  bar.appendChild(save);
  bar.appendChild(cancel);
  box.appendChild(bar);
  box.appendChild(err);

  setTimeout(() => fTitle.focus(), 0);
  return box;
}

function homeAddRow() {
  const box = el('div', 'linklist homeadd');
  const b = el('button', 'linkadd linkadd-btn');
  b.type = 'button';

  if (!isSignedIn()) {
    b.appendChild(el('span', 'mk', '○'));
    b.appendChild(el('span', 'why', '登录后可以在这里加自己的板块'));
    b.addEventListener('click', () => {
      location.hash = '#/hwlog';
      toast('先登录，然后回来这里加板块。');
    });
  } else {
    b.appendChild(el('span', 'mk', '＋'));
    b.appendChild(el('span', 'why', HOME.addOpen ? '收起' : '添加板块'));
    if (customLinks().length) {
      b.appendChild(el('span', 'homeadd-n', `已有 ${customLinks().length} 个自己加的`));
    }
    b.addEventListener('click', () => { HOME.addOpen = !HOME.addOpen; render(); });
  }
  box.appendChild(b);
  return box;
}

function renderHome() {
  const frag = document.createDocumentFragment();
  const today = formatToday();

  frag.appendChild(pageHead('工作台', `${today.full} ${today.week} · 高一 2 班 / 6 班`));

  const mine = customLinks();
  const grid = el('div', 'grid');
  for (const m of MODULES) grid.appendChild(builtinCard(m));
  mine.forEach((l, i) => grid.appendChild(customCard(l, i)));
  for (const g of ghostCells(MODULES.length + mine.length)) grid.appendChild(g);
  frag.appendChild(grid);

  frag.appendChild(homeAddRow());
  if (HOME.addOpen && isSignedIn()) frag.appendChild(addLinkForm());
  if (HOME.edit) frag.appendChild(editForm());

  return frag;
}

/* ------------------------------------------------------------
   6. 杂项页 —— 已搬到 apps/misc/misc.js
   ------------------------------------------------------------
   站外链接在 assets/config.js 的 links 数组里；
   「我上传的」在 Supabase（misc_items + 私有桶 misc）。
   ------------------------------------------------------------ */

/* ------------------------------------------------------------
   7. 更多页 —— 手机底栏折叠后的去处
   ------------------------------------------------------------ */
function renderMore() {
  const frag = document.createDocumentFragment();
  frag.appendChild(pageHead('更多', '全部模块和系统设置。'));

  frag.appendChild(section('模块', MODULES.length));
  const mlist = el('div', 'linklist');
  for (const raw of MODULES) {
    const m = applyOverride(raw);
    mlist.appendChild(linkRow({
      name: m.name, desc: m.desc,
      path: m.external ? null : m.path,
      url: m.external ? m.path : null,
    }));
  }
  frag.appendChild(mlist);

  // 自己加的板块（只在这里列一遍，手机底栏不占位）
  const mine = customLinks();
  if (mine.length) {
    frag.appendChild(section('自己加的板块', mine.length));
    const clist = el('div', 'linklist');
    for (const l of mine) {
      clist.appendChild(linkRow({ name: l.title, desc: l.note || '', url: l.url }));
    }
    frag.appendChild(clist);
  }

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
  return renderSettingsPage({ rerender: render });
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
  btn.textContent = isSignedIn() ? (currentDisplayName() || '已登录') : '登录';
  btn.title = isSignedIn() ? `${currentEmail()} · 点击去设置` : '邮箱 + 密码登录';
}

function render() {
  const path = parseRoute();
  const segs = parseSegments();
  const main = $('#main');

  // 登录态变了（登录 / 退出 / 令牌失效被清）→ 自己加的板块要重新取，
  // 换账号时绝不能还挂着上一个人的板块。
  if (isSignedIn() !== lastSignedState) {
    lastSignedState = isSignedIn();
    resetLinks();
    HOME.addOpen = false;
  }

  // 自己加的板块：还没取过就取一次，拿到后重绘。
  // loadLinks 内部有 loaded 闸门，失败也只算一次，不会变成重试循环。
  loadLinks().then((changed) => { if (changed) render(); });

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

  // 杂项（含 '#/misc/~view/<id>' 预览，交给模块分派）
  if (segs[0] === 'misc') {
    main.appendChild(renderMisc(segs));
    document.title = '杂项 · physics';
    syncNav();
    paintLogin();
    primeMisc().then((changed) => { if (changed) { render(); } });
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
  bindMiscRerender(render);

  // 主题要在第一次渲染前恢复，否则会闪一下默认浅色
  applyStoredTheme();

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
      // 已登录 → 去设置（能改名字/密码/外观）；未登录 → 去作业登记触发登录
      location.hash = isSignedIn() ? '#/settings' : '#/hwlog';
      if (!isSignedIn()) toast('用邮箱和密码登录；第一次用点「创建账号」。');
    });
  }
}

boot();
