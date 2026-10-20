/* ============================================================
   physics · 极简 DOM 工具（shell.js 和 apps/* 共用）
   ============================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

export function frag() {
  return document.createDocumentFragment();
}

/** 安全解码 URL 片段：坏编码不该让整页崩掉 */
export function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/* ------------------------------------------------------------
   全局提示条
   ------------------------------------------------------------
   页面底部那个 #toast 只有一份，谁来显示都调这个。
   ⚠️ 以前 shell.js 和 settings.js 各写了一份，hwlog.js 又漏了 ——
      结果改名保存后一调 toast 就 TypeError，把后面的重绘也带走了。
      三处共用这一份，别再抄。
   ------------------------------------------------------------ */
let toastTimer = null;
export function toast(msg) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.dataset.show = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.dataset.show = '0'; }, 3200);
}
