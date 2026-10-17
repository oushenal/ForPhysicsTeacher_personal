/* ============================================================
   physics · 内建模块的标题/描述覆盖
   ------------------------------------------------------------
   内建 5 个模块（物理演示/作业发布/作业登记/成绩归档/杂项）
   定义在 shell.js 的 MODULES 里。用户想在首页改它们的**标题和描述**
   —— 但内建模块的 id/路径/跳转不该动（否则导航、路由全乱）。

   所以这里只允许覆盖 name / desc 两个文案字段，存在 localStorage。
   换设备或清浏览器缓存会还原 —— 这是「本地偏好」而不是「云端数据」，
   和主题/色相是同一类东西。

   覆盖优先级：override.name ?? 模块默认 name。
   ============================================================ */

const OVERRIDE_KEY = 'physics.module-overrides.v1';

function read() {
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}'); }
  catch { return {}; }
}

function write(map) {
  try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map)); }
  catch { /* 隐私模式 */ }
}

/** 取某模块的覆盖（无覆盖返回 {}） */
export function getOverride(id) {
  return read()[id] || {};
}

/** 应用覆盖：返回一个「原模块 + 覆盖后的 name/desc」的浅拷贝 */
export function applyOverride(mod) {
  const o = read()[mod.id];
  if (!o) return mod;
  return { ...mod, name: o.name ?? mod.name, desc: o.desc ?? mod.desc };
}

/** 保存覆盖（name/desc 传 null 表示不覆盖、清空） */
export function setOverride(id, { name, desc }) {
  const map = read();
  const cur = map[id] || {};
  const next = {};
  if (name != null) next.name = String(name).trim();
  if (desc != null) next.desc = String(desc).trim();
  // 都清空就删掉这条覆盖，回到默认文案
  const merged = { ...cur, ...next };
  if (merged.name && merged.desc) map[id] = merged;
  else if (merged.name) map[id] = { name: merged.name };
  else if (merged.desc) map[id] = { desc: merged.desc };
  else delete map[id];
  write(map);
}

/** 清掉某模块的覆盖，恢复默认文案 */
export function clearOverride(id) {
  const map = read();
  delete map[id];
  write(map);
}

export function clearAllOverrides() {
  write({});
}
