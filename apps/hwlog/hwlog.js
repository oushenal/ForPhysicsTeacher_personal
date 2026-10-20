/* ============================================================
   physics · 作业登记（apps/hwlog）
   ------------------------------------------------------------
   由本地版「作业登记系统」（server.py + xlsx）搬上云。
   语义与本地版完全一致：
     · 只录「异常」，其余默认 √
     · 一个批次存在 = 已登记；没有行 = 按时交
   标记：√ 按时交 / ○ 未交 / 补 补交 / 假 请假
   ------------------------------------------------------------
   路由：'#/hwlog'                     班级概览（未登录则显示登录）
         '#/hwlog/<班名>'              该班作业批次列表
         '#/hwlog/<班名>/<assignmentId>' 打钩录入
   ============================================================ */
import { el, safeDecode, toast } from '../../assets/dom.js?v=49';
import { isSignedIn, currentEmail, signOut, sb } from '../../assets/supabase.js?v=49';
import { renderAuthCard } from '../../assets/authcard.js?v=49';
import { renderImport, IMPORT_SEG } from './import.js?v=49';
import { computeStreaks, streakJobsText } from './streak.js?v=49';

/* ------------------------------------------------------------
   标记定义 —— 顺序即点击循环顺序
   ------------------------------------------------------------ */
const MARKS = {
  ok:      { ch: '√', label: '按时交' },
  missing: { ch: '○', label: '未交' },
  redo:    { ch: '补', label: '补交' },
  leave:   { ch: '假', label: '请假' },
};
const CYCLE = ['ok', 'missing', 'redo', 'leave'];
const nextMark = (m) => CYCLE[(CYCLE.indexOf(m) + 1) % CYCLE.length];

/** 路由片段：'#/hwlog/~streak'（跨班统计，不挂在某个班下面） */
const STREAK_SEG = '~streak';

/* ------------------------------------------------------------
   模块状态
   ------------------------------------------------------------ */
const S = {
  loading: false,
  error: '',
  cohorts: [],            // [{id,name,sort,students:[],assignments:[]}]
  marks: null,            // 当前录入页：Map(studentId -> mark)，只放异常
  saving: 'idle',         // idle | saving | saved | error
  saveMsg: '',
  lastEmail: '',          // 上次登录用的邮箱，省得每次重打
  editing: '',            // 班级页：正在改名的 assignment.id
  renaming: false,        // 录入页：改名表单是否展开
  streakMarks: null,      // 全量异常记录 Map<assignmentId, Map<studentId, mark>>（连续缺交统计）
  streakLoading: false,
};

let saveTimer = null;

/* ------------------------------------------------------------
   取数
   ------------------------------------------------------------ */
async function loadCohorts(force = false) {
  if (S.cohorts.length && !force) return S.cohorts;
  const rows = await sb.select(
    'cohorts',
    'select=id,name,sort,students(id,student_no,name,sort,active),assignments(id,title,assign_date,sort)'
    + '&order=sort',
  );
  S.cohorts = (rows || []).map((c) => ({
    ...c,
    students: (c.students || []).filter((s) => s.active).sort((a, b) => a.sort - b.sort),
    assignments: (c.assignments || []).sort((a, b) => a.sort - b.sort),
  }));
  return S.cohorts;
}

const findCohort = (name) => S.cohorts.find((c) => c.name === name) || null;

/* ------------------------------------------------------------
   学号快速标记（移植自本地版右侧栏）
   ------------------------------------------------------------
   本地版的用法：只输**缺交**的人，其余自动 √。
   学号还能只输后两位 —— 2班学号 41401…41445 的最长公共前缀是 414，
   输 05 就等于 41405。三层识别：完整学号 → 补前缀 → 后缀唯一匹配。

   三个都是纯函数（不碰 DOM），方便以后脱离浏览器断言。
   ------------------------------------------------------------ */

/** 全班学号的最长公共前缀；至少留 2 位给用户输，没明显前缀就返回 '' */
function noPrefix(students) {
  const ids = students.map((s) => String(s.student_no));
  if (!ids.length) return '';
  const minLen = Math.min(...ids.map((i) => i.length));
  let p = '';
  for (let i = 0; i < minLen; i++) {
    const ch = ids[0][i];
    if (ids.every((x) => x[i] === ch)) p += ch;
    else break;
  }
  const keep = p.slice(0, Math.max(0, minLen - 2));
  return keep.length >= 2 ? keep : '';
}

/** 一个数字 token → 学号（或错误说明）。byNo: Map<student_no, student> */
function resolveNo(tok, byNo, students, prefix) {
  const idLen = String(students[0]?.student_no || '').length;

  // ① 直接就是完整学号
  if (byNo.has(tok)) return { no: tok };

  let t = tok;
  if (prefix && t.length === 1) t = '0' + t;    // 输 "5" 当 "05"

  // ② 补上前缀后位数刚好
  if (prefix && t.length + prefix.length === idLen && byNo.has(prefix + t)) {
    return { no: prefix + t };
  }

  // ③ 退回按后缀唯一匹配（兼容把 05 输成 405 的情况）
  if (t.length >= 2) {
    const cand = students.filter((s) => String(s.student_no).endsWith(t));
    if (cand.length === 1) return { no: cand[0].student_no };
    if (cand.length > 1) return { err: `以 ${t} 结尾的有 ${cand.length} 人` };
    return { err: `没有学号以 ${t} 结尾` };
  }
  return { err: '位数太短认不出' };
}

/** 一整段文本 → { ids:[studentId…], errs:[{tok, why}] } */
function parseNos(text, students, prefix) {
  const byNo = new Map(students.map((s) => [String(s.student_no), s]));
  const out = { ids: [], errs: [] };
  const seen = new Set();
  for (const tok of String(text || '').match(/\d+/g) || []) {
    const r = resolveNo(tok, byNo, students, prefix);
    if (r.err) { out.errs.push({ tok, why: r.err }); continue; }
    const st = byNo.get(r.no);
    if (!st || seen.has(st.id)) continue;
    seen.add(st.id);
    out.ids.push(st.id);
  }
  return out;
}

/** 读一个批次的异常标记 → Map（只含异常） */
async function loadMarks(assignmentId) {
  const rows = await sb.select(
    'hw_marks',
    `select=student_id,mark&assignment_id=eq.${assignmentId}`,
  );
  return new Map((rows || []).map((r) => [r.student_id, r.mark]));
}

/** 保存：先 upsert（保住数据），再删掉不在集合里的 —— 顺序不能反 */
async function saveMarks(assignmentId, marks) {
  const rows = [...marks].map(([student_id, mark]) => ({
    assignment_id: assignmentId, student_id, mark,
  }));
  if (rows.length) await sb.upsert('hw_marks', rows, 'assignment_id,student_id');

  const keep = [...marks.keys()];
  const filter = keep.length
    ? `assignment_id=eq.${assignmentId}&student_id=not.in.(${keep.map((k) => `"${k}"`).join(',')})`
    : `assignment_id=eq.${assignmentId}`;
  await sb.del('hw_marks', filter);
}

/** 拉**全量**异常记录 → Map<assignmentId, Map<studentId, mark>>（连续缺交统计用） */
async function loadAllMarks() {
  const rows = await sb.select('hw_marks', 'select=assignment_id,student_id,mark');
  const m = new Map();
  for (const r of rows || []) {
    if (!r || !r.assignment_id || !r.student_id) continue;
    if (!m.has(r.assignment_id)) m.set(r.assignment_id, new Map());
    m.get(r.assignment_id).set(r.student_id, r.mark);
  }
  return m;
}

/* ------------------------------------------------------------
   通用小件
   ------------------------------------------------------------ */
function pageHead(title, sub) {
  const h = el('div', 'page-head');
  h.appendChild(el('h1', null, title));
  if (sub) h.appendChild(el('p', 'page-sub', sub));
  return h;
}

function notice(text, kind) {
  const n = el('div', 'notice');
  if (kind) n.dataset.kind = kind;
  n.appendChild(el('span', 'mk', kind === 'bad' ? '○' : '●'));
  n.appendChild(el('span', 'notice-txt', text));
  return n;
}

function button(text, cls) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.textContent = text;
  return b;
}

const fmtDate = (d) => (d ? d.slice(5).replace('-', '月') + '日' : '');

/* ------------------------------------------------------------
   登录面板 —— 已抽到 assets/authcard.js（成绩归档也要用同一份）
   这里只负责把它摆到页面里，别再写第二份登录表单。
 ------------------------------------------------------------ */

/* ------------------------------------------------------------
   概览：班级卡片
   ------------------------------------------------------------ */
function cohortCard(c) {
  const a = el('a', 'card');
  a.href = `#/hwlog/${encodeURIComponent(c.name)}`;

  const last = c.assignments[c.assignments.length - 1];
  a.appendChild(el('span', 'card-no', String(c.sort || '').padStart(2, '0')));
  a.appendChild(el('h2', 'card-title', c.name));
  a.appendChild(el('p', 'card-desc',
    last ? `最近：${last.title}` : '还没有登记过作业'));

  const meta = el('div', 'card-meta');
  const mk = el('span', 'mk', '●');
  mk.dataset.state = c.assignments.length ? 'ok' : 'warn';
  meta.appendChild(mk);
  const t = el('span');
  t.innerHTML = `<b>${c.students.length} 人</b> · ${c.assignments.length} 次作业`;
  meta.appendChild(t);
  a.appendChild(meta);

  const foot = el('div', 'card-foot');
  foot.appendChild(el('span', 'card-cta', '打开登记'));
  foot.appendChild(el('span', 'card-store', 'Supabase'));
  a.appendChild(foot);
  return a;
}

function renderOverview() {
  const f = document.createDocumentFragment();

  const who = currentEmail();
  f.appendChild(pageHead('作业登记', `${who} · 已登录`));

  const bar = el('div', 'toolbar');
  const out = button('退出登录');
  out.addEventListener('click', () => { signOut(); rerender(); });
  bar.appendChild(out);
  f.appendChild(bar);

  if (S.error) f.appendChild(notice(S.error, 'bad'));

  if (!S.cohorts.length) {
    const box = el('div', 'linklist');
    const head = el('div', 'linkadd');
    head.appendChild(el('span', 'mk', '○'));
    head.appendChild(el('span', 'why', '还没有班级数据。'));
    box.appendChild(head);
    const body = el('div', 'howto');
    body.innerHTML =
      `<p>依次执行 <code>docs/</code> 下的三段 SQL：<br>
        <code>1-建表.sql</code> → <code>2-RLS策略.sql</code> → <code>3-导入现有数据.sql</code></p>
       <p>第 3 段会把你在本地版里已经登记的 2班 / 6班 全部导进来。</p>`;
    box.appendChild(body);
    f.appendChild(box);
    return f;
  }

  const grid = el('div', 'grid');
  for (const c of S.cohorts) grid.appendChild(cohortCard(c));
  const n = (4 - (S.cohorts.length % 4)) % 4;
  for (let i = 0; i < n; i++) {
    const g = el('div', 'card card-ghost');
    g.setAttribute('aria-hidden', 'true');
    grid.appendChild(g);
  }
  f.appendChild(grid);

  // 底部入口：跨班连续缺交统计
  const tools = el('div', 'linklist homeadd');
  const streakLink = el('a', 'linkadd linkadd-btn');
  streakLink.href = `#/hwlog/${STREAK_SEG}`;
  streakLink.appendChild(el('span', 'mk', '○'));
  streakLink.appendChild(el('span', 'why', '连续缺交名单'));
  streakLink.appendChild(el('span', 'homeadd-n', '两个班 · 连续 2 次以上未交'));
  tools.appendChild(streakLink);
  f.appendChild(tools);

  return f;
}

/* ------------------------------------------------------------
   某个班的批次列表
   ------------------------------------------------------------ */
function assignmentRow(c, a, idx, arr) {
  // 正在改名的这一行整行换成输入框（列表里就地改，不用开弹窗）
  if (S.editing === a.id) return assignmentEditRow(c, a);

  const row = el('div', 'linkrow');

  const link = el('a', 'linkrow-a');
  link.href = `#/hwlog/${encodeURIComponent(c.name)}/${a.id}`;
  link.appendChild(el('span', 'link-name', a.title));
  link.appendChild(el('span', 'link-desc', fmtDate(a.assign_date) || ''));
  link.appendChild(el('span', 'link-url', ''));
  link.appendChild(el('span', 'link-go', '→'));
  row.appendChild(link);

  const act = el('span', 'rowact');

  // ↑/↓ 调整次序 —— 延后录入 / 补录的时候，要把新作业挪到它该在的位置。
  // （不做 HTML5 拖拽：触屏上拖拽体验差，老师多半用手机录作业；上下按钮两下就到位。）
  const up = button('↑', 'iconbtn');
  const dn = button('↓', 'iconbtn');
  up.disabled = idx === 0;
  dn.disabled = idx === arr.length - 1;
  up.title = '上移（改变显示顺序）';
  dn.title = '下移（改变显示顺序）';
  up.addEventListener('click', () => moveAssignment(c, arr, idx, -1, up));
  dn.addEventListener('click', () => moveAssignment(c, arr, idx, +1, dn));
  act.appendChild(up);
  act.appendChild(dn);

  const ren = button('改名', 'iconbtn');
  ren.title = '改这次作业的名称';
  ren.addEventListener('click', () => { S.editing = a.id; rerender(); });
  act.appendChild(ren);

  act.appendChild(twoStepDelete(() => removeAssignment(c, a)));
  row.appendChild(act);
  return row;
}

/* ------------------------------------------------------------
   改作业名称
   ------------------------------------------------------------
   两处入口（班级列表行内 / 录入页工具栏）共用 renameAssignment。
   注意表上有 unique(cohort_id, title)：重名会撞库，
   所以先在内存里查一遍给出人话提示，真撞了再把英文错误转成人话。
   ------------------------------------------------------------ */
async function renameAssignment(c, a, raw) {
  const t = String(raw || '').trim();
  if (!t) throw new Error('名字不能空着');
  if (t === a.title) return false;                        // 没改
  if (c.assignments.some((x) => x.id !== a.id && x.title === t)) {
    throw new Error(`这个班已经有一次叫「${t}」了`);
  }
  await sb.update('assignments', `id=eq.${a.id}`, { title: t });
  a.title = t;
  return true;
}

/** 把 database 的英文报错翻成能看懂的一句 */
function renameErr(e) {
  const m = String(e && e.message || '');
  if (/duplicate|unique|23505/i.test(m)) return '这个班已经有一次同名作业了';
  return m || '未知错误';
}

/** 班级列表里的「改名」行：输入框 + 保存 / 取消 */
function assignmentEditRow(c, a) {
  const row = el('div', 'linkrow linkrow--edit');

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'input linkrow-input';
  inp.value = a.title;
  inp.setAttribute('aria-label', '作业名称');
  row.appendChild(inp);

  const act = el('span', 'rowact');
  const save = button('保存', 'iconbtn iconbtn--go');
  const cancel = button('取消', 'iconbtn');
  act.appendChild(save);
  act.appendChild(cancel);
  row.appendChild(act);

  const close = () => { S.editing = ''; rerender(); };
  cancel.addEventListener('click', close);

  save.addEventListener('click', async () => {
    save.disabled = true; save.textContent = '保存中…';
    try {
      const changed = await renameAssignment(c, a, inp.value);
      S.editing = '';
      if (changed) toast(`已改名为「${a.title}」`);
      rerender();
    } catch (e) {
      save.disabled = false; save.textContent = '保存';
      inp.focus(); inp.select();
      toast('改名失败：' + renameErr(e));
    }
  });

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save.click(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  setTimeout(() => { inp.focus(); inp.select(); }, 0);
  return row;
}

/**
 * 交换两个相邻批次的 sort，并写回数据库。
 * arr 是**显示顺序**数组（最新在前 = sort 降序），idx 即行号：
 *   「上移」(dir=-1) = 与上面那次（idx-1）交换
 *   「下移」(dir=+1) = 与下面那次（idx+1）交换
 * 交换方式 = 互换两者的 sort 值（若相等则用序号兜底错开）。
 */
async function moveAssignment(c, arr, idx, dir, btn) {
  const a = arr[idx];
  const b = arr[idx + dir];
  if (!a || !b) return;
  btn.disabled = true;

  // ⚠️ 局部变量千万别叫 sb —— 会遮蔽模块顶部 import 进来的 Supabase 客户端 sb
  const sortA = a.sort ?? 0;
  const sortB = b.sort ?? 0;
  // 简单交换 sort 值；若两值相等（历史数据 sort 可能都是 0），错开一格
  let na = sortB;
  let nb = sortA;
  if (na === nb) { na = sortA - dir; nb = sortB + dir; }

  try {
    // 先改数据库（各自写自己的 sort），再改内存，顺序反了重绘会用旧值盖掉
    await sb.update('assignments', `id=eq.${a.id}`, { sort: na });
    await sb.update('assignments', `id=eq.${b.id}`, { sort: nb });
    a.sort = na;
    b.sort = nb;
    S.error = '';
    rerender();
  } catch (e) {
    S.error = '调整顺序失败：' + e.message;
    rerender();
  }
}

/** 两步确认的删除按钮：点「删除」变成「确认删除 / 取消」。
    不用 confirm() 弹窗 —— 手机上那个太容易点错，而且拦不住误触。 */
function twoStepDelete(onConfirm, cls = 'iconbtn') {
  const act = el('span', 'stepdel');

  const del = button('删除', cls);
  const ok = button('确认删除', cls + ' ' + cls + '--danger');
  const no = button('取消', cls);
  ok.hidden = true; no.hidden = true;

  del.addEventListener('click', () => {
    del.hidden = true; ok.hidden = false; no.hidden = false;
    setTimeout(() => { if (!ok.hidden) { del.hidden = false; ok.hidden = true; no.hidden = true; } }, 6000);
  });
  no.addEventListener('click', () => {
    del.hidden = false; ok.hidden = true; no.hidden = true;
  });
  ok.addEventListener('click', async () => {
    ok.disabled = no.disabled = true;
    ok.textContent = '删除中…';
    try { await onConfirm(); } catch (e) {
      S.error = '删除失败：' + e.message;
      rerender();
    }
  });

  act.appendChild(del); act.appendChild(ok); act.appendChild(no);
  return act;
}

async function removeAssignment(c, a) {
  await sb.del('assignments', `id=eq.${a.id}`);   // 明细靠外键级联一起删掉
  const i = c.assignments.findIndex((x) => x.id === a.id);
  if (i >= 0) c.assignments.splice(i, 1);
  if (S.marksFor === a.id) { S.marksFor = ''; S.marks = null; }
  S.error = '';
  rerender();
}

/* ------------------------------------------------------------
   导出 CSV（结构与旧版 xlsx 一致：行=学生，列=每次作业 + 统计列）
   ------------------------------------------------------------ */
const MARK_CH = { ok: '√', missing: '○', redo: '补', leave: '假' };

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * 纯函数：把「班级 + 每次作业的异常标记」拼成 CSV 文本。
 * 抽成纯函数是为了能脱离浏览器直接测（见 _t.mjs）。
 * @param cohort  {name, students:[{id,student_no,name}], assignments:[{id,title}]}
 * @param marksByAssignment Map<assignmentId, Map<studentId, mark>>
 */
export function buildCsv(cohort, marksByAssignment) {
  const asgs = cohort.assignments;
  const head = ['学号', '姓名', ...asgs.map((a) => a.title),
    '按时交', '补交', '未交', '请假', '合计'];

  const lines = [head];
  const total = { ok: 0, redo: 0, missing: 0, leave: 0 };

  for (const s of cohort.students) {
    const row = [s.student_no, s.name];
    const cnt = { ok: 0, redo: 0, missing: 0, leave: 0 };
    for (const a of asgs) {
      const m = marksByAssignment.get(a.id)?.get(s.id) || 'ok';
      cnt[m] = (cnt[m] || 0) + 1;
      row.push(MARK_CH[m] || MARK_CH.ok);
    }
    total.ok += cnt.ok; total.redo += cnt.redo;
    total.missing += cnt.missing; total.leave += cnt.leave;
    row.push(cnt.ok, cnt.redo, cnt.missing, cnt.leave, asgs.length);
    lines.push(row);
  }

  // 合计行：跟旧 xlsx 一样，统计列求和、作业列留空
  lines.push(['合计', `${cohort.students.length} 人`,
    ...asgs.map(() => ''), total.ok, total.redo, total.missing, total.leave,
    cohort.students.length * asgs.length]);

  // \uFEFF = BOM，不加的话 Excel 打开中文是乱码
  return '\uFEFF' + lines.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function exportCohort(c, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '导出中…';
  try {
    const ids = c.assignments.map((a) => a.id);
    const rows = ids.length
      ? await sb.select('hw_marks',
          'select=assignment_id,student_id,mark&assignment_id=in.('
          + ids.map((i) => `"${i}"`).join(',') + ')')
      : [];

    const byAsg = new Map();
    for (const r of rows || []) {
      if (!byAsg.has(r.assignment_id)) byAsg.set(r.assignment_id, new Map());
      byAsg.get(r.assignment_id).set(r.student_id, r.mark);
    }

    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    downloadText(`作业登记_${c.name}_${stamp}.csv`, buildCsv(c, byAsg));

    btn.textContent = '已导出 ✓';
    setTimeout(() => { btn.textContent = label; }, 1800);
  } catch (e) {
    S.error = '导出失败：' + e.message;
    rerender();
  } finally {
    btn.disabled = false;
  }
}

function renderCohort(c) {
  S.renaming = false;              // 从录入页回到列表时，收起那边的改名表单
  const f = document.createDocumentFragment();
  f.appendChild(pageHead(c.name, `${c.students.length} 人 · ${c.assignments.length} 次作业`));

  const bar = el('div', 'toolbar');
  const back = el('a', 'btn', '← 班级');
  back.href = '#/hwlog';
  bar.appendChild(back);

  const add = button('＋ 新建一次作业', 'btn-primary');
  add.addEventListener('click', () => createAssignment(c, add));
  bar.appendChild(add);

  const imp = el('a', 'btn', '⬆ 导入 Excel');
  imp.href = `#/hwlog/${encodeURIComponent(c.name)}/${IMPORT_SEG}`;
  imp.title = '把旧表（行=学生、列=作业）整个导进来';
  bar.appendChild(imp);

  const exp = button('导出表格');
  exp.title = '导出成 CSV，Excel / WPS 双击就能打开（结构和旧版总表一样）';
  exp.addEventListener('click', () => exportCohort(c, exp));
  bar.appendChild(exp);
  f.appendChild(bar);

  if (S.error) f.appendChild(notice(S.error, 'bad'));

  if (!c.assignments.length) {
    const box = el('div', 'linklist');
    const head = el('div', 'linkadd');
    head.appendChild(el('span', 'mk', '○'));
    head.appendChild(el('span', 'why', '这个班还没有登记过作业。'));
    box.appendChild(head);
    f.appendChild(box);
    return f;
  }

  const list = el('div', 'linklist');
  // 显示顺序 = 最新在前（sort 大的在上面）。arr 就是显示顺序数组，
  // idx 直接对应「第几行」，↑/↓ 语义跟着视觉走，不绕弯。
  const disp = [...c.assignments].sort((x, y) => (y.sort ?? 0) - (x.sort ?? 0));
  for (let i = 0; i < disp.length; i++) {
    list.appendChild(assignmentRow(c, disp[i], i, disp));
  }
  f.appendChild(list);

  const tip = el('p', 'howto-detail',
    '点「改名」可改这次作业的名称；右边 ↑↓ 调整次序（补录、延后录入时用）。'
    + '「导出表格」把整个班导出成 CSV：'
    + '行是学生、列是每次作业，末尾带按时交/补交/未交/请假/合计统计列'
    + '—— 和你原来那份「作业登记总表.xlsx」结构一致，直接用 Excel 或 WPS 打开即可。');
  f.appendChild(tip);

  return f;
}

/**
 * 录入页的改名表单（工具栏「改名」展开）。
 * 和班级列表的行内编辑共用 renameAssignment，校验与写库逻辑只有一份。
 */
function renameForm(c, a) {
  const box = el('div', 'formpanel');
  box.appendChild(el('p', 'formpanel-title', '改作业名称'));

  const rows = el('div', 'formrows');
  const field = el('label', 'field');
  field.appendChild(el('span', 'field-label', '名称'));
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'input';
  inp.value = a.title;
  inp.placeholder = '例如：9月24日 练习册 P32';
  field.appendChild(inp);
  rows.appendChild(field);
  box.appendChild(rows);

  const bar = el('div', 'formbar');
  const save = button('保存', 'btn-primary');
  const cancel = button('取消');
  bar.appendChild(save);
  bar.appendChild(cancel);
  box.appendChild(bar);

  const close = () => { S.renaming = false; rerender(); };
  cancel.addEventListener('click', close);

  save.addEventListener('click', async () => {
    save.disabled = true; save.textContent = '保存中…';
    try {
      const changed = await renameAssignment(c, a, inp.value);
      S.renaming = false;
      if (changed) toast(`已改名为「${a.title}」`);
      rerender();
    } catch (e) {
      save.disabled = false; save.textContent = '保存';
      inp.focus(); inp.select();
      toast('改名失败：' + renameErr(e));
    }
  });

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save.click(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  setTimeout(() => { inp.focus(); inp.select(); }, 0);
  return box;
}

async function createAssignment(c, btn) {
  const title = prompt('这次作业叫什么？', defaultTitle(c));
  if (title == null) return;
  const t = title.trim() || defaultTitle(c);
  btn.disabled = true;
  try {
    const [row] = await sb.insert('assignments', {
      cohort_id: c.id, title: t,
      sort: (c.assignments.at(-1)?.sort || 0) + 1,
    });
    c.assignments.push(row);
    location.hash = `#/hwlog/${encodeURIComponent(c.name)}/${row.id}`;
  } catch (e) {
    S.error = '新建失败：' + e.message;
    rerender();
  } finally {
    btn.disabled = false;
  }
}

function defaultTitle(c) {
  const d = new Date();
  const n = c.assignments.length + 1;
  return `${d.getMonth() + 1}月${d.getDate()}日 作业`;
}

/* ------------------------------------------------------------
   录入页
   ------------------------------------------------------------ */
function counts(marks, total) {
  const c = { ok: total, missing: 0, redo: 0, leave: 0 };
  for (const m of marks.values()) { c.ok -= 1; c[m] = (c[m] || 0) + 1; }
  return c;
}

function renderEntry(c, assignment) {
  S.editing = '';                  // 从列表进到录入页，清掉列表里的行内编辑态
  const f = document.createDocumentFragment();

  f.appendChild(pageHead(assignment.title, `${c.name} · ${c.students.length} 人`));

  const bar = el('div', 'toolbar');
  const back = el('a', 'btn', '← ' + c.name);
  back.href = `#/hwlog/${encodeURIComponent(c.name)}`;
  bar.appendChild(back);

  const allOk = button('全部已交');
  allOk.title = '把所有学生重置为按时交，再单独点掉没交的人';
  allOk.addEventListener('click', () => {
    S.marks.clear();
    paintRoster();
    paintStat();
    quick.syncInputsFromMarks();     // 右边输入框也要清空
    scheduleSave();
  });
  bar.appendChild(allOk);

  const copy = button('复制未交名单');
  copy.addEventListener('click', async () => {
    const names = c.students
      .filter((s) => S.marks.get(s.id) === 'missing')
      .map((s) => `${s.student_no} ${s.name}`);
    const text = names.length
      ? `${c.name} · ${assignment.title} · 未交 ${names.length} 人\n${names.join('\n')}`
      : `${c.name} · ${assignment.title} · 全员交齐`;
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = '已复制 ✓';
      setTimeout(() => { copy.textContent = '复制未交名单'; }, 1600);
    } catch {
      prompt('复制失败，手动选一下吧：', text);
    }
  });
  bar.appendChild(copy);

  const ren = button('改名');
  ren.title = '改这次作业的名称';
  ren.addEventListener('click', () => { S.renaming = !S.renaming; rerender(); });
  bar.appendChild(ren);

  // 删除放在最右边，跟常用操作拉开距离，避免手滑
  bar.appendChild(twoStepDelete(async () => {
    await sb.del('assignments', `id=eq.${assignment.id}`);
    const i = c.assignments.findIndex((x) => x.id === assignment.id);
    if (i >= 0) c.assignments.splice(i, 1);
    S.marksFor = ''; S.marks = null; S.error = '';
    location.hash = `#/hwlog/${encodeURIComponent(c.name)}`;
    rerender();
  }, 'btn'));

  f.appendChild(bar);

  // 改名表单（点工具栏「改名」展开）
  if (S.renaming) f.appendChild(renameForm(c, assignment));

  if (S.error) f.appendChild(notice(S.error, 'bad'));

  const stat = el('div', 'status');
  const roster = el('div', 'roster');
  const saveMsg = el('p', 'savemsg');

  /* ---------- 布局：左名单 / 右学号面板 ----------
     电脑端面板贴右（和本地版同一位置）；窄屏落成单列、面板在名单**上面**
     —— 手机上「输学号」才是主操作，不该先滚过 45 个人才够得着。
     DOM 顺序 = 面板在前，桌面用 grid 显式放到第 2 列。 */
  const layout = el('div', 'entry-layout');
  const mainCol = el('div', 'entry-main');
  mainCol.appendChild(stat);
  mainCol.appendChild(roster);
  mainCol.appendChild(el('p', 'howto-detail',
    '点一下学生切换标记：√ 按时交 → ○ 未交 → 补 补交 → 假 请假。'
    + '改动会自动保存；也可以在右边按学号批量输。'));
  mainCol.appendChild(saveMsg);
  layout.appendChild(mainCol);

  /* ------------------------------------------------------------
     学号面板（移植自本地版右侧栏）
     ------------------------------------------------------------
     · 三个输入组：未交 / 补交 / 请假，各自独立
     · 输入框里只写学号（可只写后两位），其余人自动 √
     · 打开时会把已有标记**反显**到框里 —— 能直接看到谁没交，也能就地改
     · 与名单双向同步：点名单后重写输入框（正在打字时跳过，不打断）
     ------------------------------------------------------------ */
  function buildQuickPanel() {
    const prefix = noPrefix(c.students);
    const shortNo = (no) => {
      const s = String(no);
      return prefix && s.startsWith(prefix) ? s.slice(prefix.length) : s;
    };
    const KINDS = [
      { k: 'missing', ch: '○', label: '未交', hint: '没交作业' },
      { k: 'redo', ch: '补', label: '补交', hint: '后来补上了' },
      { k: 'leave', ch: '假', label: '请假', hint: '请假未交' },
    ];
    const Q = { missing: new Set(), redo: new Set(), leave: new Set() };
    const inputs = {};
    const chipBoxes = {};
    const countEls = {};

    const panel = el('aside', 'qpanel');
    const head = el('div', 'qpanel-head');
    head.appendChild(el('h2', 'qpanel-t', '按学号标记'));
    const sub = el('p', 'qpanel-d');
    sub.innerHTML = prefix
      ? `只输<b>缺交</b>的人，其余自动 √。前缀 <b>${prefix}</b> 已补好，输后两位就行（<b>05 12 20</b>）。`
      : '只输<b>缺交</b>的人，其余自动 √。空格 / 逗号 / 换行分隔。';
    head.appendChild(sub);
    panel.appendChild(head);

    const applyQuick = (kind, ids) => {
      const next = new Set(ids);
      // 上次声明过、这次不声明的 → 如果标记还停在这一组，就恢复成 √
      for (const id of Q[kind]) {
        if (!next.has(id) && S.marks.get(id) === kind) S.marks.delete(id);
      }
      for (const id of next) S.marks.set(id, kind);
      Q[kind] = next;
    };

    const paintChips = (kind, errs = []) => {
      const box = chipBoxes[kind];
      box.innerHTML = '';
      for (const id of Q[kind]) {
        const st = c.students.find((x) => x.id === id);
        if (!st) continue;
        const chip = el('span', 'qchip', shortNo(st.student_no) + ' ' + st.name);
        chip.title = `${st.student_no} ${st.name}（点一下去掉）`;
        chip.addEventListener('click', () => {
          // 从输入框里删掉这个人，再重新解析（保持"输入框是唯一真相"）
          const rest = [...Q[kind]].filter((x) => x !== id);
          inputs[kind].value = rest
            .map((x) => shortNo(c.students.find((s) => s.id === x)?.student_no || ''))
            .join(' ');
          syncFromInput(kind);
        });
        box.appendChild(chip);
      }
      for (const e of errs) {
        box.appendChild(el('span', 'qchip qchip--bad', `⚠ ${e.tok} · ${e.why}`));
      }
      countEls[kind].textContent = String(Q[kind].size);
    };

    let timer = null;
    function syncFromInput(kind) {
      const r = parseNos(inputs[kind].value, c.students, prefix);
      applyQuick(kind, r.ids);
      paintChips(kind, r.errs);
      paintRoster();
      paintStat();
      scheduleSave();
    }

    for (const it of KINDS) {
      const grp = el('div', 'qgrp');
      const gh = el('div', 'qgrp-head');
      const mk = el('span', 'mk', it.ch);
      mk.dataset.state = it.k === 'missing' ? 'warn' : 'off';
      gh.appendChild(mk);
      gh.appendChild(el('span', null, it.label));
      gh.appendChild(el('span', 'qgrp-hint', it.hint));
      const cnt = el('span', 'qcount', '0');
      gh.appendChild(cnt);
      countEls[it.k] = cnt;
      grp.appendChild(gh);

      const box = el('div', 'qbox');
      if (prefix) box.appendChild(el('span', 'qprefix', prefix));
      const ta = document.createElement('textarea');
      ta.className = 'qinput';
      ta.rows = 2;
      ta.placeholder = it.k === 'missing' ? '05 12 20' : '选填';
      ta.setAttribute('aria-label', `${it.label}学生学号`);
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => syncFromInput(it.k), 140);
      });
      inputs[it.k] = ta;
      box.appendChild(ta);
      grp.appendChild(box);

      const chips = el('div', 'qchips');
      chipBoxes[it.k] = chips;
      grp.appendChild(chips);

      panel.appendChild(grp);
    }

    /** 名单 → 输入框（点名单后调用；正在打字的那一格跳过，不打断） */
    function syncInputsFromMarks() {
      for (const it of KINDS) {
        const ids = c.students.filter((s) => S.marks.get(s.id) === it.k).map((s) => s.id);
        Q[it.k] = new Set(ids);
        countEls[it.k].textContent = String(ids.length);
        if (document.activeElement === inputs[it.k]) {
          // 正在这格里打字：不重写内容（会打断光标），但错误提示要照常重算，
          // 否则框里留着一个认不出的学号却没有告警。
          const r = parseNos(inputs[it.k].value, c.students, prefix);
          paintChips(it.k, r.errs);
          continue;
        }
        inputs[it.k].value = ids
          .map((id) => shortNo(c.students.find((s) => s.id === id)?.student_no || ''))
          .join(' ');
        paintChips(it.k);
      }
    }

    // 打开时把已有标记反显到框里
    syncInputsFromMarks();
    return { node: panel, syncInputsFromMarks };
  }

  const quick = buildQuickPanel();
  layout.appendChild(quick.node);     // DOM 在前 → 移动端落在名单上方
  layout.appendChild(mainCol);        // 桌面端由 CSS 把面板放回第 2 列
  f.appendChild(layout);

  function paintStat() {
    stat.innerHTML = '';
    const cnt = counts(S.marks, c.students.length);
    const items = [
      ['ok', `按时交 ${cnt.ok}`],
      ['missing', `未交 ${cnt.missing}`],
      ['redo', `补交 ${cnt.redo}`],
      ['leave', `请假 ${cnt.leave}`],
    ];
    for (const [k, label] of items) {
      const it = el('div', 'status-item');
      const mk = el('span', 'mk', MARKS[k].ch);
      mk.dataset.state = k === 'missing' ? 'warn' : (k === 'ok' ? 'ok' : 'off');
      it.appendChild(mk);
      it.appendChild(el('span', null, label));
      stat.appendChild(it);
    }
  }

  function paintRoster() {
    roster.innerHTML = '';
    for (const s of c.students) {
      const mark = S.marks.get(s.id) || 'ok';
      const b = el('button', 'stuchip');
      b.type = 'button';
      b.dataset.mark = mark;
      b.appendChild(el('span', 'stuno', s.student_no));
      b.appendChild(el('span', 'stuname', s.name));
      b.appendChild(el('span', 'stumark', MARKS[mark].ch));
      b.title = `${s.name} · ${MARKS[mark].label}`;
      b.addEventListener('click', () => {
        const nx = nextMark(mark);
        if (nx === 'ok') S.marks.delete(s.id);
        else S.marks.set(s.id, nx);
        paintRoster();
        paintStat();
        quick.syncInputsFromMarks();   // 名单改了 → 右边输入框跟着变
        scheduleSave();
      });
      roster.appendChild(b);
    }
  }

  function scheduleSave() {
    S.saving = 'saving';
    saveMsg.textContent = '保存中…';
    saveMsg.dataset.kind = '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveMarks(assignment.id, S.marks);
        S.saving = 'saved';
        saveMsg.textContent = '已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      } catch (e) {
        S.saving = 'error';
        saveMsg.textContent = '保存失败：' + e.message;
        saveMsg.dataset.kind = 'bad';
      }
    }, 700);
  }

  paintStat();
  paintRoster();
  return f;
}

/* ------------------------------------------------------------
   连续缺交统计（'#/hwlog/~streak'）
   ------------------------------------------------------------
   规则见 apps/hwlog/streak.js 的文件头：
   从最近一次作业往回数「○ 未交」，遇到 √ / 补 / 假 就停；
   连续 ≥2 次才列出，并显示次数和具体是哪几次。

   ⚠️ 统计基准 = 每个班 sort 最大的那次作业。如果某个批次
   「建了但还没录」，它会被当成全员 √，把所有人的连续记录打断 ——
   所以页面顶部把基准作业标题写出来，让人一眼看出数据对不对。
   ------------------------------------------------------------ */
function renderStreak() {
  const f = document.createDocumentFragment();

  f.appendChild(pageHead('连续缺交', '从最近一次作业往回数，连续 2 次及以上未交的学生。'));

  const bar = el('div', 'toolbar');
  const back = el('a', 'btn', '← 作业登记');
  back.href = '#/hwlog';
  bar.appendChild(back);

  // 复制按钮放在顶部工具栏（放页面最下方会被误以为是最后一个班的按钮）
  const copyLines = [];
  const cp = button('复制名单');
  cp.addEventListener('click', async () => {
    if (!copyLines.length) { toast('没有连续缺交的学生'); return; }
    const text = `连续缺交（${new Date().toLocaleDateString('zh-CN')}）\n` + copyLines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      cp.textContent = '已复制 ✓';
      setTimeout(() => { cp.textContent = '复制名单'; }, 1600);
    } catch {
      prompt('复制失败，手动选一下吧：', text);
    }
  });
  bar.appendChild(cp);
  f.appendChild(bar);

  if (S.error) f.appendChild(notice(S.error, 'bad'));

  /* 首次进来先拉全量异常记录 */
  if (!S.streakMarks) {
    if (!S.streakLoading) {
      S.streakLoading = true;
      loadAllMarks()
        .then((m) => { S.streakMarks = m; S.streakLoading = false; rerender(); })
        .catch((e) => { S.streakLoading = false; S.error = '统计失败：' + e.message; rerender(); });
    }
    f.appendChild(el('p', 'page-sub', '正在统计…'));
    return f;
  }

  const rule = el('div', 'howto');
  rule.innerHTML =
    `<p>只算「<b>○ 未交</b>」。遇到 √ 交了、<b>补</b> 补交、<b>假</b> 请假都算中断 —— `
    + `补交说明交了，请假不算缺交，所以它们都会把连续记录断开。</p>
     <p>只列出连续 <b>2 次及以上</b>的；只缺 1 次不显示。</p>`;
  f.appendChild(rule);

  // copyLines 在工具栏那一段已经声明（按钮的闭包要用它）
  let total = 0;

  for (const c of S.cohorts) {
    // sort 升序（旧→新）给计算用；显示时按「最新在前」
    const asg = [...c.assignments].sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
    const list = computeStreaks(c.students, asg, S.streakMarks);
    total += list.length;

    const sec = el('div', 'sect');
    sec.appendChild(el('h2', null, c.name));
    sec.appendChild(el('span', 'cnt', list.length ? `${list.length} 人` : '无'));
    sec.appendChild(el('span', 'rule'));
    f.appendChild(sec);

    const last = asg[asg.length - 1];
    const baseLine = el('p', 'page-sub');
    baseLine.textContent = last
      ? `基准：最近一次「${last.title}」${fmtDate(last.assign_date) ? ' · ' + fmtDate(last.assign_date) : ''}`
      : '这个班还没有登记过作业';
    f.appendChild(baseLine);

    if (!list.length) {
      const box = el('div', 'linklist');
      const head = el('div', 'linkadd');
      head.appendChild(el('span', 'mk', '●'));
      head.appendChild(el('span', 'why',
        last ? '没有连续缺交两次的学生。' : '还没有作业记录，谈不上连续。'));
      box.appendChild(head);
      f.appendChild(box);
      continue;
    }

    const box = el('div', 'linklist');
    for (const r of list) {
      const row = el('div', 'streakrow');

      row.appendChild(el('span', 'stuno', r.student_no));
      row.appendChild(el('span', 'stuname', r.name));

      const n = el('span', 'streakn', `连续 ${r.streak} 次`);
      row.appendChild(n);

      const jobs = el('span', 'streakjobs');
      jobs.textContent = streakJobsText(r.jobs);
      jobs.title = r.jobs.map((j) => j.title).join('\n');
      row.appendChild(jobs);

      box.appendChild(row);
      copyLines.push(`${c.name} ${r.student_no} ${r.name} 连续 ${r.streak} 次（${streakJobsText(r.jobs)}）`);
    }
    f.appendChild(box);
  }

  if (!total) {
    f.appendChild(notice('两个班都没有连续缺交两次的学生。'));
  }

  return f;
}

/* ------------------------------------------------------------
   入口
   ------------------------------------------------------------ */
export function renderHwlog(segments) {
  const f = document.createDocumentFragment();

  // 令牌失效时 supabase.js 会清掉会话 —— 那就直接回登录面板，
  // 并把原因带过去（别让人对着一个永远失败的重试按钮发呆）
  if (!isSignedIn()) {
    f.appendChild(pageHead('作业登记', '登录后即可读写你名下的班级和记录。'));
    f.appendChild(renderAuthCard({
      errorText: S.error || '',
      onSuccess: () => { S.error = ''; S.cohorts = []; S.marksFor = ''; rerender(); },
    }));
    return f;
  }

  if (S.loading) { f.appendChild(pageHead('作业登记', '正在读取…')); return f; }
  if (S.error) {
    f.appendChild(pageHead('作业登记', '读取失败'));
    f.appendChild(notice(S.error, 'bad'));
    const b = button('重试');
    b.addEventListener('click', async () => {
      S.error = ''; S.cohorts = []; S.marksFor = '';
      S.loading = true; rerender();          // 先显示"正在读取"
      await primeHwlog(true);                // 只有用户点这里才强制重拉
      rerender();
    });
    f.appendChild(b);
    return f;
  }

  const cohortName = segments[1] ? safeDecode(segments[1]) : '';
  const assignmentId = segments[2] || '';
  const c = cohortName ? findCohort(cohortName) : null;

  // 🔴 导入页必须在「班级不存在」判定**之前**：
  //    从零开始时（库里还没有这个班）正是最需要导入的时候，
  //    先判 !c 会直接把入口堵死，变成"想建班得先进班"的死循环。
  if (assignmentId === IMPORT_SEG) {
    // 班级列表可能还没拉到（直接从书签进这个地址），顺手拉一次
    if (!S.cohorts.length) {
      loadCohorts(true).then(() => rerender()).catch(() => {});
    }
    return renderImport({
      cohorts: S.cohorts,
      rerender,
      reload: (force) => loadCohorts(force),
      defaultCohort: cohortName,
    });
  }

  // 连续缺交统计：'#/hwlog/~streak'（跨班，不挂在某个班下面）
  if (cohortName === STREAK_SEG) return renderStreak();
  // 不在统计页就把全量缓存丢掉，下次进来重新拉（录入改了标记也不会看到旧数据）
  S.streakMarks = null;

  if (!cohortName) return renderOverview();
  if (!c) {
    f.appendChild(pageHead('找不到这个班', cohortName));
    f.appendChild(notice('班级不存在，可能已被删除或改名。', 'bad'));
    return f;
  }

  if (!assignmentId) return renderCohort(c);

  const a = c.assignments.find((x) => x.id === assignmentId);
  if (!a) {
    f.appendChild(pageHead('找不到这次作业', c.name));
    f.appendChild(notice('这次作业不在当前班级里 —— 可能是链接过期或它已被删除。', 'bad'));
    return f;
  }

  // 录入页需要先把这个批次的标记读出来
  if (S.marksFor !== a.id) {
    S.marksFor = a.id;
    S.marks = new Map();
    f.appendChild(pageHead(a.title, c.name));
    f.appendChild(el('p', 'page-sub', '正在读取记录…'));
    loadMarks(a.id).then((m) => {
      S.marks = m;
      rerender();
    }).catch((e) => { S.error = e.message; rerender(); });
    return f;
  }

  return renderEntry(c, a);
}

/** 重新渲染当前路由（由 shell.js 注入，避免循环依赖） */
let rerender = () => {};
export function bindRerender(fn) { rerender = fn; }

/**
 * 预热数据。返回 true 表示「状态变了，调用方应该重绘一次」。
 *
 * 🔴 `primed` 是必须的：如果只靠「S.cohorts 为空就再拉一次」来判断，
 *    一旦拉取失败（令牌失效 / 表不存在 / 断网），就会变成
 *        失败 → 返回 true → shell 重绘 → 又调 primeHwlog → 又失败 …
 *    的**无限重试循环**，一秒钟能打十几个请求。
 *    （实测：假令牌下刷出 11 条 401。）
 *    所以：每个会话只自动拉一次；失败后要**用户点「重试」**才再来。
 */
let primed = false;

export async function primeHwlog(force = false) {
  if (!isSignedIn()) { primed = false; return false; }   // 退出登录后允许下次重新拉
  if (primed && !force) return false;
  primed = true;

  S.loading = true;
  S.error = '';
  try {
    await loadCohorts(true);
  } catch (e) {
    S.error = e.message;
    S.cohorts = [];
    S.marksFor = '';
  }
  S.loading = false;
  return true;
}
