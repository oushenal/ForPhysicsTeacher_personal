/* ============================================================
   physics · 作业登记 · 从 Excel 导入历史记录
   ------------------------------------------------------------
   用途：把旧表（行 = 学生，A 列学号、B 列姓名，后面每列一次作业）
        整个导进来，不用一条条补录。

   🔴 三条设计原则：
      1. **纯前端解析**（SheetJS 懒加载，在 assets/vendor/）——
         文件不上传到任何服务器，离线和没网也能用。
      2. **导入前必须让你看清会发生什么**：新增几个学生、几次作业、
         哪几次作业已存在会被**覆盖**。
      3. **可重复执行**（幂等）：学生按学号、作业按标题匹配；
         标记是「先 upsert 再删多余」，所以同一份文件重导结果一样。

   解析逻辑在 ./xlsx-parse.js（纯计算，有 Node 断言脚本）。
   ============================================================ */
import { el } from '../../assets/dom.js?v=34';
import { sb } from '../../assets/supabase.js?v=34';
import { analyzeRows, guessCohortName } from './xlsx-parse.js?v=34';

/** 路由片段：'#/hwlog/<班名>/~import' */
export const IMPORT_SEG = '~import';

const ST = {
  stage: 'pick',        // pick | review | done
  fileName: '',
  sheets: [],           // [{ name, result, cohortName, include }]
  error: '',
  running: false,
  done: null,
};

let rerender = () => {};

/* ------------------------------------------------------------
   SheetJS 懒加载（880KB，不放在 index.html 里拖慢所有页面）
   ------------------------------------------------------------ */
let xlsxPromise = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // src 相对**页面**（index.html 所在目录），不是相对这个模块
    s.src = './assets/vendor/xlsx.full.min.js?v=34';
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('xlsx 已加载但没挂上 window.XLSX')));
    s.onerror = () => reject(new Error('解析库加载失败 —— assets/vendor/xlsx.full.min.js 在吗？'));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

/* ------------------------------------------------------------
   小件（本文件自用，注意别和 CSS 里的类名对不上）
   ------------------------------------------------------------ */
function button(text, cls) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.textContent = text;
  return b;
}

function notice(text, kind) {
  const n = el('div', 'notice');
  if (kind) n.dataset.kind = kind;
  n.appendChild(el('span', 'mk', kind === 'bad' ? '○' : '●'));
  n.appendChild(el('span', 'notice-txt', text));
  return n;
}

/** 一行「标签 + 值」，review 卡片里用 */
function fact(label, value, tone) {
  const row = el('div', 'ifact');
  row.appendChild(el('span', 'ifact-l', label));
  const v = el('span', 'ifact-v', String(value));
  if (tone) v.dataset.tone = tone;
  row.appendChild(v);
  return row;
}

/* ------------------------------------------------------------
   ① 选文件
   ------------------------------------------------------------ */
function pickPanel() {
  const box = el('div');

  const zone = el('div', 'dropzone');
  zone.appendChild(el('span', 'dropzone-mk', '⇩'));
  zone.appendChild(el('p', 'dropzone-t', '把 .xlsx / .xls / .csv 拖到这里'));
  zone.appendChild(el('p', 'dropzone-d', '或者点一下选文件。一个文件里有多个工作表（2班、6班）也行，会分别识别。'));

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.hidden = true;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) handleFile(f);
  });

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.dataset.over = '1'; });
  zone.addEventListener('dragleave', () => { zone.dataset.over = ''; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.dataset.over = '';
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  box.appendChild(zone);
  box.appendChild(input);

  const tip = el('div', 'howto');
  tip.innerHTML =
    `<p><b>表长什么样才认得出来</b>：前 15 行里要有一行同时写着「学号」和「姓名」，
       那一行下面每一行是一个学生，后面每一列是一次作业，格子写
       <code>√</code> <code>○</code> <code>补</code> <code>假</code>。</p>
     <p>「合计 / 按时交 / 补交 / 未交 / 请假 / 备注」这类列会自动跳过。
        空格子按<b>按时交</b>处理（会在下一页提示有几个）。</p>
     <p>文件只在你自己的浏览器里解析，<b>不会上传到任何服务器</b>。</p>`;
  box.appendChild(tip);
  return box;
}

async function handleFile(file) {
  ST.error = '';
  ST.fileName = file.name;
  ST.sheets = [];

  try {
    const XLSX = await loadXlsx();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const fallback = guessCohortName(file.name) || ST.defaultCohort || '';
    ST.sheets = (wb.SheetNames || []).map((name) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1, raw: false, defval: '',
      });
      // 班级名优先级：工作表名里的「N班」> 文件名里的「N班」> 从哪个班点进来的默认值
      const guessed = guessCohortName(name) || fallback || '';
      const result = analyzeRows(rows, { cohortName: guessed });
      return { name, result, cohortName: guessed, include: result.ok };
    });

    ST.stage = 'review';
  } catch (e) {
    ST.error = '读这个文件失败：' + e.message;
    ST.stage = 'pick';
  }
  rerender();
}

/* ------------------------------------------------------------
   ② 预览：每张表会发生什么
   ------------------------------------------------------------ */
function compare(sheet, cohorts) {
  const c = cohorts.find((x) => x.name === sheet.cohortName.trim());
  if (!c) {
    return { isNewCohort: true, newStudents: sheet.result.stats.students, existing: 0, missing: 0, newJobs: sheet.result.jobs.length, dupJobs: 0, renamed: 0 };
  }
  const haveNos = new Set((c.students || []).map((s) => s.student_no));
  const tableNos = new Set(sheet.result.students.map((s) => s.no));
  const jobTitles = new Set((c.assignments || []).map((a) => a.title));

  const renamed = sheet.result.students.filter((s) => {
    const old = (c.students || []).find((x) => x.student_no === s.no);
    return old && old.name !== s.name;
  }).length;

  return {
    isNewCohort: false,
    newStudents: [...tableNos].filter((n) => !haveNos.has(n)).length,
    existing: [...tableNos].filter((n) => haveNos.has(n)).length,
    missing: [...haveNos].filter((n) => !tableNos.has(n)).length,
    newJobs: sheet.result.jobs.filter((j) => !jobTitles.has(j.title)).length,
    dupJobs: sheet.result.jobs.filter((j) => jobTitles.has(j.title)).length,
    renamed,
  };
}

function sheetCard(sheet, cohorts) {
  const card = el('div', 'sheetcard');
  const r = sheet.result;

  /* 标题行：工作表名 + 是否导入 */
  const head = el('div', 'sheetcard-head');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'rowcheck';
  cb.checked = sheet.include && r.ok;
  cb.disabled = !r.ok;
  cb.addEventListener('change', () => { sheet.include = cb.checked; rerender(); });
  head.appendChild(cb);
  head.appendChild(el('span', 'sheetcard-name', `工作表「${sheet.name}」`));
  if (!r.ok) head.appendChild(el('span', 'sheetcard-tag', '不是数据表'));
  card.appendChild(head);

  if (!r.ok) {
    card.appendChild(el('p', 'sheetcard-err', r.error));
    return card;
  }

  /* 班级名 */
  const row = el('div', 'iform');
  row.appendChild(el('span', 'field-label', '导入到'));
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'input';
  inp.value = sheet.cohortName;
  inp.placeholder = '例如 2班';
  inp.setAttribute('list', 'cohort-names');
  inp.addEventListener('input', () => { sheet.cohortName = inp.value; rerender(); });
  row.appendChild(inp);
  card.appendChild(row);

  /* 数字 */
  const cmp = compare(sheet, cohorts);
  const grid = el('div', 'ifactgrid');
  grid.appendChild(fact('学生', r.stats.students));
  grid.appendChild(fact('作业列', r.stats.jobs));
  grid.appendChild(fact('异常记录', r.stats.abnormal));
  grid.appendChild(fact('表头在第', `${r.headerRow} 行`));
  card.appendChild(grid);

  /* 会发生什么 */
  const eff = el('div', 'sheetcard-eff');
  if (cmp.isNewCohort) {
    eff.appendChild(el('p', 'eff-line', `会新建班级「${sheet.cohortName || '（未填）'}」，${r.stats.students} 名学生、${r.stats.jobs} 次作业全部新增。`));
  } else {
    eff.appendChild(el('p', 'eff-line',
      `学生：新增 ${cmp.newStudents} 人，已有 ${cmp.existing} 人`
      + (cmp.missing ? `，库里还有 ${cmp.missing} 人不在表中（不会动）` : '')));
    eff.appendChild(el('p', 'eff-line',
      `作业：新增 ${cmp.newJobs} 次`
      + (cmp.dupJobs ? `，已有 ${cmp.dupJobs} 次 —— 这几次的标记会被**覆盖**` : '')));
    if (cmp.renamed) {
      eff.appendChild(el('p', 'eff-line', `有 ${cmp.renamed} 个学号对应的姓名和库里不一样，姓名不会改。`));
    }
  }
  card.appendChild(eff);

  /* 警告 */
  if (r.warnings.length) {
    const w = el('ul', 'sheetcard-warn');
    for (const t of r.warnings) w.appendChild(el('li', null, t));
    card.appendChild(w);
  }
  return card;
}

function reviewPanel() {
  const box = el('div');

  const back = button('← 换一个文件');
  back.addEventListener('click', () => { ST.stage = 'pick'; ST.sheets = []; rerender(); });
  const bar = el('div', 'toolbar');
  bar.appendChild(back);
  bar.appendChild(el('span', 'spacer'));
  bar.appendChild(el('span', 'page-sub', ST.fileName));
  box.appendChild(bar);

  /* datalist：已存在的班级名，能选也能自己打 */
  const dl = document.createElement('datalist');
  dl.id = 'cohort-names';
  box.appendChild(dl);
  // datalist 的选项要在输入框之前就位，但渲染顺序无关紧要，浏览器会按 id 找
  for (const c of (ST.cohortNames || [])) {
    const o = document.createElement('option');
    o.value = c;
    dl.appendChild(o);
  }

  const usable = ST.sheets.filter((s) => s.result.ok);
  if (!usable.length) {
    box.appendChild(notice('这个文件里没有能识别的数据表。检查一下是不是有「学号」「姓名」这两列。', 'bad'));
    return box;
  }

  const objs = ST.cohortObjects || [];
  for (const s of usable) box.appendChild(sheetCard(s, objs));

  /* 不认识的表单独提一句，别让人以为是漏了 */
  const bad = ST.sheets.filter((s) => !s.result.ok);
  if (bad.length) {
    const n = el('p', 'page-sub');
    n.textContent = `另外 ${bad.length} 个工作表（${bad.map((s) => s.name).join('、')}）不是数据表，已跳过。`;
    box.appendChild(n);
  }

  const foot = el('div', 'formbar');
  const go = button('开始导入', 'btn-primary');
  go.addEventListener('click', runImport);
  foot.appendChild(go);
  const cnt = el('span', 'savemsg');
  cnt.textContent = `已勾选 ${ST.sheets.filter((s) => s.include && s.result.ok).length} 张表`;
  foot.appendChild(cnt);
  box.appendChild(foot);

  if (ST.error) box.appendChild(notice(ST.error, 'bad'));
  return box;
}

/* ------------------------------------------------------------
   ③ 跑
   ------------------------------------------------------------ */
function setProgress(text) {
  const n = document.getElementById('import-progress');
  if (n) n.textContent = text;
}

function runningPanel() {
  const box = el('div', 'importrun');
  box.appendChild(el('p', 'importrun-t', '正在导入…'));
  const p = el('p', 'savemsg');
  p.id = 'import-progress';
  p.textContent = '准备中…';
  box.appendChild(p);
  return box;
}

async function runImport() {
  const chosen = ST.sheets.filter((s) => s.include && s.result.ok);
  if (!chosen.length) { ST.error = '一张表都没勾。'; rerender(); return; }
  if (chosen.some((s) => !s.cohortName.trim())) { ST.error = '有表没填班级名。'; rerender(); return; }

  ST.running = true;
  ST.error = '';
  rerender();

  const sum = { cohorts: 0, students: 0, newStudents: 0, jobs: 0, newJobs: 0, marks: 0 };
  try {
    for (const sh of chosen) {
      setProgress(`正在处理「${sh.name}」→ ${sh.cohortName}…`);
      await importSheet(sh, sum);
      sum.cohorts += 1;
    }
    ST.done = sum;
    ST.stage = 'done';
    await ST.reload?.(true);
  } catch (e) {
    ST.error = '导入中断：' + e.message + '。已经写进去的部分会保留；同一份文件重跑一遍结果一样（幂等）。';
  }
  ST.running = false;
  rerender();
}

async function importSheet(sh, sum) {
  const name = sh.cohortName.trim();

  /* 1) 班级 */
  let cohort = (ST.cohortObjects || []).find((c) => c.name === name);
  if (!cohort) {
    const rows = await sb.insert('cohorts', { name, sort: (ST.cohortObjects || []).length + 1 });
    cohort = rows?.[0];
    if (!cohort?.id) throw new Error(`创建班级「${name}」失败`);
    ST.cohortObjects = [...(ST.cohortObjects || []), cohort];
    ST.cohortNames = [...(ST.cohortNames || []), name];
  }

  /* 2) 学生：按学号匹配，只加不改名 */
  const dbStudents = await sb.select(
    'students', `select=id,student_no,name&cohort_id=eq.${cohort.id}`,
  );
  const byNo = new Map((dbStudents || []).map((s) => [s.student_no, s]));
  let baseSort = (dbStudents || []).reduce((m, s) => Math.max(m, s.sort || 0), 0);

  const toAdd = [];
  for (const s of sh.result.students) {
    if (!byNo.has(s.no)) {
      baseSort += 1;
      toAdd.push({ cohort_id: cohort.id, student_no: s.no, name: s.name, sort: baseSort });
    }
  }
  if (toAdd.length) {
    setProgress(`写入 ${toAdd.length} 名新学生…`);
    const added = await sb.insert('students', toAdd);
    for (const a of added || []) byNo.set(a.student_no, a);
    sum.newStudents += toAdd.length;
  }
  sum.students += sh.result.students.length;

  /* 3) 作业：按标题匹配，sort 接在已有后面 */
  const dbJobs = await sb.select(
    'assignments', `select=id,title,sort&cohort_id=eq.${cohort.id}`,
  );
  const jobByTitle = new Map((dbJobs || []).map((a) => [a.title, a]));
  let jSort = (dbJobs || []).reduce((m, a) => Math.max(m, a.sort || 0), 0);

  const jobAdd = [];
  for (const j of sh.result.jobs) {
    if (!jobByTitle.has(j.title)) {
      jSort += 1;
      jobAdd.push({ cohort_id: cohort.id, title: j.title, kind: 'homework', sort: jSort });
    }
  }
  if (jobAdd.length) {
    setProgress(`写入 ${jobAdd.length} 次新作业…`);
    const added = await sb.insert('assignments', jobAdd);
    for (const a of added || []) jobByTitle.set(a.title, a);
    sum.newJobs += jobAdd.length;
  }
  sum.jobs += sh.result.jobs.length;

  /* 4) 标记：每个批次「先 upsert 再删多余」（顺序不能反，反了失败会丢数据） */
  for (let i = 0; i < sh.result.jobs.length; i++) {
    const j = sh.result.jobs[i];
    const aid = jobByTitle.get(j.title)?.id;
    if (!aid) continue;
    setProgress(`写入标记 ${i + 1}/${sh.result.jobs.length}：${j.title}`);

    const rows = [];
    for (const st of sh.result.students) {
      const m = st.marks[j.title];
      const sid = byNo.get(st.no)?.id;
      if (m && sid) rows.push({ assignment_id: aid, student_id: sid, mark: m });
    }
    if (rows.length) await sb.upsert('hw_marks', rows, 'assignment_id,student_id');
    sum.marks += rows.length;

    // 表里这列是 √ 的人 → 库里不该有行，多出来的全删掉
    const keep = rows.map((r) => r.student_id);
    const filter = keep.length
      ? `assignment_id=eq.${aid}&student_id=not.in.(${keep.map((k) => `"${k}"`).join(',')})`
      : `assignment_id=eq.${aid}`;
    await sb.del('hw_marks', filter);
  }
}

/* ------------------------------------------------------------
   ④ 完成
   ------------------------------------------------------------ */
function donePanel() {
  const d = ST.done;
  const box = el('div');
  box.appendChild(notice(`导入完成：${d.cohorts} 个班 · 学生 ${d.students} 人（新增 ${d.newStudents}）· `
    + `作业 ${d.jobs} 次（新增 ${d.newJobs}）· 异常记录 ${d.marks} 条`));

  const bar = el('div', 'toolbar');
  const back = el('a', 'btn btn-primary', '去看看班级');
  back.href = '#/hwlog';
  bar.appendChild(back);

  const again = button('再导一份');
  again.addEventListener('click', () => {
    ST.stage = 'pick'; ST.sheets = []; ST.done = null; ST.fileName = '';
    rerender();
  });
  bar.appendChild(again);
  box.appendChild(bar);

  const tip = el('div', 'howto');
  tip.innerHTML =
    `<p>「√ 按时交」<b>不写库</b> —— 数据库里只存异常（○ / 补 / 假），没有记录就是按时交。
        所以 ${d.jobs} 次作业最终只写了 ${d.marks} 条。</p>
     <p>导入是<b>幂等</b>的：同一份文件再导一次，结果和这次一样，不会翻倍。</p>`;
  box.appendChild(tip);
  return box;
}

/* ------------------------------------------------------------
   入口
   ------------------------------------------------------------ */
export function renderImport(ctx) {
  rerender = ctx.rerender || rerender;
  ST.cohortObjects = ctx.cohorts || [];
  ST.cohortNames = (ctx.cohorts || []).map((c) => c.name);
  ST.reload = ctx.reload;
  // 从哪个班点进来 / 书签里的班名，作为猜不到班级名时的兜底
  ST.defaultCohort = ctx.defaultCohort || '';

  const f = document.createDocumentFragment();
  const head = el('div', 'page-head');
  head.appendChild(el('h1', null, '导入 Excel'));
  head.appendChild(el('p', 'page-sub', '把旧表整个导进来，不用一条条补录。文件只在你的浏览器里解析。'));
  f.appendChild(head);

  if (ST.running) { f.appendChild(runningPanel()); return f; }
  if (ST.stage === 'pick') f.appendChild(pickPanel());
  else if (ST.stage === 'review') f.appendChild(reviewPanel());
  else f.appendChild(donePanel());

  return f;
}
