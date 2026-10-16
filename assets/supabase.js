/* ============================================================
   physics · Supabase 薄封装（不引 SDK）
   ------------------------------------------------------------
   只做我们要用的几件事，约 200 行，零依赖、零外部请求。
   为什么不用 supabase-js：
     · 完整包 ~100KB，而我们只用 5 个操作（otp / token / select / upsert / delete）
     · 更重要的：SDK 不管「Magic Link 回跳的 token 落在 hash 里」和本项目
       hash 路由的冲突，这一段反正要自己写（见 captureSessionFromUrl）
   ------------------------------------------------------------
   配置在 assets/config.js 的 supabase 段。
   ⚠️ url 只填到域名，不要带 /rest/v1/ 尾巴。
   ============================================================ */

const CFG = (window.PHYSICS_CONFIG || {}).supabase || {};
const BASE = String(CFG.url || '').replace(/\/+$/, '');
const KEY = String(CFG.key || '');

const AUTH_KEY = 'physics.auth.v1';

export function isConfigured() {
  return !!(BASE && KEY);
}

/* ------------------------------------------------------------
   会话存取
   ------------------------------------------------------------ */
let session = readSession();

function readSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}
function writeSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
    else localStorage.removeItem(AUTH_KEY);
  } catch { /* 隐私模式 */ }
}

export function currentUser() { return session?.user || null; }
export function currentEmail() { return session?.user?.email || ''; }
export function isSignedIn() { return !!session?.access_token; }

export function signOut() { writeSession(null); }

/** base64url → JSON（JWT payload） */
function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

/* ------------------------------------------------------------
   🔴 关键：把 Magic Link 回跳带的 token 从 URL 里收走
   ------------------------------------------------------------
   Supabase 回跳形如：
     http://127.0.0.1:8412/#access_token=eyJ...&refresh_token=...&type=magiclink
   我们的 hash 路由会把 '#access_token=...' 当成一个路由 → 渲染"页面不存在"。
   所以必须在路由之前调用本函数：解析 → 落盘 → **把 token 从地址栏抹掉**
   （不抹掉的话 token 会留在浏览器历史里，是个安全隐患）。
   ------------------------------------------------------------ */
export function captureSessionFromUrl() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw || raw.startsWith('/')) return { ok: false };

  const p = new URLSearchParams(raw);

  const errDesc = p.get('error_description') || p.get('error');
  if (errDesc) {
    history.replaceState(null, '', location.pathname + location.search);
    return { ok: false, error: errDesc.replace(/\+/g, ' ') };
  }

  const at = p.get('access_token');
  if (!at) return { ok: false };

  const claims = decodeJwt(at) || {};
  writeSession({
    access_token: at,
    refresh_token: p.get('refresh_token') || '',
    expires_at: Date.now() + Math.max(60, parseInt(p.get('expires_in') || '3600', 10) - 60) * 1000,
    user: { id: claims.sub || '', email: claims.email || '' },
  });

  history.replaceState(null, '', location.pathname + location.search);
  return { ok: true, email: claims.email || '' };
}

/* ------------------------------------------------------------
   发登录邮件（Magic Link）
   ------------------------------------------------------------ */
export async function sendMagicLink(email, redirectTo) {
  if (!isConfigured()) throw new Error('还没配置 Supabase 连接');
  const res = await fetch(`${BASE}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      create_user: true,
      gotrue_meta_security: {},
      options: redirectTo ? { email_redirect_to: redirectTo } : {},
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`发信失败（HTTP ${res.status}）${t ? ' — ' + t.slice(0, 160) : ''}`);
  }
  return true;
}

/* ------------------------------------------------------------
   确保 access_token 未过期（过期前 60 秒就刷新）
   ------------------------------------------------------------ */
async function ensureFresh() {
  if (!session?.access_token) return null;
  if (session.expires_at && Date.now() < session.expires_at) return session.access_token;
  if (!session.refresh_token) { writeSession(null); return null; }

  try {
    const res = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) throw new Error('refresh ' + res.status);
    const j = await res.json();
    const claims = decodeJwt(j.access_token) || session.user || {};
    writeSession({
      access_token: j.access_token,
      refresh_token: j.refresh_token || session.refresh_token,
      expires_at: Date.now() + Math.max(60, (j.expires_in || 3600) - 60) * 1000,
      user: { id: claims.sub || '', email: claims.email || '' },
    });
    return session.access_token;
  } catch {
    writeSession(null);           // 刷新失败 = 会话作废，请重新登录
    return null;
  }
}

/* ------------------------------------------------------------
   PostgREST 请求
   ------------------------------------------------------------ */
async function req(method, path, { body, headers = {}, prefer } = {}) {
  if (!isConfigured()) throw new Error('还没配置 Supabase 连接');
  const token = await ensureFresh();
  if (!token) throw new Error('NOT_SIGNED_IN');

  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    // 401 = 令牌不被接受（过期/被吊销/是假的）。**必须把会话清掉**，
    // 否则用户会卡在一个永远失败的重试按钮上 —— 权限不足要给出口。
    if (res.status === 401 || res.status === 403) {
      writeSession(null);
      throw new Error('登录已失效，请重新登录');
    }
    const t = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(t);
      msg = j.message || j.hint || msg;
      if (j.code === 'PGRST205' || /schema cache/i.test(msg)) {
        msg = '表不存在 —— docs/ 下的建表 SQL 还没执行？';
      }
    } catch { if (t) msg += ' — ' + t.slice(0, 160); }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

export const sb = {
  select: (table, query = 'select=*') => req('GET', `${table}?${query}`),

  /** 单行写入；自动补 user_id（RLS 要求 user_id = auth.uid()） */
  insert: (table, rows) => {
    const uid = currentUser()?.id;
    const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, user_id: uid }));
    return req('POST', table, { body: list, prefer: 'return=representation' });
  },

  /** 冲突时更新（幂等写入，重复跑不产生重复行） */
  upsert: (table, rows, onConflict) => {
    const uid = currentUser()?.id;
    const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, user_id: uid }));
    return req('POST', table + (onConflict ? `?on_conflict=${onConflict}` : ''), {
      body: list,
      prefer: 'resolution=merge-duplicates,return=representation',
    });
  },

  update: (table, query, patch) =>
    req('PATCH', `${table}?${query}`, { body: patch, prefer: 'return=representation' }),

  del: (table, query) => req('DELETE', `${table}?${query}`, { prefer: 'return=minimal' }),
};

/* ------------------------------------------------------------
   自检 —— 「页面是空的」有 N 种原因，必须摊开说清楚，不让人猜
   （这条是从作业发布页学来的）
   ------------------------------------------------------------ */
export async function diagnose() {
  const out = {
    configured: isConfigured(),
    endpoint: BASE || '(未填)',
    hasKey: !!KEY,
    signedIn: isSignedIn(),
    email: currentEmail(),
    tables: '未检测',
    counts: null,
    error: '',
  };
  if (!out.configured) { out.tables = '连接没配置'; return out; }
  if (!out.signedIn) { out.tables = '未登录（登录后才谈得上读表）'; return out; }

  try {
    const rows = await Promise.all([
      sb.select('cohorts', 'select=id'),
      sb.select('students', 'select=id'),
      sb.select('assignments', 'select=id'),
      sb.select('hw_marks', 'select=id'),
    ]);
    out.tables = '可读';
    out.counts = {
      班级: rows[0].length, 学生: rows[1].length,
      作业批次: rows[2].length, 异常记录: rows[3].length,
    };
  } catch (e) {
    out.tables = '读不到';
    out.error = e.message;
  }
  return out;
}
