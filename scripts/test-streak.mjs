/* 连续缺交统计的断言（改 streak.js 必须跑）
   node scripts/test-streak.mjs */
import { computeStreaks, streakJobsText } from '../apps/hwlog/streak.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}  →  ${JSON.stringify(got)}${ok ? '' : `（期望 ${JSON.stringify(want)}）`}`);
};

/* 5 次作业，sort 1..5（旧→新） */
const A = [1, 2, 3, 4, 5].map((n) => ({ id: 'a' + n, title: `${n}月作业`, assign_date: null, sort: n }));

const st = (no, name) => ({ id: 's' + no, student_no: String(no), name, sort: 0 });

/** marks: { 学号: [第1次, 第2次, ...] } —— 值是 mark 或 undefined(=√) */
function build(spec) {
  const m = new Map();
  for (const [no, list] of Object.entries(spec)) {
    list.forEach((mk, i) => {
      if (!mk) return;                       // 没有行 = √
      const aid = A[i]?.id;
      if (!aid) return;
      if (!m.has(aid)) m.set(aid, new Map());
      m.get(aid).set('s' + no, mk);
    });
  }
  return m;
}

const students = [st(41401, '甲'), st(41402, '乙'), st(41403, '丙'), st(41404, '丁'), st(41405, '戊'), st(41406, '己')];

const marks = build({
  // 甲：最近 3 次都缺 → 3
  41401: [null, null, 'missing', 'missing', 'missing'],
  // 乙：只最近 1 次缺 → 1，不列出
  41402: [null, null, null, null, 'missing'],
  // 丙：最近 2 次缺，再往前是「补交」→ 2（补交打断）
  41403: [null, 'missing', 'redo', 'missing', 'missing'],
  // 丁：最近 2 次缺，再往前是「请假」→ 2（请假打断）
  41404: ['missing', 'missing', 'leave', 'missing', 'missing'],
  // 戊：最近一次交了 → 0
  41405: ['missing', 'missing', 'missing', 'missing', null],
  // 己：全缺 → 5
  41406: ['missing', 'missing', 'missing', 'missing', 'missing'],
});

const r = computeStreaks(students, A, marks);
console.log('结果:', JSON.stringify(r.map((x) => `${x.student_no} ${x.streak}`)));

eq('结果人数', r.length, 4);
/* 己 5 次、甲 3 次、丙 2 次、丁 2 次 */

console.log('\n—— 逐条 ——');
const by = (no) => r.find((x) => x.student_no === String(no));
eq('己 连续 5 次', by(41406)?.streak, 5);
eq('甲 连续 3 次', by(41401)?.streak, 3);
eq('丙 连续 2 次（补交打断）', by(41403)?.streak, 2);
eq('丁 连续 2 次（请假打断）', by(41404)?.streak, 2);
eq('乙 只缺 1 次 → 不列出', !!by(41402), false);
eq('戊 最近交了 → 不列出', !!by(41405), false);

eq('丙的作业是最近两次', by(41403)?.jobs.map((j) => j.title), ['5月作业', '4月作业']);
eq('己的作业 5 次', by(41406)?.jobs.length, 5);

console.log('\n—— 排序与边界 ——');
eq('总人数（4 人）', r.length, 4);
eq('排序', r.map((x) => x.student_no), ['41406', '41401', '41403', '41404']);

eq('空作业表', computeStreaks(students, [], marks), []);
eq('空学生表', computeStreaks([], A, marks), []);
eq('只有 1 次作业', computeStreaks(
  [{ ...students[0] }],
  [{ id: 'a5', title: '唯一一次', sort: 5 }],
  build({ 41401: [null, null, null, null, 'missing'] }),
), []);
eq('marks 为 null 不崩', computeStreaks(students.slice(0, 1), A, null), []);

/* 阈值可调 */
eq('min=1 时乙也列出', computeStreaks(students, A, marks, 1).some((x) => x.student_no === '41402'), true);

console.log('\n—— 文案 ——');
eq('jobs 文案', streakJobsText([{ title: 'A' }, { title: 'B' }, { title: 'C' }]), 'A、B、C');
eq('截断文案', streakJobsText([{ title: 'A' }, { title: 'B' }, { title: 'C' }], 2), 'A、B 等 3 次');

console.log(`\n合计 ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
