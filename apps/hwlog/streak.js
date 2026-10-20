/* ============================================================
   physics · 作业登记 · 连续缺交统计（纯计算）
   ------------------------------------------------------------
   规则（按老师要求）：
     · 从**最近一次**作业往回数，连续「○ 未交」的次数
     · 一遇到不是 ○ 的就停 —— √ 交了、补 补交、假 请假都算「中断」
       （补交说明交了、请假不算缺交，两个都该打断连续）
     · 连续达到 2 次才列出；只缺 1 次的不显示
     · 显示连续次数，以及具体是哪几次

   🔴 这里不碰 DOM、不碰网络 —— 要能在 Node 里直接断言
      （scripts/test-streak.mjs）。
   ============================================================ */

/**
 * @param {Array} students   [{ id, student_no, name, sort }]
 * @param {Array} assignments [{ id, title, assign_date, sort }] **必须 sort 升序（旧→新）**
 * @param {Map}   marks      Map<assignmentId, Map<studentId, mark>>
 * @param {number} min       至少连续几次才算（默认 2）
 * @returns {Array} [{ ...student, streak, jobs:[{title, assign_date}…] }]
 *                  jobs[0] 是最近的那一次（因为从最新往回推）
 */
export function computeStreaks(students, assignments, marks, min = 2) {
  if (!students || !students.length || !assignments || !assignments.length) return [];

  const out = [];
  for (const st of students) {
    let streak = 0;
    const jobs = [];
    // 从最新（数组末尾）往回推
    for (let i = assignments.length - 1; i >= 0; i--) {
      const a = assignments[i];
      const m = marks?.get(a.id)?.get(st.id) || 'ok';
      if (m !== 'missing') break;          // √ / 补 / 假 都算中断
      streak += 1;
      jobs.push({ title: a.title, assign_date: a.assign_date || null });
    }
    if (streak >= min) out.push({ ...st, streak, jobs });
  }

  // 缺得多的排前面；同样多按学号
  return out.sort((x, y) => y.streak - x.streak
    || String(x.student_no).localeCompare(String(y.student_no)));
}

/** 「连续缺交」的作业标题拼成一行（最新在前，中间用顿号） */
export function streakJobsText(jobs, limit = 99) {
  const list = (jobs || []).slice(0, limit).map((j) => j.title);
  return list.join('、') + (jobs.length > limit ? ` 等 ${jobs.length} 次` : '');
}
