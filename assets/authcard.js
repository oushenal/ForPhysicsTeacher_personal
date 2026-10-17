/* ============================================================
   physics · 登录卡（作业登记 / 成绩归档 共用）
   ------------------------------------------------------------
   登录是全局的（一个 Supabase 会话），所以两个模块必须长得一样、
   不能各写一份 —— 否则改一处忘一处，用户会撞见两种说法。
   ============================================================ */
import { el } from './dom.js?v=19';
import {
  isConfigured, signInWithPassword, signUpWithPassword, diagnose,
} from './supabase.js?v=19';

function button(text, cls) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.textContent = text;
  return b;
}

/**
 * @param opts.errorText 顶部要显示的红色说明（比如令牌过期）
 * @param opts.onSuccess 登录成功后的回调（通常是重新渲染）
 * @param opts.lead      第一句话，各模块可以换个说法
 */
export function renderAuthCard(opts = {}) {
  const { errorText = '', onSuccess = () => {}, lead } = opts;
  const card = el('div', 'authcard');

  card.appendChild(el('p', 'authcard-lead', lead
    || '用邮箱和密码登录。第一次用请点「创建账号」——本站只有你一个人，不会有人来注册。'));

  if (!isConfigured()) {
    const n = el('p', 'authmsg');
    n.dataset.kind = 'bad';
    n.textContent = 'assets/config.js 里的 supabase.url / key 还没填，无法登录。';
    card.appendChild(n);
    return card;
  }

  const form = el('div', 'authform');
  const email = document.createElement('input');
  email.type = 'email';
  email.className = 'input';
  email.placeholder = '邮箱';
  email.autocomplete = 'username';

  const pwd = document.createElement('input');
  pwd.type = 'password';
  pwd.className = 'input';
  pwd.placeholder = '密码（至少 6 位）';
  pwd.autocomplete = 'current-password';

  form.appendChild(email);
  form.appendChild(pwd);
  card.appendChild(form);

  const row = el('div', 'authrow');
  const goIn = button('登录', 'btn-primary');
  const goUp = button('创建账号');
  row.appendChild(goIn);
  row.appendChild(goUp);
  card.appendChild(row);

  const msg = el('p', 'authmsg');
  if (errorText) { msg.textContent = errorText; msg.dataset.kind = 'bad'; }
  card.appendChild(msg);

  function read() {
    const e = email.value.trim();
    const p = pwd.value;
    if (!e || !e.includes('@')) { msg.textContent = '邮箱填得不对。'; msg.dataset.kind = 'bad'; return null; }
    if (p.length < 6) { msg.textContent = '密码至少 6 位。'; msg.dataset.kind = 'bad'; return null; }
    return { e, p };
  }

  async function run(which) {
    const v = read();
    if (!v) return;
    goIn.disabled = goUp.disabled = true;
    msg.dataset.kind = '';
    msg.textContent = which === 'in' ? '登录中…' : '创建中…';
    try {
      if (which === 'in') {
        await signInWithPassword(v.e, v.p);
      } else {
        const r = await signUpWithPassword(v.e, v.p);
        if (r === 'need-confirm') {
          msg.dataset.kind = 'bad';
          msg.textContent =
            '账号建好了，但 Supabase 还要求邮箱验证。去控制台 Authentication → Providers → Email '
            + '关掉「Confirm email」，或者在 Authentication → Users 里手动把邮箱确认掉，然后再登录。';
          goIn.disabled = goUp.disabled = false;
          return;
        }
      }
      onSuccess();
    } catch (err) {
      msg.textContent = err.message;
      msg.dataset.kind = 'bad';
      goIn.disabled = goUp.disabled = false;
    }
  }

  goIn.addEventListener('click', () => run('in'));
  goUp.addEventListener('click', () => run('up'));
  for (const inp of [email, pwd]) {
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') goIn.click(); });
  }

  const tips = el('details', 'authtips');
  tips.appendChild(el('summary', null, '登录不上？ / 报错了？'));
  tips.appendChild(el('p', null,
    '常见四种：① 还没建账号 —— 点「创建账号」；'
    + '② Supabase 里关着「允许新用户注册」—— 也可以在 Authentication → Users → Add user '
    + '里手动建，并把邮箱标为已确认；'
    + '③ 建表 SQL 还没跑 —— 能登录但读不到数据；'
    + '④ 存储桶 SQL（第 4 段）没跑 —— 成绩归档传不了文件。'));
  const diagBtn = button('运行自检');
  const diagOut = el('pre', 'diagout');
  diagBtn.addEventListener('click', async () => {
    diagOut.textContent = '检测中…';
    diagOut.textContent = JSON.stringify(await diagnose(), null, 2);
  });
  tips.appendChild(diagBtn);
  tips.appendChild(diagOut);
  card.appendChild(tips);

  return card;
}
