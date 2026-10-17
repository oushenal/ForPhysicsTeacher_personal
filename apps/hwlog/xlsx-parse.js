/* ============================================================
   physics · 作业登记 · xlsx 解析（纯计算）
   ------------------------------------------------------------
   输入：一个 sheet 的二维数组（第一层是行，第二层是单元格）
   输出：导入计划需要的结构（作业列、学生、每个学生的异常标记）

   🔴 这里**不碰 DOM、不碰网络、不 import 任何浏览器 API** ——
      因为要能在 Node 里用真实 xlsx 跑断言（scripts/test-xlsx-parse.mjs）。
      好坏一眼能测，比在浏览器里点靠谱。

   旧表结构（backup/作业登记系统/数据/作业登记总表.xlsx）：
     行 = 学生，A 列学号、B 列姓名，后面每列 = 一次作业，格子 = √ / ○ / 补 / 假
   ============================================================ */

/** 这些列不是作业：统计列、备注列 */
const NOT_A_JOB = /合计|总计|小计|按时交|准时交|补交|未交|请假|迟交|备注|序号|总数|统计/;
const IS_NO = /学号|考号|编号|学籍号/;
const IS_NAME = /姓名|名字|学生姓名/;

/** 单元格 → 标记。ok 表示「按时交」，不落库。 */
export function parseMark(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { mark: 'ok', blank: true };          // 空格按按时交，但要计数提示
  if (/^[√✓✔]$/.test(s)) return { mark: 'ok' };
  if (/^[○〇Oo0]$/.test(s)) return { mark: 'missing' }; // ○ 未交（全角半角都认）
  if (/^[×✗xX]$/.test(s)) return { mark: 'missing' };
  if (/补/.test(s)) return { mark: 'redo' };
  if (/假/.test(s)) return { mark: 'leave' };
  return { mark: 'ok', unknown: s };                    // 认不出的值：按按时交，但记下来
}

/**
 * 解析一个 sheet。
 * @param {any[][]} rows  二维数组
 * @param {{cohortName?:string}} opts
 */
export function analyzeRows(rows, opts = {}) {
  const warnings = [];
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: '这个工作表是空的' };
  }

  /* ---------- 1. 找表头行 ---------- */
  let headerIdx = -1;
  let noCol = -1;
  let nameCol = -1;
  const scan = Math.min(rows.length, 15);
  for (let i = 0; i < scan; i++) {
    const r = (rows[i] || []).map((c) => String(c ?? '').trim());
    const ni = r.findIndex((c) => IS_NO.test(c));
    const mi = r.findIndex((c) => IS_NAME.test(c));
    if (ni >= 0 && mi >= 0) { headerIdx = i; noCol = ni; nameCol = mi; break; }
  }
  if (headerIdx < 0) {
    return { ok: false, error: '没找到表头：前 15 行里要有一行同时包含「学号」和「姓名」' };
  }

  const header = (rows[headerIdx] || []).map((c) => String(c ?? '').trim());

  /* ---------- 2. 认作业列 ---------- */
  const jobs = [];
  const seen = new Map();
  header.forEach((h, i) => {
    if (i === noCol || i === nameCol) return;
    if (!h) return;                       // 空列头 = 间隔列
    if (NOT_A_JOB.test(h)) return;        // 合计/统计列
    // 同名列 → 加后缀，否则 unique(cohort_id,title) 会撞
    const n = (seen.get(h) || 0) + 1;
    seen.set(h, n);
    jobs.push({ title: n === 1 ? h : `${h} (${n})`, col: i });
  });

  if (!jobs.length) {
    return { ok: false, error: '没认出作业列：学号、姓名之外的列都是空的，或者都被当成统计列跳过了' };
  }

  /* ---------- 3. 逐行读学生 ---------- */
  const students = [];
  let blanks = 0;
  const unknowns = [];
  let stopped = false;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const no = String(r[noCol] ?? '').trim();
    const name = String(r[nameCol] ?? '').trim();

    if (/^(合计|总计|小计)/.test(no) || /^(合计|总计|小计)/.test(name)) { stopped = true; break; }
    if (!no && !name) continue;                       // 空行
    if (!no || !name) {                               // 缺学号或姓名
      warnings.push(`第 ${i + 1} 行缺${!no ? '学号' : '姓名'}，已跳过（${name || no}）`);
      continue;
    }

    const marks = {};
    for (const j of jobs) {
      const m = parseMark(r[j.col]);
      if (m.blank) blanks += 1;
      if (m.unknown) unknowns.push(`${no} ${name} 的「${j.title}」：${m.unknown}`);
      if (m.mark !== 'ok') marks[j.title] = m.mark;   // 只留异常
    }
    students.push({ no, name, marks });
  }

  if (stopped) warnings.push('遇到「合计」行，后面的内容没有导入。');

  if (!students.length) {
    return { ok: false, error: '表头下面没有读到任何学生（学号和姓名都是空的？）' };
  }

  /* ---------- 4. 重复学号 ---------- */
  const dupNo = new Map();
  for (const s of students) dupNo.set(s.no, (dupNo.get(s.no) || 0) + 1);
  const dups = [...dupNo].filter(([, n]) => n > 1).map(([no]) => no);
  if (dups.length) warnings.push(`学号重复：${dups.join('、')} —— 只保留第一次出现的那个`);

  const uniq = [];
  const seenNo = new Set();
  for (const s of students) {
    if (seenNo.has(s.no)) continue;
    seenNo.add(s.no);
    uniq.push(s);
  }

  if (blanks) warnings.push(`有 ${blanks} 个空格子，按「按时交」处理（旧表里本该每格都有值）。`);
  if (unknowns.length) {
    const head = unknowns.slice(0, 5).join('；');
    warnings.push(`有 ${unknowns.length} 个格子认不出标记，按「按时交」处理：${head}${unknowns.length > 5 ? ' …' : ''}`);
  }

  const abnormal = uniq.reduce((n, s) => n + Object.keys(s.marks).length, 0);

  return {
    ok: true,
    cohortName: opts.cohortName || '',
    headerRow: headerIdx + 1,             // 1-based，给用户看的
    jobs,
    students: uniq,
    stats: { students: uniq.length, jobs: jobs.length, abnormal, blanks },
    warnings,
  };
}

/** 从工作表名猜班级：'2班' / '6班_作业' / '高二2班' 都能认出来 */
export function guessCohortName(sheetName) {
  const m = String(sheetName || '').match(/(\d+)\s*班/);
  return m ? `${m[1]}班` : '';
}
