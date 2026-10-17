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

/** 把 GoTrue 返回的 token 响村落成会话 */
function saveSessionFrom(j) {
  const claims = decodeJwt(j.access_token) || {};
  writeSession({
    access_token: j.access_token,
    refresh_token: j.refresh_token || '',
    expires_at: Date.now() + Math.max(60, (j.expires_in || 3600) - 60) * 1000,
    user: { id: claims.sub || j.user?.id || '', email: claims.email || j.user?.email || '' },
  });
}

/* ------------------------------------------------------------
   邮箱 + 密码登录（2026-10-17 起改用这个）
   ------------------------------------------------------------
   为什么弃用 Magic Link：邮件里的链接**指向 localhost**。
   根因是 Supabase 的 Site URL 默认是 http://localhost:3000，
   而回跳地址又不在白名单里 → GoTrue 回落到 Site URL。
   密码登录不涉及任何跳转，这个坑整个绕过去了。
   ------------------------------------------------------------ */

function authErr(res, j) {
  const code = j.error_code || j.error || '';
  const msg = j.msg || j.message || '';

  if (code === 'invalid_credentials' || /invalid login/i.test(msg)) {
    return '邮箱或密码不对。如果是第一次用，点「创建账号」。';
  }
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) {
    return '这个账号还卡在邮箱验证上 —— 去 Supabase 关掉 Authentication → Providers → Email 里的 '
         + '「Confirm email」，或者直接在 Authentication → Users 里手动新建一个已确认的用户。';
  }
  if (code === 'signup_disabled' || /signups not allowed/i.test(msg)) {
    return 'Supabase 里「允许新用户注册」还关着。两个办法：① 打开它；'
         + '② 更省事 —— 直接在 Authentication → Users → Add user 里手动建一个账号（勾上自动确认）。';
  }
  if (code === 'user_already_exists' || /already registered|already exists/i.test(msg)) {
    return '这个邮箱已经注册过了，直接点「登录」。';
  }
  if (code === 'weak_password' || /password/i.test(code) || /password should be/i.test(msg)) {
    return '密码太短 —— Supabase 默认要求至少 6 位。';
  }
  if (res.status === 429) return '请求太频繁，等一会儿再试。';
  return msg || `${code || '登录失败'}（HTTP ${res.status}）`;
}

export async function signInWithPassword(email, password) {
  if (!isConfigured()) throw new Error('还没配置 Supabase 连接');
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(authErr(res, j));
  saveSessionFrom(j);
  return true;
}

/** 返回 'signed-in'（关了邮箱验证，直接进）或 'need-confirm'（还卡在验证） */
export async function signUpWithPassword(email, password) {
  if (!isConfigured()) throw new Error('还没配置 Supabase 连接');
  const res = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(authErr(res, j));
  if (j.access_token) { saveSessionFrom(j); return 'signed-in'; }
  return 'need-confirm';
}

export async function sendPasswordReset(email) {
  if (!isConfigured()) throw new Error('还没配置 Supabase 连接');
  const res = await fetch(`${BASE}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(authErr(res, j));
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

  /** 调数据库函数（PostgREST 的 rpc）。第 5 段 SQL 里的重命名/移动走这个。 */
  rpc: (fn, args = {}) => req('POST', `rpc/${fn}`, { body: args }),
};

/* ------------------------------------------------------------
   Storage（成绩归档的 HTML 存这儿）
   ------------------------------------------------------------
   🔴 桶是**私有**的：读文件必须带登录令牌，不能给公开直链。
      前端拿到的是一份 Blob，再用 URL.createObjectURL 给 iframe 用 ——
      这样地址栏和历史里都不会留下带 token 的地址。
   ------------------------------------------------------------ */
async function storageReq(method, path, { body, headers = {} } = {}) {
  if (!isConfigured()) throw new Error('还没配置 Supabase 连接');
  const token = await ensureFresh();
  if (!token) throw new Error('NOT_SIGNED_IN');

  const res = await fetch(`${BASE}/storage/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, ...headers },
    body,
  });

  if (res.status === 401 || res.status === 403) {
    writeSession(null);
    throw new Error('登录已失效，请重新登录');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(t);
      msg = j.message || j.error || msg;
      if (/Bucket not found/i.test(msg)) msg = '存储桶 grades 不存在 —— 第 4 段 SQL 跑了吗？';
      if (/row-level security|policy/i.test(msg)) msg = '存储桶策略拦住了 —— 第 4 段 SQL 里的 storage.objects 策略建了吗？';
    } catch { if (t) msg += ' — ' + t.slice(0, 140); }
    throw new Error(msg);
  }
  return res;
}

export const sbStore = {
  /**
   * 上传一个文件。key 用纯 ASCII（时间戳+随机串），
   * 避免中文文件名在 URL 编码上出幺蛾子 —— 显示名另存在表的 title 里。
   */
  async upload(bucket, file) {
    const uid = currentUser()?.id || 'anon';
    const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.html'])[0].toLowerCase();
    const key = `${uid}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    await storageReq('POST', `object/${bucket}/${key}`, {
      body: file,
      headers: { 'Content-Type': file.type || 'text/html' },
    });
    return key;
  },

  /** 下载成 Blob（私有桶不能直接给 iframe src） */
  async download(bucket, key) {
    const res = await storageReq('GET', `object/${bucket}/${key}`);
    return res.blob();
  },

  async remove(bucket, keys) {
    if (!keys.length) return;
    await storageReq('DELETE', `object/${bucket}`, {
      body: JSON.stringify({ prefixes: keys }),
      headers: { 'Content-Type': 'application/json' },
    });
  },
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
