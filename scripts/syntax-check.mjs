/* 语法检查（比 node --check 可靠）
   node scripts/syntax-check.mjs

   🔴 为什么不用 `node --check`：
      它对**含 import/export 的 ESM 文件**会漏掉「重复声明」这类错误，
      退出码仍然是 0（实测）。本项目全部是 ESM，等于没用。
      （2026-10-20 踩过：renderStreak 里 const copyLines 声明两次，
        --check 说"语法 OK"，浏览器直接 SyntaxError、整页白。）

   这里改成真正 import 一遍：语法错误在**解析阶段**就会抛，
   而 window/document 未定义的 ReferenceError 发生在执行阶段，
   可以安全忽略 —— 我们只关心 SyntaxError。
   ============================================================ */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠️ 不要包含 scripts/ —— 那些测试脚本有自己的 process.exit()，
//    被 import 进来会把本检查提前终止
const DIRS = ['assets', 'apps'];
const SKIP = [/vendor\//, /node_modules/];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.some((re) => p.replace(/\\/g, '/').match(re))) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => {
  try { return walk(join(ROOT, d)); } catch { return []; }
});

let bad = 0;
for (const f of files) {
  // 真正 import 一遍（语法错在解析阶段就抛，早于执行）
  try {
    await import(pathToFileURL(f).href);
  } catch (e) {
    if (e instanceof SyntaxError) {
      bad += 1;
      console.log(`❌ ${relative(ROOT, f)}`);
      console.log(`   ${e.message}`);
    }
    // 其它错误：window / document 未定义等 —— 本脚本跑在 Node 里，正常现象
  }
}

console.log(`\n检查 ${files.length} 个文件，语法错误 ${bad} 个`);
process.exit(bad ? 1 : 0);
