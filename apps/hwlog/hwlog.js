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
import { el, safeDecode } from '../../assets/dom.js?v=28';
import { isSignedIn, currentEmail, signOut, sb } from '../../assets/supabase.js?v=28';
import { renderAuthCard } from '../../assets/authcard.js?v=28';

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

  return f;
}

/* ------------------------------------------------------------
   某个班的批次列表
   ------------------------------------------------------------ */
function assignmentRow(c, a) {
  const row = el('div', 'linkrow');

  const link = el('a', 'linkrow-a');
  link.href = `#/hwlog/${encodeURIComponent(c.name)}/${a.id}`;
  link.appendChild(el('span', 'link-name', a.title));
  link.appendChild(el('span', 'link-desc', fmtDate(a.assign_date) || ''));
  link.appendChild(el('span', 'link-url', ''));
  link.appendChild(el('span', 'link-go', '→'));
  row.appendChild(link);

  row.appendChild(twoStepDelete(() => removeAssignment(c, a)));
  return row;
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
  const f = document.createDocumentFragment();
  f.appendChild(pageHead(c.name, `${c.students.length} 人 · ${c.assignments.length} 次作业`));

  const bar = el('div', 'toolbar');
  const back = el('a', 'btn', '← 班级');
  back.href = '#/hwlog';
  bar.appendChild(back);

  const add = button('＋ 新建一次作业', 'btn-primary');
  add.addEventListener('click', () => createAssignment(c, add));
  bar.appendChild(add);

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
  for (const a of [...c.assignments].reverse()) list.appendChild(assignmentRow(c, a));
  f.appendChild(list);

  const tip = el('p', 'howto-detail',
    '「导出表格」把整个班导出成 CSV：行是学生、列是每次作业，末尾带按时交/补交/未交/请假/合计统计列'
    + '—— 和你原来那份「作业登记总表.xlsx」结构一致，直接用 Excel 或 WPS 打开即可。');
  f.appendChild(tip);

  return f;
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

  if (S.error) f.appendChild(notice(S.error, 'bad'));

  const stat = el('div', 'status');
  f.appendChild(stat);

  const roster = el('div', 'roster');
  f.appendChild(roster);

  const hint = el('p', 'howto-detail',
    '点一下学生切换标记：√ 按时交 → ○ 未交 → 补 补交 → 假 请假。改动会自动保存。');
  f.appendChild(hint);

  const saveMsg = el('p', 'savemsg');
  f.appendChild(saveMsg);

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
