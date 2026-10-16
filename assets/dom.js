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
