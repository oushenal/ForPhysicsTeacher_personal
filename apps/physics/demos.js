/* ============================================================
   physics · 物理过程演示（apps/physics）
   ------------------------------------------------------------
   取件方式：页面打开时调 GitHub Contents API **自动列目录**
   → 往仓库的 apps/physics/demos/ 里扔一个 .html 就自动出现，
     **不用改任何代码、不用维护索引文件**。

   三层兜底（顺序固定，不能颠倒）：
     ① GitHub API    最新，能发现刚上传的文件
     ② demos.json    同源，跟站点同寿命（GitHub 连不上时顶上）
     ③ localStorage  上次成功的结果（断网时还能看清单）
   ① 必须排第一 —— 否则新加的文件会被旧清单挡住，
   "放进去就能看"这个承诺就废了。

   开关与路径在 assets/config.js 的 repo 段。
   ============================================================ */
import { el, safeDecode } from '../../assets/dom.js?v=15';

export const DEMO_DIR = 'apps/physics/demos';
const INDEX_JSON = 'apps/physics/demos.json';
const CACHE_KEY = 'physics.demos.v1';

const state = { items: [], source: 'idle', detail: '', tried: false, loading: false };

/* ------------------------------------------------------------
   文件名 → 标题：'2.7追及相遇问题演示.html' → '2.7 追及相遇问题演示'
   ------------------------------------------------------------ */
export function prettify(file) {
  let n = String(file).replace(/\.html?$/i, '');
  n = n.replace(/^([\d.]+)(?=\S)/, '$1 ');
  return n.trim();
}

/* ------------------------------------------------------------
   ① GitHub Contents API
   ------------------------------------------------------------ */
async function listViaApi(repo) {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/`
            + `${repo.demosPath}${repo.branch ? `?ref=${encodeURIComponent(repo.branch)}` : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });

  if (res.status === 404) throw new Error('仓库或目录还不存在');
  if (res.status === 403) throw new Error('GitHub 限流或仓库不可读');
  if (!res.ok) throw new Error('GitHub 返回 ' + res.status);

  const j = await res.json();
  if (!Array.isArray(j)) throw new Error('返回值不是文件列表');

  const items = j
    .filter((f) => f.type === 'file' && /\.html?$/i.test(f.name))
    .map((f) => ({ file: f.name, title: prettify(f.name), desc: '', size: f.size || 0 }));

  if (!items.length) throw new Error('目录里还没有 .html 文件');
  return items;
}

/* ------------------------------------------------------------
   ② 同源 demos.json
   ------------------------------------------------------------ */
async function listViaIndex() {
  const res = await fetch(INDEX_JSON, { cache: 'no-cache' });
  if (!res.ok) throw new Error('demos.json 读不到');
  const j = await res.json();
  const raw = Array.isArray(j) ? j : (j.items || []);
  const items = raw
    .filter((it) => it && it.file)
    .map((it) => ({ file: it.file, title: it.title || prettify(it.file), desc: it.desc || '', size: 0 }));
  if (!items.length) throw new Error('demos.json 是空的');
  return items;
}

/* ------------------------------------------------------------
   ③ 本地缓存
   ------------------------------------------------------------ */
function listViaCache() {
  let raw = null;
  try { raw = localStorage.getItem(CACHE_KEY); } catch { /* 隐私模式 */ }
  if (!raw) throw new Error('没有缓存');
  const items = JSON.parse(raw);
  if (!Array.isArray(items) || !items.length) throw new Error('缓存为空');
  return items;
}

function saveCache(items) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

/* ------------------------------------------------------------
   加载：① → ② → ③
   ------------------------------------------------------------ */
export async function loadDemos(repo, { force = false } = {}) {
  if (state.tried && !force) return state;
  state.loading = true;

  const tried = [];
  const ok = (items, source, detail) => {
    state.items = items;
    state.source = source;
    state.detail = detail;
    state.tried = true;
    state.loading = false;
    return state;
  };

  // ① 必须先试 —— 见文件头注释
  if (repo && repo.owner && repo.name) {
    try { return ok(await listViaApi(repo), 'api', ''); }
    catch (e) { tried.push('GitHub 自动发现：' + e.message); }
  } else {
    tried.push('config.js 里还没填 repo.owner / repo.name');
  }

  try { return ok(await listViaIndex(), 'index', tried.join('；')); }
  catch (e) { tried.push('本地清单：' + e.message); }

  try { return ok(listViaCache(), 'cache', tried.join('；')); }
  catch (e) { tried.push('本机缓存：' + e.message); }

  state.items = [];
  state.source = 'none';
  state.detail = tried.join('；');
  state.tried = true;
  state.loading = false;
  return state;
}

/* ------------------------------------------------------------
   列表页
   ------------------------------------------------------------ */
const SOURCE_TEXT = {
  api: () => 'GitHub 自动发现',
  index: () => '本地清单兜底（GitHub 未连上）',
  cache: () => '上次缓存（网络不通）',
  none: () => '没有取到清单',
};

function demoRow(item) {
  const a = el('a', 'linkrow');
  a.href = `#/physics/${encodeURIComponent(item.file)}`;
  a.appendChild(el('span', 'link-name', item.title));
  a.appendChild(el('span', 'link-desc', item.desc || ''));
  a.appendChild(el('span', 'link-url', item.size ? `${Math.round(item.size / 1024)} KB` : item.file));
  a.appendChild(el('span', 'link-go', '→'));
  return a;
}

function emptyBox(detail, onRetry) {
  const box = el('div', 'linklist');
  const head = el('div', 'linkadd');
  head.appendChild(el('span', 'mk', '○'));
  head.appendChild(el('span', 'why', '还没有取到演示文件。'));

  const body = el('div', 'howto');
  const repoName = 'oushenal/teacher-workbench';
  body.innerHTML =
    `<p>演示文件放在 GitHub 仓库的 <code>apps/physics/demos/</code> 目录里。放进去之后刷新本页就自动出现，<b>不用改任何代码</b>。</p>
     <p class="howto-step"><span class="step-no">1</span>浏览器打开 <code>github.com/${repoName}/tree/main/apps/physics/demos</code></p>
     <p class="howto-step"><span class="step-no">2</span>点 <b>Add file → Upload files</b></p>
     <p class="howto-step"><span class="step-no">3</span>把 .html 拖进去 → 点 <b>Commit changes</b></p>`;

  const more = el('p', 'howto-detail');
  more.textContent = detail ? `排查记录 —— ${detail}` : '';

  box.appendChild(head);
  box.appendChild(body);
  if (detail) box.appendChild(more);

  const foot = el('div', 'linkadd');
  const btn = el('button', 'btn', '重试');
  btn.type = 'button';
  btn.addEventListener('click', () => onRetry && onRetry());
  foot.appendChild(btn);
  box.appendChild(foot);

  return box;
}

export function renderPhysicsList(repo) {
  const f = document.createDocumentFragment();

  const head = el('div', 'page-head');
  head.appendChild(el('h1', null, '物理过程演示'));
  const sub = el('p', 'page-sub', '正在连 GitHub 列目录…');
  head.appendChild(sub);
  f.appendChild(head);

  const box = el('div');
  f.appendChild(box);

  const paint = () => {
    box.innerHTML = '';

    if (state.loading) {
      sub.textContent = '正在连 GitHub 列目录…';
      return;
    }

    const src = (SOURCE_TEXT[state.source] || SOURCE_TEXT.none)();
    sub.textContent = `共 ${state.items.length} 个 · ${src}`;

    if (!state.items.length) {
      box.appendChild(emptyBox(state.detail, () => {
        state.loading = true;
        paint();
        loadDemos(repo, { force: true }).then(paint);
      }));
      return;
    }

    const list = el('div', 'linklist');
    for (const it of state.items) list.appendChild(demoRow(it));
    box.appendChild(list);

    // 用的是兜底清单时，把原因摊开说 —— 不让人猜
    if (state.source !== 'api' && state.detail) {
      const note = el('p', 'howto-detail');
      note.textContent = `兜底原因 —— ${state.detail}`;
      box.appendChild(note);
    }
  };

  paint();
  if (!state.tried || state.loading) loadDemos(repo).then(paint);

  return f;
}

/* ------------------------------------------------------------
   演示页（站内 iframe）
   ------------------------------------------------------------ */
export function renderDemoStage(repo, rawFile) {
  const file = safeDecode(rawFile);
  const src = `${DEMO_DIR}/${encodeURIComponent(file)}`;

  const stage = el('div', 'demo-stage');

  const bar = el('div', 'demo-bar');
  const back = el('a', 'btn', '← 演示列表');
  back.href = '#/physics';
  bar.appendChild(back);
  bar.appendChild(el('span', 'demo-title', prettify(file)));
  bar.appendChild(el('span', 'spacer'));

  // 全屏：课堂上要的就是这个 —— 把门户外壳让开，演示占满整屏
  const fullBtn = el('button', 'btn', '全屏');
  fullBtn.type = 'button';
  const setFull = (on) => {
    stage.classList.toggle('demo-full', on);
    fullBtn.textContent = on ? '退出全屏' : '全屏';
    fullBtn.setAttribute('aria-pressed', String(on));
  };
  fullBtn.addEventListener('click', () => setFull(!stage.classList.contains('demo-full')));
  bar.appendChild(fullBtn);

  const open = el('a', 'btn', '新窗口打开 ↗');
  open.href = src;
  open.target = '_blank';
  open.rel = 'noopener';
  bar.appendChild(open);
  stage.appendChild(bar);

  // 清单里找不到就提示一声（例如链接过期 / 文件被改名）
  if (state.tried && state.items.length && !state.items.some((x) => x.file === file)) {
    const warn = el('p', 'demo-warn');
    warn.textContent = '这个文件不在当前清单里 —— 可能已改名或还没上传。下面仍然按原地址尝试加载。';
    stage.appendChild(warn);
  }

  const frame = el('iframe', 'demo-frame');
  frame.src = src;
  frame.title = prettify(file);
  frame.setAttribute('loading', 'eager');
  stage.appendChild(frame);

  // 顺手把清单加载起来，好让返回按钮和提示有数据
  if (!state.tried) loadDemos(repo);

  return stage;
}

/* Esc 退出全屏 —— 在模块作用域只注册一次，避免每开一个演示就挂一个监听 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.demo-stage.demo-full').forEach((s) => {
    s.classList.remove('demo-full');
    const b = s.querySelector('.demo-bar button');
    if (b) { b.textContent = '全屏'; b.setAttribute('aria-pressed', 'false'); }
  });
});

/** 供 shell.js 判断某个 hash 片段是不是演示文件 */
export function isDemoFile(segments) {
  return segments[0] === 'physics' && segments.length > 1 && segments[1];
}
