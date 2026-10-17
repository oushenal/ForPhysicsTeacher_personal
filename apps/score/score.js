/* ============================================================
   physics · 成绩归档（apps/score）
   ------------------------------------------------------------
   只做三件事：**存 · 找 · 看**。
   分析过程不在这里做 —— 你生成好学情分析 HTML，传上来按学期/考试归档。

   目录结构用 path 数组表示，**层级不限**：
     根 → '2026-2027 上学期' → '第一次阶段性测试' → 各班报告
   加一层新目录 = 直接用更长的 path，不改表、不改代码。

   🔴 隐私：报告里有全班真实姓名和分数。
      · 文件存**私有桶** grades，读它必须带登录令牌（见 supabase.js 的 sbStore）
      · 预览用 sandbox iframe + srcdoc，**不给 allow-same-origin**
        → 报告跑在独立源里，碰不到本站的 localStorage 和登录令牌

   路由：'#/score'                  根目录
         '#/score/<目录>/<目录>'      某一层目录
         '#/score/~view/<id>'        打开一份报告（~ 开头的段不会与目录名冲突）
   ============================================================ */
import { el, safeDecode } from '../../assets/dom.js?v=38';
import { isSignedIn, currentEmail, sb, sbStore } from '../../assets/supabase.js?v=38';
import { renderAuthCard } from '../../assets/authcard.js?v=38';

const BUCKET = 'grades';
const VIEW_PREFIX = '~view';

/* ------------------------------------------------------------
   状态
   ------------------------------------------------------------ */
const S = {
  loading: false,
  error: '',
  flash: '',            // 一次性提示（保存成功之类）
  flashHref: '',        // 提示条上「去看看 →」去的地方（比如刚移过去的目标目录）
  items: [],            // 全部归档条目（一次取回，树在本地拼）
  classes: ['2班', '6班'],
  filter: '',           // 班级筛选：'' = 全部
  form: null,           // 当前展开的表单
  sel: new Set(),       // 批量选中的条目 id
  view: null,           // { item, html, error, loading }
  primed: false,
};

let primed = false;

/* ------------------------------------------------------------
   取数
   ------------------------------------------------------------ */
async function loadItems() {
  const rows = await sb.select('archive_items',
    'select=id,path,kind,title,class_name,exam_date,note,file_path,file_size,url,sort,created_at'
    + '&order=sort.asc,created_at.desc');
  S.items = rows || [];
}

async function loadClasses() {
  try {
    const rows = await sb.select('cohorts', 'select=name,sort&order=sort');
    const names = (rows || []).map((r) => r.name);
    if (names.length) S.classes = names;
  } catch { /* 作业登记还没建表也无所谓，用默认两个班 */ }
}

export async function primeScore(force = false) {
  if (!isSignedIn()) { primed = false; return false; }
  if (primed && !force) return false;
  primed = true;
  S.loading = true; S.error = '';
  try {
    await loadItems();
    await loadClasses();
  } catch (e) {
    S.error = e.message;
    S.items = [];
  }
  S.loading = false;
  return true;
}

/* ------------------------------------------------------------
   小工具
   ------------------------------------------------------------ */
const segKey = (arr) => arr.join('\u0000');           // 数组当 Map 键
const folderFullPath = (it) => [...it.path, it.title]; // folder 的完整路径
const fmtSize = (n) => (!n ? '' : n < 1024 ? n + ' B' : (n / 1024).toFixed(0) + ' KB');
const fmtDate = (d) => (d ? d.slice(5).replace('-', '月') + '日' : '');

function pageHead(title, sub) {
  const h = el('div', 'page-head');
  h.appendChild(el('h1', null, title));
  if (sub) h.appendChild(el('p', 'page-sub', sub));
  return h;
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
function button(text, cls) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button'; b.textContent = text;
  return b;
}
function routing(path, form) {
  S.form = form;
  rerender();
}

/** 当前目录下的内容 */
function childrenOf(pathArr) {
  const k = segKey(pathArr);
  const folders = S.items
    .filter((i) => i.kind === 'folder' && segKey(i.path) === k)
    .sort((a, b) => (a.sort - b.sort) || a.title.localeCompare(b.title, 'zh'));

  let entries = S.items
    .filter((i) => i.kind !== 'folder' && segKey(i.path) === k);
  if (S.filter) entries = entries.filter((i) => (i.class_name || '') === S.filter);
  entries.sort((a, b) => {
    if (a.exam_date && b.exam_date && a.exam_date !== b.exam_date) return a.exam_date < b.exam_date ? 1 : -1;
    if (a.exam_date && !b.exam_date) return -1;
    if (!a.exam_date && b.exam_date) return 1;
    return (a.created_at < b.created_at) ? 1 : -1;
  });

  return { folders, entries };
}

/** 这个目录（含子孙）下一共有多少条目 —— 给目录行显示用 */
function countUnder(fullPath) {
  const prefix = segKey(fullPath);
  return S.items.filter((i) => i.kind !== 'folder'
    && segKey(i.path).startsWith(prefix)).length;
}

/* ------------------------------------------------------------
   面包屑
   ------------------------------------------------------------ */
function breadcrumb(pathArr) {
  const bc = el('nav', 'breadcrumb');
  const root = el('a', 'crumb', '成绩归档');
  root.href = '#/score';
  bc.appendChild(root);

  pathArr.forEach((seg, i) => {
    bc.appendChild(el('span', 'crumb-sep', '/'));
    const sub = pathArr.slice(0, i + 1);
    if (i === pathArr.length - 1) {
      bc.appendChild(el('span', 'crumb crumb--here', seg));
    } else {
      const a = el('a', 'crumb', seg);
      a.href = '#/score/' + sub.map(encodeURIComponent).join('/');
      bc.appendChild(a);
    }
  });
  return bc;
}

/* ------------------------------------------------------------
   行内重命名：把名字换成一个输入框，回车保存 / Esc 取消
   ------------------------------------------------------------ */
async function doRename(it, title) {
  if (it.kind === 'folder') {
    // 目录改名会连带改所有子孙的 path 前缀 —— 走数据库函数，一条语句原子完成
    await sb.rpc('rename_archive_folder', { p_id: it.id, p_new_title: title });
  } else {
    await sb.update('archive_items', `id=eq.${it.id}`, { title });
  }
  await loadItems();
  S.flash = '已重命名';
  rerender();
}

function startRename(row, it) {
  const link = row.querySelector('.linkrow-a');
  const nameEl = link?.querySelector('.link-name');
  if (!nameEl || row.dataset.editing === '1') return;
  row.dataset.editing = '1';

  const old = it.title.replace(/^▸\s*/, '');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input input--inline';
  input.value = old;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let busy = false;
  const finish = () => { if (!busy) { busy = true; rerender(); } };

  const commit = async () => {
    if (busy) return;
    const v = input.value.trim();
    if (!v || v === old) { finish(); return; }
    busy = true;
    try {
      await doRename(it, v);
    } catch (e) {
      S.error = '重命名失败：' + e.message;
      rerender();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
  });
  input.addEventListener('blur', () => { if (!busy) commit(); });
}

/* ------------------------------------------------------------
   行：目录 / 存档
   ------------------------------------------------------------ */
function folderRow(f, siblings) {
  const row = el('div', 'linkrow');

  const link = el('a', 'linkrow-a');
  link.href = '#/score/' + folderFullPath(f).map(encodeURIComponent).join('/');
  link.appendChild(el('span', 'link-name', '▸ ' + f.title));
  link.appendChild(el('span', 'link-desc', ''));
  link.appendChild(el('span', 'link-url', countUnder(folderFullPath(f)) + ' 项'));
  link.appendChild(el('span', 'link-go', '→'));
  row.appendChild(link);

  const act = el('span', 'rowact');

  // 同级目录手动排序
  const idx = siblings.indexOf(f);
  const up = button('↑', 'iconbtn');
  const dn = button('↓', 'iconbtn');
  up.disabled = idx === 0;
  dn.disabled = idx === siblings.length - 1;
  up.title = '上移'; dn.title = '下移';
  up.addEventListener('click', () => swapSort(siblings, idx, idx - 1));
  dn.addEventListener('click', () => swapSort(siblings, idx, idx + 1));
  act.appendChild(up); act.appendChild(dn);

  const rn = button('重命名', 'iconbtn');
  rn.addEventListener('click', () => startRename(row, f));
  act.appendChild(rn);

  act.appendChild(twoStepDelete(() => removeItem(f)));
  row.appendChild(act);
  return row;
}

async function swapSort(siblings, i, j) {
  const a = siblings[i], b = siblings[j];
  const sa = a.sort ?? i, sb2 = b.sort ?? j;
  try {
    await sb.update('archive_items', `id=eq.${a.id}`, { sort: sb2 });
    await sb.update('archive_items', `id=eq.${b.id}`, { sort: sa });
    a.sort = sb2; b.sort = sa;
    S.items.sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
    rerender();
  } catch (e) { S.error = '排序失败：' + e.message; rerender(); }
}

function entryRow(it, onSelectionChange) {
  const row = el('div', 'linkrow');

  // 复选框放在链接**外面** —— 放里面点一下会顺带跳转
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'rowcheck';
  cb.checked = S.sel.has(it.id);
  cb.title = '选中后可批量移动';
  cb.addEventListener('change', () => {
    if (cb.checked) S.sel.add(it.id); else S.sel.delete(it.id);
    onSelectionChange();
  });
  row.appendChild(cb);

  const link = el('a', 'linkrow-a');
  if (it.kind === 'url') {
    link.href = it.url;
    link.target = '_blank';
    link.rel = 'noopener';
  } else {
    link.href = `#/score/${VIEW_PREFIX}/${it.id}`;
  }
  link.appendChild(el('span', 'link-name', it.title));

  const meta = [it.class_name, fmtDate(it.exam_date), fmtSize(it.file_size)]
    .filter(Boolean).join(' · ');
  link.appendChild(el('span', 'link-desc', meta));
  link.appendChild(el('span', 'link-url', it.kind === 'url' ? '外链' : ''));
  link.appendChild(el('span', 'link-go', it.kind === 'url' ? '↗' : '→'));
  row.appendChild(link);

  const act = el('span', 'rowact');
  const rn = button('重命名', 'iconbtn');
  rn.addEventListener('click', () => startRename(row, it));
  act.appendChild(rn);

  const mv = button('移动', 'iconbtn');
  mv.addEventListener('click', () => {
    S.sel.clear();
    S.sel.add(it.id);
    S.form = { kind: 'move', ids: [it.id] };
    rerender();
  });
  act.appendChild(mv);

  act.appendChild(twoStepDelete(() => removeItem(it)));
  row.appendChild(act);
  return row;
}

/** 两步确认删除（同作业登记那套） */
function twoStepDelete(onConfirm) {
  const act = el('span', 'stepdel');
  const del = button('删除', 'iconbtn');
  const ok = button('确认删除', 'iconbtn iconbtn--danger');
  const no = button('取消', 'iconbtn');
  ok.hidden = true; no.hidden = true;

  del.addEventListener('click', () => {
    del.hidden = true; ok.hidden = false; no.hidden = false;
    setTimeout(() => { if (!ok.hidden) { del.hidden = false; ok.hidden = true; no.hidden = true; } }, 6000);
  });
  no.addEventListener('click', () => { del.hidden = false; ok.hidden = true; no.hidden = true; });
  ok.addEventListener('click', async () => {
    ok.disabled = no.disabled = true;
    ok.textContent = '删除中…';
    try { await onConfirm(); } catch (e) { S.error = '删除失败：' + e.message; rerender(); }
  });
  act.appendChild(del); act.appendChild(ok); act.appendChild(no);
  return act;
}

async function removeItem(it) {
  if (it.kind === 'file' && it.file_path) {
    await sbStore.remove(BUCKET, [it.file_path]);   // 先删文件，再删记录
  }
  await sb.del('archive_items', `id=eq.${it.id}`);
  S.items = S.items.filter((x) => x.id !== it.id);
  // 删目录时把子项一起删（表里没有级联关系，手动处理）
  if (it.kind === 'folder') {
    const full = segKey(folderFullPath(it));
    const kids = S.items.filter((x) => segKey(x.path).startsWith(full));
    for (const k of kids) {
      if (k.kind === 'file' && k.file_path) await sbStore.remove(BUCKET, [k.file_path]);
      await sb.del('archive_items', `id=eq.${k.id}`);
    }
    S.items = S.items.filter((x) => !segKey(x.path).startsWith(full));
  }
  S.flash = '已删除';
  rerender();
}

/* ------------------------------------------------------------
   内联表单
   ------------------------------------------------------------ */
function classSelect(value) {
  const sel = document.createElement('select');
  sel.className = 'input';
  for (const name of ['（不分班）', ...S.classes]) {
    const o = document.createElement('option');
    o.value = name === '（不分班）' ? '' : name;
    o.textContent = name;
    if ((value || '') === o.value) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function field(label, node) {
  const w = el('label', 'field');
  w.appendChild(el('span', 'field-label', label));
  w.appendChild(node);
  return w;
}

function textInput(value, placeholder) {
  const i = document.createElement('input');
  i.type = 'text'; i.className = 'input';
  i.value = value || '';
  if (placeholder) i.placeholder = placeholder;
  return i;
}

function dateInput(value) {
  const i = document.createElement('input');
  i.type = 'date'; i.className = 'input';
  i.value = value || todayIso();
  return i;
}

/** 从文件名猜班级：'2班_第一次阶段性测试_学情通讯.html' → '2班' */
function guessClass(filename) {
  for (const c of S.classes) if (filename.includes(c)) return c;
  return '';
}

function formPanel(pathArr) {
  const box = el('div', 'formpanel');
  const kind = S.form.kind;

  /* 移动到…：列出所有已存在的目录给你点。
     只列目录、不列文件 —— 目标只能是目录。 */
  if (kind === 'move') {
    const ids = S.form.ids || [];
    const curK = segKey(pathArr);
    box.appendChild(el('p', 'formpanel-title', `把 ${ids.length} 项移动到…`));

    const targets = [{ path: [], label: '（根目录）' }]
      .concat(S.items.filter((i) => i.kind === 'folder')
        .map((f) => ({ path: folderFullPath(f), label: folderFullPath(f).join(' / ') })));

    const grid = el('div', 'movelist');
    for (const t of targets) {
      const isHere = segKey(t.path) === curK;
      const b = button(t.label, 'picktarget');
      if (isHere) { b.disabled = true; b.textContent = t.label + '（当前目录）'; }
      b.addEventListener('click', () => {
        // 🔴 点下去必须**立刻**有反应。
        //    移动是「RPC + 重新拉列表」两个网络往返，慢的时候一两秒没动静，
        //    用户会怀疑自己没点上，于是又点一次 —— 那才是真的容易出事。
        if (grid.dataset.busy) return;
        grid.dataset.busy = '1';
        b.dataset.picked = '1';
        b.textContent = '正在移动到「' + t.label + '」…';
        doMove(ids, t.path, t.label);
      });
      grid.appendChild(b);
    }
    box.appendChild(grid);

    if (!targets.length) {
      box.appendChild(el('p', 'page-sub', '还没有别的目录可移。先建一个目录再来。'));
    }

    const bar = el('div', 'formbar');
    bar.appendChild(cancelBtn());
    box.appendChild(bar);
    return box;
  }

  const rows = el('div', 'formrows');

  if (kind === 'folder') {
    const name = textInput('', '例如：第一次阶段性测试');
    rows.appendChild(field('目录名', name));
    const bar = el('div', 'formbar');
    const save = button('创建目录', 'btn-primary');
    save.addEventListener('click', async () => {
      const t = name.value.trim();
      if (!t) return;
      await insertItem({ path: pathArr, kind: 'folder', title: t, sort: nextSort(pathArr) });
    });
    bar.appendChild(save);
    bar.appendChild(cancelBtn());
    box.appendChild(el('p', 'formpanel-title', '新建目录'));
    box.appendChild(rows);
    box.appendChild(bar);
    setTimeout(() => name.focus(), 0);
    return box;
  }

  if (kind === 'url') {
    const name = textInput('', '例如：9月月考 学情分析（外链）');
    const url = textInput('', 'https://…');
    const cls = classSelect(S.filter || '');
    const date = dateInput();
    rows.appendChild(field('标题', name));
    rows.appendChild(field('网址', url));
    rows.appendChild(field('班级', cls));
    rows.appendChild(field('日期', date));
    const bar = el('div', 'formbar');
    const save = button('保存', 'btn-primary');
    save.addEventListener('click', async () => {
      const t = name.value.trim(), u = url.value.trim();
      if (!t || !u) { S.error = '标题和网址都要填。'; rerender(); return; }
      await insertItem({
        path: pathArr, kind: 'url', title: t, url: u,
        class_name: cls.value, exam_date: date.value || null,
        sort: nextSort(pathArr),
      });
    });
    bar.appendChild(save);
    bar.appendChild(cancelBtn());
    box.appendChild(el('p', 'formpanel-title', '添加外链（不上传文件）'));
    box.appendChild(rows);
    box.appendChild(bar);
    setTimeout(() => name.focus(), 0);
    return box;
  }

  /* 上传 HTML：支持一次选多个，通常是一次考试的 2班 + 6班 两份 */
  const files = S.form.files || [];
  box.appendChild(el('p', 'formpanel-title',
    `上传 ${files.length} 个文件到「${pathArr.length ? pathArr[pathArr.length - 1] : '根目录'}」`));

  const picks = files.map((f) => {
    const r = el('div', 'pickrow');
    const title = textInput(f.name.replace(/\.html?$/i, ''), '标题');
    const cls = classSelect(guessClass(f.name));
    const date = dateInput();
    r.appendChild(el('span', 'pickname', f.name));
    r.appendChild(field('标题', title));
    r.appendChild(field('班级', cls));
    r.appendChild(field('日期', date));
    box.appendChild(r);
    return { f, title, cls, date, row: r };
  });

  const bar = el('div', 'formbar');
  const save = button('保存全部', 'btn-primary');
  const state = el('span', 'savemsg');
  save.addEventListener('click', async () => {
    save.disabled = true;
    let done = 0;
    try {
      for (const p of picks) {
        state.textContent = `上传中 ${done + 1}/${picks.length}…`;
        const key = await sbStore.upload(BUCKET, p.f);
        await sb.insert('archive_items', {
          path: pathArr, kind: 'file', title: p.title.value.trim() || p.f.name,
          class_name: p.cls.value, exam_date: p.date.value || null,
          file_path: key, file_size: p.f.size, sort: nextSort(pathArr),
        });
        done += 1;
      }
      await loadItems();
      S.form = null;
      S.flash = `已上传 ${done} 个文件`;
      rerender();
    } catch (e) {
      state.dataset.kind = 'bad';
      state.textContent = `第 ${done + 1} 个失败：` + e.message;
      save.disabled = false;
    }
  });
  bar.appendChild(save);
  bar.appendChild(cancelBtn());
  bar.appendChild(state);
  box.appendChild(bar);
  return box;
}

function cancelBtn() {
  const b = button('取消');
  b.addEventListener('click', () => { S.form = null; S.error = ''; rerender(); });
  return b;
}

function nextSort(pathArr) {
  const k = segKey(pathArr);
  const sibs = S.items.filter((i) => segKey(i.path) === k);
  return sibs.reduce((m, i) => Math.max(m, i.sort ?? 0), 0) + 1;
}

async function doMove(ids, destPath, destLabel) {
  const label = destLabel || ((destPath || []).length ? destPath.join(' / ') : '根目录');
  try {
    const n = await sb.rpc('move_archive_items', { p_ids: ids, p_dest: destPath });
    await loadItems();
    const moved = typeof n === 'number' ? n : ids.length;
    S.form = null;
    S.sel.clear();
    S.flash = `已移动 ${moved} 项 → ${label}`;
    // 给一条「去看看」—— 移完东西从当前目录消失了，光说一句"已移动"没法确认去了哪
    S.flashHref = '#/score' + (destPath || []).map((p) => '/' + encodeURIComponent(p)).join('');
    S.error = '';
    rerender();
  } catch (e) {
    S.error = '移动失败：' + e.message;
    S.form = null;
    rerender();
  }
}

async function insertItem(patch) {
  try {
    await sb.insert('archive_items', { class_name: '', note: '', ...patch });
    await loadItems();
    S.form = null; S.error = '';
    S.flash = '已保存';
    rerender();
  } catch (e) {
    S.error = '保存失败：' + e.message;
    rerender();
  }
}

/* ------------------------------------------------------------
   目录页
   ------------------------------------------------------------ */
function renderDir(pathArr) {
  const f = document.createDocumentFragment();
  const here = pathArr.length ? pathArr[pathArr.length - 1] : '成绩归档';
  const { folders, entries } = childrenOf(pathArr);

  f.appendChild(pageHead(here, currentEmail()));
  f.appendChild(breadcrumb(pathArr));

  /* 工具栏 */
  const bar = el('div', 'toolbar');
  const bFolder = button('＋ 新建目录');
  bFolder.addEventListener('click', () => routing(pathArr, { kind: 'folder' }));

  const bUpload = button('⬆ 上传 HTML', 'btn-primary');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.html,.htm,text/html';
  fileInput.multiple = true;
  fileInput.hidden = true;
  // ⚠️ input[type=file] 被 .btn 之类样式影响会失效，所以它单独放着、用 hidden 藏
  bUpload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    if (!files.length) return;
    routing(pathArr, { kind: 'file', files });
  });

  const bUrl = button('＋ 添加外链');
  bUrl.addEventListener('click', () => routing(pathArr, { kind: 'url' }));

  bar.appendChild(bFolder);
  bar.appendChild(bUpload);
  bar.appendChild(bUrl);
  bar.appendChild(fileInput);
  f.appendChild(bar);

  /* 班级筛选 */
  if (S.classes.length) {
    const chips = el('div', 'chipbar');
    const mk = (label, val) => {
      const c = el('button', 'chip', label);
      c.type = 'button';
      if (S.filter === val) c.dataset.on = '1';
      c.addEventListener('click', () => { S.filter = val; rerender(); });
      return c;
    };
    chips.appendChild(mk('全部', ''));
    for (const n of S.classes) chips.appendChild(mk(n, n));
    f.appendChild(chips);
  }

  if (S.flash) {
    f.appendChild(notice(S.flash, '', S.flashHref ? { label: '去看看 →', href: S.flashHref } : null));
    S.flash = ''; S.flashHref = '';
  }
  if (S.error) f.appendChild(notice(S.error, 'bad'));

  /* 表单 */
  if (S.form) f.appendChild(formPanel(pathArr));

  /* 列表 */
  if (!folders.length && !entries.length) {
    const box = el('div', 'linklist');
    const head = el('div', 'linkadd');
    head.appendChild(el('span', 'mk', '○'));
    head.appendChild(el('span', 'why', S.filter ? `这个目录下还没有 ${S.filter} 的记录。` : '这里还空着，等待添砖加瓦中…'));
    box.appendChild(head);

    const help = el('details', 'authtips empty-help');
    help.appendChild(el('summary', null, '帮助 · 怎么用'));
    const body = el('div');
    body.innerHTML =
      `<p>先用「＋ 新建目录」建学期，比如 <code>2026-2027 上学期</code>；
        再进去建考试目录，比如 <code>第一次阶段性测试</code>；
        然后把生成的学情分析 HTML 拖进来。</p>
       <p>层级想加多深都行 —— 目录只是个名字，不用改任何设置。</p>
       <p>🔴 文档里有学生姓名和分数，走的是<b>私有存储桶</b>，只有登录后你自己能看。</p>`;
    help.appendChild(body);
    box.appendChild(help);
    f.appendChild(box);
    return f;
  }

  /* 批量选择条：勾了就出现，「移动到…」对整批生效 */
  const selbar = el('div', 'selbar');
  selbar.hidden = true;
  f.appendChild(selbar);

  const syncSel = () => {
    // 换目录后把已经不在这页的 id 清掉，避免"看不见却被移走"
    for (const id of [...S.sel]) {
      if (!entries.some((e) => e.id === id)) S.sel.delete(id);
    }
    selbar.innerHTML = '';
    selbar.hidden = S.sel.size === 0;
    if (!S.sel.size) return;

    selbar.appendChild(el('span', 'selbar-n', `已选 ${S.sel.size} 项`));

    const mv = button('移动到…', 'btn-primary');
    mv.addEventListener('click', () => {
      S.form = { kind: 'move', ids: [...S.sel] };
      rerender();
    });
    selbar.appendChild(mv);

    const clr = button('清除');
    clr.addEventListener('click', () => {
      S.sel.clear();
      document.querySelectorAll('.rowcheck').forEach((c) => { c.checked = false; });
      syncSel();
    });
    selbar.appendChild(clr);
  };

  const list = el('div', 'linklist');
  for (const fo of folders) list.appendChild(folderRow(fo, folders));
  for (const it of entries) list.appendChild(entryRow(it, syncSel));
  f.appendChild(list);
  syncSel();

  return f;
}

/* ------------------------------------------------------------
   查看页
   ------------------------------------------------------------ */
async function openFile(item) {
  S.view = { item, loading: true, html: '', error: '' };
  rerender();
  try {
    const blob = await sbStore.download(BUCKET, item.file_path);
    const html = await blob.text();
    S.view = { item, loading: false, html, error: '' };
  } catch (e) {
    S.view = { item, loading: false, html: '', error: e.message };
  }
  rerender();
}

function renderView(itemId) {
  const item = S.items.find((i) => i.id === itemId);
  const f = document.createDocumentFragment();

  if (!item) {
    f.appendChild(pageHead('找不到这份报告', itemId));
    f.appendChild(notice('记录不存在，可能已被删除。', 'bad'));
    const back = el('a', 'btn btn-primary', '← 返回归档');
    back.href = '#/score';
    f.appendChild(back);
    return f;
  }

  const stage = el('div', 'demo-stage');
  const bar = el('div', 'demo-bar');
  const back = el('a', 'btn', '← 返回');
  back.href = '#/score/' + (item.path || []).map(encodeURIComponent).join('/');
  bar.appendChild(back);
  bar.appendChild(el('span', 'demo-title', item.title));
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
    a.download = `${item.title}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  });
  bar.appendChild(dl);
  stage.appendChild(bar);

  if (S.view?.error) {
    stage.appendChild(notice('读取失败：' + S.view.error, 'bad'));
  } else if (S.view?.loading || S.view?.item?.id !== item.id) {
    stage.appendChild(el('p', 'page-sub', '正在读取…'));
    if (!S.view?.loading) openFile(item);
  } else {
    const frame = el('iframe', 'demo-frame');
    // 🔴 sandbox 不给 allow-same-origin：报告跑在独立源里，
    //    碰不到本站的 localStorage 和登录令牌。
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-modals');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = S.view.html;
    frame.title = item.title;
    stage.appendChild(frame);
  }

  f.appendChild(stage);
  return f;
}

/* ------------------------------------------------------------
   入口
   ------------------------------------------------------------ */
let rerender = () => {};
export function bindRerender(fn) { rerender = fn; }

export function renderScore(segments) {
  const f = document.createDocumentFragment();

  if (!isSignedIn()) {
    f.appendChild(pageHead('成绩归档', '登录后即可查看你名下的归档。'));
    f.appendChild(renderAuthCard({
      lead: '用邮箱和密码登录。和作业登记是同一个账号。',
      errorText: S.error || '',
      onSuccess: () => { S.error = ''; S.items = []; primed = false; rerender(); },
    }));
    return f;
  }

  if (S.loading) { f.appendChild(pageHead('成绩归档', '正在读取…')); return f; }
  if (S.error && !S.items.length) {
    f.appendChild(pageHead('成绩归档', '读取失败'));
    f.appendChild(notice(S.error, 'bad'));
    const b = button('重试');
    b.addEventListener('click', async () => {
      S.error = ''; S.loading = true; rerender();
      primed = false;
      await primeScore(true);
      rerender();
    });
    f.appendChild(b);
    return f;
  }

  const segs = segments.slice(1);          // 去掉 'score'

  if (segs[0] === VIEW_PREFIX) return renderView(segs[1] || '');

  const pathArr = segs.filter(Boolean).map(safeDecode);
  return renderDir(pathArr);
}
