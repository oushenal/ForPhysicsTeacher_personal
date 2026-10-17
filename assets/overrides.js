/* ============================================================
   physics · 内建模块的标题/描述覆盖
   ------------------------------------------------------------
   内建 5 个模块（物理演示/作业发布/作业登记/成绩归档/杂项）
   定义在 shell.js 的 MODULES 里。用户想改它们的**标题和描述**
   —— 但 id/路径/跳转不该动（否则导航、路由全乱）。

   覆盖存在 Supabase 的 module_overrides 表（第 7 段 SQL），
   一个用户一行一个模块，**跨设备生效**。没登录时用默认文案。

   覆盖优先级：override.name ?? 模块默认 name。
   ============================================================ */
import { isSignedIn, sb } from './supabase.js?v=41';

let cache = new Map();          // module_id -> { name, note }
let loaded = false;

/** 取某模块的覆盖（无覆盖返回 undefined） */
export function getOverride(id) {
  return cache.get(id);
}

/** 应用覆盖：返回「原模块 + 覆盖后的 name/desc」的浅拷贝。
    缓存里叫 note（数据库列名，desc 是 SQL 保留字），出口处映射成 desc（卡片要的字段）。 */
export function applyOverride(mod) {
  const o = cache.get(mod.id);
  if (!o) return mod;
  return { ...mod, name: o.name ?? mod.name, desc: o.note ?? mod.desc };
}

/** 取回覆盖列表。返回 true 表示「状态变了，调用方应该重绘」。 */
export async function loadOverrides(force = false) {
  if (!isSignedIn()) {
    cache = new Map();
    loaded = false;
    return false;
  }
  if (loaded && !force) return false;
  try {
    const rows = await sb.select(
      'module_overrides',
      'select=module_id,name,note',
    );
    const m = new Map();
    for (const r of rows || []) {
      if (r && r.module_id) m.set(r.module_id, { name: r.name, note: r.note });
    }
    cache = m;
  } catch (e) {
    cache = new Map();   // 读不到就当没有覆盖，别让首页卡死
  }
  loaded = true;
  return true;
}

/** 清空缓存（换账号时用） */
export function resetOverrides() { cache = new Map(); loaded = false; }

/** 保存覆盖（name/desc 传 null 表示清除该字段） */
export async function saveOverride(id, { name, desc }) {
  const cur = cache.get(id) || {};
  const next = { name: name ?? cur.name ?? null, note: desc ?? cur.note ?? null };
  // 都空 → 删掉这条覆盖（回到默认文案）
  if (!next.name && !next.note) {
    await sb.del('module_overrides', `module_id=eq.${encodeURIComponent(id)}`);
    cache.delete(id);
    return;
  }
  await sb.upsert(
    'module_overrides',
    { module_id: id, name: next.name, note: next.note },
    'user_id,module_id',
  );
  cache.set(id, { name: next.name, note: next.note });
}

/** 清掉某模块覆盖，恢复默认 */
export async function clearOverride(id) {
  await sb.del('module_overrides', `module_id=eq.${encodeURIComponent(id)}`);
  cache.delete(id);
}
