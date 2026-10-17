/* ============================================================
   physics · 杂项（apps/misc）
   ------------------------------------------------------------
   两块内容，来源不同：

   ① 站外链接 —— 写在 assets/config.js 的 links 数组里。
      改它要动代码，但胜在零依赖：没网、没登录也照常显示。
      （住宿生大巴点名表就在这儿）

   ② 我上传的 —— 存在 Supabase（misc_items 表 + 私有桶 misc）。
      登录后可以上传 HTML、加外链、删除。换电脑也能看到。

   🔴 预览用 sandbox iframe（不给 allow-same-origin）：
      上传的 HTML 跑在独立源里，碰不到本站的 localStorage 和登录令牌。
      和成绩归档同一个理由 —— 文件内容是自己做的，但"自己做的"不等于"安全"。

   路由：'#/misc'            杂项首页
         '#/misc/~view/<id>'  打开一个上传的文件（~ 开头不会和别的段冲突）
   ============================================================ */
import { el } from '../../assets/dom.js?v=34';
import { isSignedIn, sb, sbStore } from '../../assets/supabase.js?v=34';
import { normalizeUrl } from '../../assets/links.js?v=34';

const BUCKET = 'misc';
const VIEW_PREFIX = '~view';
const CFG = window.PHYSICS_CONFIG || {};
const LINKS = Array.isArray(CFG.links) ? CFG.links : [];

/* ------------------------------------------------------------
   状态
   ------------------------------------------------------------ */
const S = {
  items: [],            // 我上传的（misc_items）
  loading: false,
  error: '',
  flash: '',
  form: null,           // null | { kind: 'url' }
  upload: null,         // { done, total } 上传进行中
  view: null,           // { item, html, error, loading }
};

let primed = false;
let rerender = () => {};
export function bindRerender(fn) { rerender = fn; }

/* ------------------------------------------------------------
   取数 / 写入
   ------------------------------------------------------------ */
async function loadItems() {
  const rows = await sb.select(
    'misc_items',
    'select=id,kind,title,url,storage_path,file_size,note,sort,created_at'
    + '&order=sort.asc,created_at.desc',
  );
  S.items = rows || [];
}

/**
 * 预取。返回 true 表示「状态变了，调用方应该重绘一次」。
 * 🔴 有 primed 闸门：失败后不再自动重试，否则会变成
 *    「失败 → 重绘 → 再拉 → 再失败」的循环（作业登记上真踩过，刷出 11 条 401）。
 */
export async function primeMisc(force = false) {
  if (!isSignedIn()) return false;
  if (primed && !force) return false;
  primed = true;
  S.loading = true;
  S.error = '';
  try {
    await loadItems();
  } catch (e) {
    S.items = [];
    S.error = e.message;
  }
  S.loading = false;
  return true;
}

function button(text, cls) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.textContent = text;
  return b;
}

function notice(text, kind, action) {
  const n = el('div', 'notice');
  if (kind) n.dataset.kind = kind;
  n.appendChild(el('span', 'mk', kind === 'bad' ? '○' : '●'));
  n.appendChild(el('span', 'notice-txt', text));
  if (action) {
    const a = el('a', 'notice-act', action.label);
    a.href = action.href;
    n.appendChild(a);
  }
  return n;
}

function pageHead(title, sub) {
  const head = el('div', 'page-head');
  head.appendChild(el('h1', null, title));
  head.appendChild(el('p', 'page-sub', sub));
  return head;
}

function section(title, count) {
  const s = el('div', 'sect');
  // 用 h2 —— CSS 只给 `.sect h2` 定了样式（标题字号/字重）。
  // 早先这里写成 <span class="sect-t">，结果标题一点样式都没有，看着像小字。
  s.appendChild(el('h2', null, title));
  if (count != null) s.appendChild(el('span', 'cnt', String(count)));
  s.appendChild(el('span', 'rule'));
  return s;
}

function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------
   行
   ------------------------------------------------------------ */
/** 站外静态链接（一行整块可点，带 ↗） */
function staticRow(it) {
  const a = el('a', 'linkrow');
  a.href = it.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.appendChild(el('span', 'link-name', it.name));
  a.appendChild(el('span', 'link-desc', it.desc || ''));
  a.appendChild(el('span', 'link-url', String(it.url || '').replace(/^https?:\/\//, '')));
  a.appendChild(el('span', 'link-go', '↗'));
  return a;
}

function twoStepDelete(onConfirm) {
  const wrap = el('span', 'stepdel');
  const del = button('删除', 'iconbtn');
  const ok = button('确认删除', 'iconbtn iconbtn--danger');
  const no = button('取消', 'iconbtn');
  ok.hidden = true; no.hidden = true;

  let timer = null;
  const reset = () => {
    clearTimeout(timer);
    del.hidden = false; ok.hidden = true; no.hidden = true;
  };
  del.addEventListener('click', () => {
    del.hidden = true; ok.hidden = false; no.hidden = false;
    timer = setTimeout(reset, 6000);
  });
  no.addEventListener('click', reset);
  ok.addEventListener('click', async () => {
    clearTimeout(timer);
    ok.disabled = true;
    ok.textContent = '删除中…';
    await onConfirm();
  });

  wrap.appendChild(del); wrap.appendChild(ok); wrap.appendChild(no);
  return wrap;
}

async function removeItem(it) {
  try {
    await sb.del('misc_items', `id=eq.${encodeURIComponent(it.id)}`);
    if (it.kind === 'file' && it.storage_path) {
      // 文件删失败不影响记录已删的事实 —— 顶多留个孤儿对象，下次可手动清
      try { await sbStore.remove(BUCKET, [it.storage_path]); } catch { /* 忽略 */ }
    }
    await loadItems();
    S.flash = `已删除「${it.title}」`;
    S.error = '';
  } catch (e) {
    S.error = '删除失败：' + e.message;
  }
  rerender();
}

function itemRow(it) {
  const row = el('div', 'linkrow');

  const link = el('a', 'linkrow-a');
  if (it.kind === 'url') {
    link.href = it.url;
    link.target = '_blank';
    link.rel = 'noopener';
  } else {
    link.href = `#/misc/${VIEW_PREFIX}/${it.id}`;
  }
  link.appendChild(el('span', 'link-name', it.title));

  const meta = [it.kind === 'url' ? '外链' : fmtSize(it.file_size), fmtDate(it.created_at)]
    .filter(Boolean).join(' · ');
  // ⚠️ 两边别放同一个值 —— 早先 desc 和 url 都填了 meta，
  //    同一行里「47 KB · 2026-10-12」出现了两次。
  link.appendChild(el('span', 'link-desc', it.note || ''));
  link.appendChild(el('span', 'link-url', meta));
  link.appendChild(el('span', 'link-go', it.kind === 'url' ? '↗' : '→'));
  row.appendChild(link);

  const act = el('span', 'rowact');
  act.appendChild(twoStepDelete(() => removeItem(it)));
  row.appendChild(act);
  return row;
}

/* ------------------------------------------------------------
   上传
   ------------------------------------------------------------ */
async function uploadFiles(files) {
  const list = [...files];
  if (!list.length) return;
  S.upload = { done: 0, total: list.length };
  S.error = '';
  rerender();

  const failed = [];
  for (const f of list) {
    try {
      const key = await sbStore.upload(BUCKET, f);
      await sb.insert('misc_items', {
        kind: 'file',
        title: f.name.replace(/\.html?$/i, ''),
        storage_path: key,
        file_size: f.size,
        sort: 0,
      });
      S.upload.done += 1;
      rerender();
    } catch (e) {
      failed.push(`${f.name}（${e.message}）`);
    }
  }

  S.upload = null;
  try { await loadItems(); } catch (e) { S.error = e.message; }
  if (failed.length) S.error = '有 ' + failed.length + ' 个没传上去：' + failed.join('；');
  else S.flash = `已上传 ${list.length} 个文件`;
  rerender();
}

/* ------------------------------------------------------------
   外链表单
   ------------------------------------------------------------ */
function textInput(value, placeholder) {
  const i = document.createElement('input');
  i.type = 'text';
  i.className = 'input';
  i.value = value || '';
  if (placeholder) i.placeholder = placeholder;
  return i;
}

function field(label, node) {
  const w = el('label', 'field');
  w.appendChild(el('span', 'field-label', label));
  w.appendChild(node);
  return w;
}

function urlForm() {
  const box = el('div', 'formpanel');
  box.appendChild(el('p', 'formpanel-title', '添加外链'));

  const rows = el('div', 'formrows');
  const name = textInput('', '例如：班级相册');
  const url = textInput('', 'https://…（不写 https:// 也行）');
  const note = textInput('', '一句话说明，可空');
  rows.appendChild(field('名称', name));
  rows.appendChild(field('网址', url));
  rows.appendChild(field('说明', note));
  box.appendChild(rows);

  const err = el('p', 'form-hint');

  const bar = el('div', 'formbar');
  const save = button('保存', 'btn-primary');
  const cancel = button('取消');
  const close = () => { S.form = null; rerender(); };
  cancel.addEventListener('click', close);

  save.addEventListener('click', async () => {
    const t = name.value.trim();
    const u = normalizeUrl(url.value);
    if (!t) { err.dataset.kind = 'bad'; err.textContent = '名称不能空着。'; name.focus(); return; }
    if (!u) { err.dataset.kind = 'bad'; err.textContent = '网址填得不对，要像 https://example.com 这样。'; url.focus(); return; }
    save.disabled = true; save.textContent = '保存中…';
    err.dataset.kind = ''; err.textContent = '';
    try {
      await sb.insert('misc_items', {
        kind: 'url', title: t, url: u, note: note.value.trim(), sort: 0,
      });
      await loadItems();
      S.form = null;
      S.flash = `已添加「${t}」`;
      rerender();
    } catch (e) {
      err.dataset.kind = 'bad';
      err.textContent = '保存失败：' + e.message;
      save.disabled = false; save.textContent = '保存';
    }
  });

  for (const i of [name, url, note]) {
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  }

  bar.appendChild(save);
  bar.appendChild(cancel);
  box.appendChild(bar);
  box.appendChild(err);
  setTimeout(() => name.focus(), 0);
  return box;
}

/* ------------------------------------------------------------
   打开一个上传的 HTML
   ------------------------------------------------------------ */
async function openFile(it) {
  S.view = { item: it, loading: true, html: '', error: '' };
  rerender();
  try {
    const blob = await sbStore.download(BUCKET, it.storage_path);
    const html = await blob.text();
    S.view = { item: it, loading: false, html, error: '' };
  } catch (e) {
    S.view = { item: it, loading: false, html: '', error: e.message };
  }
  rerender();
}

function renderView(id) {
  const f = document.createDocumentFragment();
  const it = S.items.find((x) => x.id === id);

  if (!it) {
    // 直接刷新到一个预览地址时，记录还没拉回来 —— 别急着说"找不到"。
    // render() 那边会触发 primeMisc 并重绘，这里只要不显示错误就行。
    if (!primed) {
      f.appendChild(pageHead('正在打开…', '读取文件记录'));
      return f;
    }
    f.appendChild(pageHead('找不到这个文件', id));
    f.appendChild(notice('记录不存在，可能已经被删掉了。', 'bad'));
    const back = el('a', 'btn btn-primary', '← 返回杂项');
    back.href = '#/misc';
    f.appendChild(back);
    return f;
  }

  const stage = el('div', 'demo-stage');
  const bar = el('div', 'demo-bar');
  const back = el('a', 'btn', '← 返回');
  back.href = '#/misc';
  bar.appendChild(back);
  bar.appendChild(el('span', 'demo-title', it.title));
  bar.appendChild(el('span', 'spacer'));

  const fullBtn = button('全屏');
  fullBtn.addEventListener('click', () => {
    const on = !stage.classList.contains('demo-full');
    stage.classList.toggle('demo-full', on);
    fullBtn.textContent = on ? '退出全屏' : '全屏';
  });
  bar.appendChild(fullBtn);

  const dl = button('下载');
  dl.addEventListener('click', () => {
    if (!S.view?.html) return;
    const url = URL.createObjectURL(new Blob([S.view.html], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${it.title}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  });
  bar.appendChild(dl);
  stage.appendChild(bar);

  if (S.view?.error) {
    stage.appendChild(notice('读取失败：' + S.view.error, 'bad'));
  } else if (S.view?.loading || S.view?.item?.id !== it.id) {
    stage.appendChild(el('p', 'page-sub', '正在读取…'));
    if (!S.view?.loading) openFile(it);
  } else {
    const frame = el('iframe', 'demo-frame');
    // 🔴 sandbox 不给 allow-same-origin：文件跑在独立源里，
    //    读不到本站的 localStorage 和登录令牌。
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-modals');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = S.view.html;
    frame.title = it.title;
    stage.appendChild(frame);
  }

  f.appendChild(stage);
  return f;
}

/* ------------------------------------------------------------
   主渲染
   ------------------------------------------------------------ */
export function renderMisc(segments = []) {
  const segs = segments.slice(1);              // 去掉 'misc'
  if (segs[0] === VIEW_PREFIX) return renderView(segs[1] || '');

  const f = document.createDocumentFragment();
  f.appendChild(pageHead('杂项', '零散的工具、页面和存档，都放这儿。'));

  /* ---------- ① 站外链接（写在 config.js 里） ---------- */
  f.appendChild(section('站外链接', LINKS.length));
  const sList = el('div', 'linklist');
  if (LINKS.length) {
    for (const it of LINKS) sList.appendChild(staticRow(it));
  } else {
    const empty = el('div', 'linkadd');
    empty.appendChild(el('span', 'why', '还没有链接。'));
    sList.appendChild(empty);
  }
  f.appendChild(sList);

  /* ---------- ② 我上传的（Supabase） ---------- */
  const mine = isSignedIn() ? S.items : [];
  f.appendChild(section('我上传的', isSignedIn() ? mine.length : null));

  const list = el('div', 'linklist');

  if (!isSignedIn()) {
    const add = el('div', 'linkadd');
    add.appendChild(el('span', 'mk', '○'));
    add.appendChild(el('span', 'why', '登录后可以上传 HTML、加外链，换台电脑也能看到。'));
    const go = el('a', 'notice-act', '去登录 →');
    go.href = '#/hwlog';
    add.appendChild(go);
    list.appendChild(add);
    f.appendChild(list);
    return f;
  }

  if (S.flash) {
    f.appendChild(notice(S.flash));
    S.flash = '';
  }
  if (S.error) f.appendChild(notice(S.error, 'bad'));

  if (S.form?.kind === 'url') f.appendChild(urlForm());

  if (S.loading && !mine.length) {
    const loadingRow = el('div', 'linkadd');
    loadingRow.appendChild(el('span', 'why', '正在读取…'));
    list.appendChild(loadingRow);
  }

  for (const it of mine) list.appendChild(itemRow(it));

  /* 上传 / 添加外链 —— 做成列表最后两行，跟其它行同一个语系 */
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.html,.htm,text/html';
  fileInput.multiple = true;
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    fileInput.value = '';
    uploadFiles(files);
  });

  const up = el('button', 'linkadd linkadd-btn');
  up.type = 'button';
  if (S.upload) {
    up.disabled = true;
    up.appendChild(el('span', 'mk', '◐'));
    up.appendChild(el('span', 'why', `上传中 ${S.upload.done + 1}/${S.upload.total}…`));
  } else {
    up.appendChild(el('span', 'mk', '＋'));
    // 补充说明单独放 <i class="why-hint">：小一号、淡一档。
    // 跟主文案同样黑的话，这一行会比上面的记录标题还重。
    const w = el('span', 'why');
    w.innerHTML = '上传 HTML 文件<i class="why-hint">可一次选多个</i>';
    up.appendChild(w);
  }
  up.addEventListener('click', () => fileInput.click());

  const addUrl = el('button', 'linkadd linkadd-btn');
  addUrl.type = 'button';
  addUrl.appendChild(el('span', 'mk', '＋'));
  const aw = el('span', 'why');
  aw.innerHTML = '添加外链<i class="why-hint">页面放在别的站上时用</i>';
  addUrl.appendChild(aw);
  addUrl.addEventListener('click', () => {
    S.form = S.form ? null : { kind: 'url' };
    rerender();
  });

  const empty = !mine.length && !S.loading;
  if (empty) {
    const hint = el('div', 'linkadd');
    hint.appendChild(el('span', 'mk', '○'));
    hint.appendChild(el('span', 'why', '还没有上传过东西。'));
    list.appendChild(hint);
  }
  list.appendChild(up);
  list.appendChild(addUrl);
  list.appendChild(fileInput);
  f.appendChild(list);

  if (!mine.length && !S.error) {
    const box = el('div', 'howto');
    box.innerHTML =
      `<p><b>能传什么</b>：任何自包含的 HTML —— 演示页、点名表、某个工具的小页面。</p>
       <p>文件存在 <b>私有桶</b> 里，地址不能直接在浏览器打开，必须登录后来这儿看。
          预览用独立沙箱，页面里的脚本碰不到本站的登录状态。</p>
       <p>只是想跳到一个已有的网址（比如大巴点名表）？用「添加外链」。
          <b>不登录也能看到</b>的那几条在旁边「站外链接」里，写在 <code>assets/config.js</code>。</p>`;
    f.appendChild(box);
  }

  return f;
}
