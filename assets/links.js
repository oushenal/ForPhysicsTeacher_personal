/* ============================================================
   physics · 自定义板块（首页「＋ 添加板块」）
   ------------------------------------------------------------
   数据在 Supabase 的 custom_links 表（第 6 段 SQL 建的）。

   🔴 边界：这里只能加**站外跳转**型板块 —— 一个名字 + 一个网址。
      站内应用（物理演示 / 作业登记 / 成绩归档）是代码写出来的，
      不可能点一下「添加」就长出来。那五个内建模块永远在 shell.js 的 MODULES 里。

   自定义板块只出现在「首页卡片」和「更多页清单」，
   **不占手机底栏**（底栏只放内建模块，否则迟早挤爆）。
   ============================================================ */
import { isSignedIn, sb } from './supabase.js?v=38';

let cache = [];
let loaded = false;
let lastError = '';

export function customLinks() { return cache; }
export function linksError() { return lastError; }

/**
 * 取回板块列表。返回 true 表示「状态变了，调用方应该重绘一次」。
 * 没登录时直接清空 —— 首页对未登录访客只显示内建模块。
 */
export async function loadLinks(force = false) {
  if (!isSignedIn()) {
    cache = []; loaded = false; lastError = '';
    return false;
  }
  if (loaded && !force) return false;
  try {
    const rows = await sb.select(
      'custom_links',
      // ⚠️ 说明列是 `note` 不是 `desc` —— desc 是 SQL 保留字，表里建不出来。
      'select=id,title,url,note,sort,created_at&order=sort.asc,created_at.asc',
    );
    cache = (rows || []).filter((r) => r && r.url);
    lastError = '';
  } catch (e) {
    cache = [];
    lastError = e.message;
  }
  loaded = true;
  return true;
}

/** 清空本地缓存（换账号 / 退出登录时用） */
export function resetLinks() { cache = []; loaded = false; lastError = ''; }

/**
 * 补全并校验网址。
 * 老师手输的时候一般只会敲 `oushenal.github.io/BusList/`，
 * 不补 https:// 就成了相对路径，点开变成 404。
 */
export function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    return p.toString();
  } catch {
    return null;
  }
}

export async function addLink({ title, url, note = '' }) {
  const t = String(title || '').trim();
  const u = normalizeUrl(url);
  if (!t) throw new Error('板块名不能空着');
  if (!u) throw new Error('网址填得不对，要像 https://example.com 这样');

  const sort = cache.reduce((m, r) => Math.max(m, r.sort ?? 0), 0) + 1;
  await sb.insert('custom_links', { title: t, url: u, note: String(note || '').trim(), sort });
  await loadLinks(true);
}

export async function removeLink(id) {
  await sb.del('custom_links', `id=eq.${encodeURIComponent(id)}`);
  await loadLinks(true);
}

export async function renameLink(id, title, note) {
  const patch = {};
  if (title != null) patch.title = String(title).trim();
  if (note != null) patch.note = String(note).trim();
  await sb.update('custom_links', `id=eq.${encodeURIComponent(id)}`, patch);
  await loadLinks(true);
}
