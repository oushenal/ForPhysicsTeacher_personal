/* 临时验证：用真实 xlsx 跑解析器（跑完就删）
   —— 断言数字必须和已知的「2班 45 人 × 11 次、6班 49 人 × 7 次、216 条异常」对上 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
import { readFileSync } from 'node:fs';
import { analyzeRows, guessCohortName } from '../apps/hwlog/xlsx-parse.js';

const require = createRequire(import.meta.url);
const XLSX = require(join(ROOT, 'assets/vendor/xlsx.full.min.js'));

const FILE = join(ROOT, 'backup/作业登记系统/数据/作业登记总表.xlsx');

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}  →  ${JSON.stringify(got)}${ok ? '' : `（期望 ${JSON.stringify(want)}）`}`);
};

/* ---------- 1. 读真实文件（没有就只跑合成用例） ---------- */
const hasReal = existsSync(FILE);
const wb = hasReal ? XLSX.read(readFileSync(FILE), { type: 'buffer' }) : { SheetNames: [] };
if (!hasReal) console.log('（没找到 backup 里的真实 xlsx，只跑合成用例）');
console.log('工作表:', wb.SheetNames.join(' / '));

const results = {};
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
  const r = analyzeRows(rows, { cohortName: guessCohortName(name) });
  results[name] = r;
  if (!r.ok) {
    // 「使用说明」这类不是数据表，解析不出来是**正确**的
    console.log(`⏭  ${name} 跳过：${r.error}`);
    continue;
  }
  console.log(`\n[${name}] 猜到的班级=${r.cohortName}  表头在第 ${r.headerRow} 行`);
  console.log(`  学生 ${r.stats.students} · 作业 ${r.stats.jobs} · 异常 ${r.stats.abnormal} · 空格 ${r.stats.blanks}`);
  console.log(`  作业列: ${r.jobs.map((j) => j.title).join(' | ')}`);
  if (r.warnings.length) console.log('  提示:', r.warnings.join(' / '));
}

/* ---------- 2. 断言（与之前从 xlsx 生成的导入 SQL 一致） ---------- */
console.log('\n=== 断言 ===');
const two = results['2班'];
const six = results['6班'];
if (!hasReal) console.log('（跳过真实数据断言）');

if (hasReal) {
eq('2班学生数', two?.stats.students, 45);
eq('2班作业数', two?.stats.jobs, 11);
eq('6班学生数', six?.stats.students, 49);
eq('6班作业数', six?.stats.jobs, 7);
eq('两班学生合计', two?.stats.students + six?.stats.students, 94);
eq('两班批次合计', two?.stats.jobs + six?.stats.jobs, 18);
eq('两班异常合计', two?.stats.abnormal + six?.stats.abnormal, 216);

/* 标记类型分布：○206 / 假8 / 补2 */
const dist = {};
for (const r of [two, six]) {
  for (const s of r.students) for (const m of Object.values(s.marks)) dist[m] = (dist[m] || 0) + 1;
}
eq('○未交', dist.missing, 206);
eq('假请假', dist.leave, 8);
eq('补补交', dist.redo, 2);

/* 第一条学生样例：学号 41401 应叫「曾立文」 */
eq('2班首名学生学号', two?.students[0].no, '41401');
}
console.log('   首名学生:', JSON.stringify(two?.students[0]));
console.log('   有异常的学生样例:', JSON.stringify(two?.students.find((s) => Object.keys(s.marks).length)?.marks));

/* ---------- 3. 合成用例：边界情况 ---------- */
console.log('\n=== 合成用例 ===');
const synth = analyzeRows([
  ['某某班作业登记表', '', '', '', '', '', ''],
  ['学号', '姓名', '9月17日 作业', '中秋卷', '合计', '按时交', '备注'],
  ['41401', '甲', '√', '○', 1, 0, ''],
  ['41402', '乙', '补', '假', 2, 0, ''],
  ['41403', '丙', '', '√', 1, 1, '空格按√'],
  ['合计', '3 人', 2, 1, '', '', ''],
  ['41499', '不该出现', '○', '○', '', '', ''],
], { cohortName: '2班' });
eq('跳过标题行后找到表头', synth.headerRow, 2);
eq('统计列被排除', synth.jobs.map((j) => j.title), ['9月17日 作业', '中秋卷']);
eq('合计行之后不再读', synth.stats.students, 3);
eq('空格计入 blank', synth.stats.blanks, 1);
eq('异常条数', synth.stats.abnormal, 3);
eq('甲的标记', synth.students[0].marks, { '中秋卷': 'missing' });
eq('乙的标记', synth.students[1].marks, { '9月17日 作业': 'redo', '中秋卷': 'leave' });

/* 缺学号/重名/未知值 */
const weird = analyzeRows([
  ['学号', '姓名', '作业A', '作业A'],
  ['41401', '甲', '√', '○'],
  ['', '乙', '√', '√'],
  ['41401', '甲重复', '○', '√'],
], {});
eq('同名列加后缀', weird.jobs.map((j) => j.title), ['作业A', '作业A (2)']);
eq('缺学号的被跳过', weird.stats.students, 1);
console.log('   提示:', weird.warnings.join(' / '));

/* 完全认不出 */
eq('空表报错', analyzeRows([[]]).ok, false);
eq('没有学号列报错', analyzeRows([['a', 'b'], ['1', '2']]).ok, false);

console.log(`\n合计 ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
