/* ============================================================
   physics · 设置页（apps/settings）
   ------------------------------------------------------------
   四个区块：
     ① 账户 —— 显示名 / 邮箱 / 改密码 / 注销
     ② 外观 —— 主题切换（纸质档 / 墨夜）
     ③ 数据 —— 各表数据量概览（自检）
     ④ 关于 —— 版本 / 隐私说明

   账户操作（改密码、注销）都打 GoTrue 的 /auth/v1/user，
   危险操作（注销、覆盖）一律两步确认。
   ============================================================ */
import { el, toast } from '../../assets/dom.js?v=49';
import {
  isSignedIn, currentEmail, currentDisplayName, signOut,
  updateDisplayName, updatePassword, deleteAccount, diagnose,
} from '../../assets/supabase.js?v=49';
import { renderAuthCard } from '../../assets/authcard.js?v=49';
import { listThemes, currentTheme, setTheme, listHues, currentHue, setHue } from '../../assets/theme.js?v=49';

let rerender = () => {};

/* ------------------------------------------------------------
   小件
   ------------------------------------------------------------ */
/* toast 从 assets/dom.js 共用一份（别再各处自己抄） */

function button(text, cls) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.textContent = text;
  return b;
}

function section(title) {
  const s = el('div', 'sect');
  s.appendChild(el('h2', null, title));
  s.appendChild(el('span', 'rule'));
  return s;
}

function card() {
  const c = el('div', 'setcard');
  return c;
}

function notice(text, kind) {
  const n = el('div', 'notice');
  if (kind) n.dataset.kind = kind;
  n.appendChild(el('span', 'mk', kind === 'bad' ? '○' : '●'));
  n.appendChild(el('span', 'notice-txt', text));
  return n;
}

/** 一行设置项：左侧标签 + 说明，右侧控件 */
function setRow(label, desc, control) {
  const row = el('div', 'setrow');
  const l = el('div', 'setrow-l');
  l.appendChild(el('span', 'setrow-label', label));
  if (desc) l.appendChild(el('span', 'setrow-desc', desc));
  row.appendChild(l);
  if (control) row.appendChild(control);
  return row;
}

/** 两步确认的删除按钮（复用了别处的交互范式） */
function twoStep(onConfirm, firstLabel = '删除', danger = true) {
  const wrap = el('span', 'stepdel');
  const a = button(firstLabel, 'iconbtn' + (danger ? ' iconbtn--danger' : ''));
  const ok = button('确认', 'iconbtn iconbtn--danger');
  const no = button('取消', 'iconbtn');
  ok.hidden = true; no.hidden = true;
  let timer = null;
  const reset = () => {
    clearTimeout(timer);
    a.hidden = false; ok.hidden = true; no.hidden = true;
  };
  a.addEventListener('click', () => {
    a.hidden = true; ok.hidden = false; no.hidden = false;
    timer = setTimeout(reset, 6000);
  });
  no.addEventListener('click', reset);
  ok.addEventListener('click', async () => {
    clearTimeout(timer);
    ok.disabled = true;
    await onConfirm();
  });
  wrap.appendChild(a); wrap.appendChild(ok); wrap.appendChild(no);
  return wrap;
}

/* ------------------------------------------------------------
   ① 账户
   ------------------------------------------------------------ */
function accountSection() {
  const sec = card();
  sec.appendChild(section('账户'));

  const email = isSignedIn() ? currentEmail() : '';

  /* 显示名 */
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'input';
  nameInput.value = currentDisplayName();
  nameInput.placeholder = '你的名字 / 称呼';
  nameInput.autocomplete = 'off';

  const nameSave = button('保存');
  const nameRow = setRow('显示名', '显示在右上角，代替邮箱前缀。', (() => {
    const w = el('span', 'setrow-ctl');
    w.appendChild(nameInput);
    w.appendChild(nameSave);
    return w;
  })());
  sec.appendChild(nameRow);

  nameSave.addEventListener('click', async () => {
    nameSave.disabled = true; nameSave.textContent = '保存中…';
    try {
      const n = await updateDisplayName(nameInput.value);
      nameSave.textContent = '已保存 ✓';
      toast('显示名已改为「' + n + '」');
      setTimeout(() => { nameSave.textContent = '保存'; nameSave.disabled = false; }, 1500);
      rerender();  // 顶栏 paintLogin 跟着刷新
    } catch (e) {
      toast('保存失败：' + e.message);
      nameSave.textContent = '保存'; nameSave.disabled = false;
    }
  });

  /* 邮箱（只读展示） */
  sec.appendChild(setRow('邮箱', email || '未登录', null));

  /* 改密码 */
  const pwInput = document.createElement('input');
  pwInput.type = 'password';
  pwInput.className = 'input';
  pwInput.placeholder = '新密码（至少 6 位）';
  pwInput.autocomplete = 'new-password';
  const pwSave = button('改密码');
  const pwRow = setRow('密码', '输入新密码并保存。改完仍保持登录。', (() => {
    const w = el('span', 'setrow-ctl');
    w.appendChild(pwInput);
    w.appendChild(pwSave);
    return w;
  })());
  sec.appendChild(pwRow);

  pwSave.addEventListener('click', async () => {
    const v = pwInput.value;
    if (v.length < 6) { toast('密码至少 6 位'); pwInput.focus(); return; }
    pwSave.disabled = true; pwSave.textContent = '修改中…';
    try {
      await updatePassword(v);
      pwInput.value = '';
      toast('密码已改好');
      pwSave.textContent = '改密码'; pwSave.disabled = false;
    } catch (e) {
      toast('改密码失败：' + e.message);
      pwSave.textContent = '改密码'; pwSave.disabled = false;
    }
  });

  /* 注销账户 —— 第一步不用 danger 样式，确认时再变红，别让人一进设置就被吓到 */
  const delCtl = twoStep(async () => {
    try {
      await deleteAccount();
      toast('账户已注销');
      location.hash = '#/';
      rerender();
    } catch (e) {
      toast('注销失败：' + e.message);
    }
  }, '注销账户', false);
  sec.appendChild(setRow('注销账户', '删除账户和它名下的全部数据，不可恢复。', delCtl));

  return sec;
}

/* ------------------------------------------------------------
   ② 外观
   ------------------------------------------------------------ */
function themeSection() {
  const sec = card();
  sec.appendChild(section('外观'));

  const cur = currentTheme();
  const themes = listThemes();
  const group = el('div', 'themegroup');

  for (const t of themes) {
    const b = el('button', 'themeopt');
    b.type = 'button';
    if (t.id === cur) b.setAttribute('aria-pressed', 'true');

    const sw = el('span', 'sw sw-' + t.id);
    b.appendChild(sw);

    const nm = el('span', 'themeopt-txt');
    nm.appendChild(el('span', 'nm', t.name));
    nm.appendChild(el('span', 'dsc', t.desc));
    b.appendChild(nm);

    b.addEventListener('click', () => {
      setTheme(t.id);
      rerender();  // 让选中态、以及所有用主题色的地方刷新
    });

    group.appendChild(b);
  }

  sec.appendChild(group);

  /* 身份色色相：真正的色环拾取器 —— 点/拖任意角度选 hue，
     饱和度与亮度结构不变，背景也跟着色相联动。 */
  const hueLabel = el('div', 'hue-label');
  hueLabel.appendChild(el('span', 'hue-label-t', '身份色'));
  hueLabel.appendChild(el('span', 'hue-label-d', '点色环选色区，背景会跟着变'));
  sec.appendChild(hueLabel);

  const hue = currentHue();

  const wheelWrap = el('div', 'huewheel-wrap');
  const wheel = el('div', 'huewheel');
  wheel.setAttribute('role', 'slider');
  wheel.setAttribute('aria-label', '身份色色相');
  wheel.setAttribute('aria-valuemin', '0');
  wheel.setAttribute('aria-valuemax', '360');
  wheel.setAttribute('aria-valuenow', String(hue));
  wheel.setAttribute('aria-valuetext', `${hue}°`);

  // 指针标记：定位在色环上对应角度
  const knob = el('span', 'huewheel-knob');
  positionKnob(knob, hue);
  wheel.appendChild(knob);

  wheelWrap.appendChild(wheel);

  // 读角度：从指针元素中心算 atan2，0°=顶部(赭红默认位)
  function hueFromEvent(e) {
    const r = wheel.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx, dy;
    if (e.touches) {
      dx = e.touches[0].clientX - cx; dy = e.touches[0].clientY - cy;
    } else {
      dx = e.clientX - cx; dy = e.clientY - cy;
    }
    // atan2(dy,dx) 是标准数学角（右=0，顺时针）；我们 0° 放顶部，顺时针增
    let deg = Math.atan2(dx, -dy) * 180 / Math.PI;   // 顶部=0，顺时针为正
    if (deg < 0) deg += 360;
    return Math.round(deg);
  }

  function positionKnob(k, deg) {
    // 🔴 translateY 必须用**像素**不是百分比 —— 百分比相对指针自身（16px），
    //    只挪 6px，指针会瘫在圆心（踩过）。环 168px、挖空 26%，中线半径 ≈ 53px。
    k.style.transform = `rotate(${deg}deg) translateY(-53px)`;
  }

  let dragging = false;
  const apply = (deg) => {
    setHue(deg);
    wheel.setAttribute('aria-valuenow', String(deg));
    wheel.setAttribute('aria-valuetext', `${deg}°`);
    positionKnob(knob, deg);
    // 实时刷新下方当前值标签
    const val = document.querySelector('.huewheel-val b');
    if (val) val.textContent = `${deg}°`;
    const chip = document.querySelector('.huewheel-chip');
    if (chip) chip.style.background = `hsl(${deg} 58% 42%)`;
  };

  wheel.addEventListener('pointerdown', (e) => {
    dragging = true;
    wheel.setPointerCapture(e.pointerId);
    apply(hueFromEvent(e));
  });
  wheel.addEventListener('pointermove', (e) => { if (dragging) apply(hueFromEvent(e)); });
  wheel.addEventListener('pointerup', () => { dragging = false; });
  wheel.addEventListener('pointercancel', () => { dragging = false; });
  // 键盘：左右方向键微调
  wheel.tabIndex = 0;
  wheel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); apply((hue - 1 + 360) % 360); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); apply((hue + 1) % 360); }
  });

  wheelWrap.appendChild(wheel);

  // 当前值 + 预设快捷
  const row = el('div', 'huewheel-info');
  const val = el('span', 'huewheel-val');
  val.innerHTML = `当前 <b>${hue}°</b>`;
  row.appendChild(val);
  const chip = el('span', 'huewheel-chip');
  chip.style.background = `hsl(${hue} 58% 42%)`;
  row.appendChild(chip);
  wheelWrap.appendChild(row);

  const presetLabel = el('span', 'hue-preset-label', '快捷：');
  const preset = el('div', 'huegroup');
  for (const h of listHues()) {
    const b = el('button', 'hueopt');
    b.type = 'button';
    if (h.hue === hue) b.setAttribute('aria-pressed', 'true');
    const sw = el('span', 'hue-swatch');
    sw.style.background = `hsl(${h.hue} 58% 42%)`;
    b.appendChild(sw);
    b.appendChild(el('span', 'hue-name', h.name));
    b.addEventListener('click', () => { apply(h.hue); rerender(); });
    preset.appendChild(b);
  }
  row.appendChild(presetLabel);
  wheelWrap.appendChild(preset);

  sec.appendChild(wheelWrap);

  return sec;
}

/* ------------------------------------------------------------
   环境状态 —— 从首页挪到这里（首页要干净，别堆状态条）
   ------------------------------------------------------------ */
function statusSection() {
  const sec = card();
  sec.appendChild(section('连接状态'));

  const rows = [
    { mark: '●', tone: 'ok', label: '本机存储', value: '可用' },
    isSignedIn()
      ? { mark: '●', tone: 'ok', label: 'Supabase', value: '已登录 · ' + currentEmail() }
      : { mark: '○', tone: 'off', label: 'Supabase', value: '未登录' },
    { mark: '●', tone: 'ok', label: '作业发布', value: '沿用现有地址' },
  ];

  for (const r of rows) {
    sec.appendChild(setRow(r.label, r.value, (() => {
      const m = el('span', 'mk', r.mark);
      m.dataset.state = r.tone;
      m.setAttribute('aria-hidden', 'true');
      return m;
    })()));
  }

  return sec;
}

/* ------------------------------------------------------------
   ③ 数据（自检）
   ------------------------------------------------------------ */
function dataSection() {
  const sec = card();
  sec.appendChild(section('数据'));

  if (!isSignedIn()) {
    sec.appendChild(setRow('数据概览', '登录后可查看各表数据量。', null));
    return sec;
  }

  const out = el('pre', 'diagout');
  out.textContent = '检测中…';

  const run = async () => {
    out.textContent = '检测中…';
    try {
      const d = await diagnose();
      const lines = [];
      lines.push(`连接：${d.configured ? '已配置' : '未配置'}`);
      lines.push(`登录：${d.signedIn ? d.email : '未登录'}`);
      if (d.counts) {
        lines.push('');
        for (const [k, v] of Object.entries(d.counts)) lines.push(`${k}：${v}`);
      } else {
        lines.push('');
        lines.push(d.error || d.tables);
      }
      out.textContent = lines.join('\n');
    } catch (e) {
      out.textContent = '检测失败：' + e.message;
    }
  };

  const refresh = button('重新检测');
  refresh.addEventListener('click', run);
  sec.appendChild(setRow('自检', '摊开各表真实数据量，页面为空时先看这里。', refresh));
  sec.appendChild(out);
  run();
  return sec;
}

/* ------------------------------------------------------------
   ④ 关于
   ------------------------------------------------------------ */
function aboutSection() {
  const sec = card();
  sec.appendChild(section('关于'));

  const box = el('div', 'howto');
  box.innerHTML =
    `<p><b>physics · 个人工作台</b> —— 高中物理教师的日常工具集。</p>
     <p>数据存放：作业登记与成绩归档在 <b>Supabase</b>（学生姓名成绩只进私有库 + 行级权限）；</p>
     <p>物理演示文件在 <b>GitHub 公开仓库</b>（不含学生数据）。</p>`;
  sec.appendChild(box);
  return sec;
}

/* ------------------------------------------------------------
   入口
   ------------------------------------------------------------ */
export function renderSettings(ctx = {}) {
  rerender = ctx.rerender || rerender;

  const f = document.createDocumentFragment();
  const head = el('div', 'page-head');
  head.appendChild(el('h1', null, '设置'));
  head.appendChild(el('p', 'page-sub', '账户、外观与连接。'));
  f.appendChild(head);

  f.appendChild(statusSection());
  f.appendChild(themeSection());

  if (!isSignedIn()) {
    f.appendChild(section('登录'));
    f.appendChild(renderAuthCard({
      lead: '登录后即可管理账户（显示名 / 密码 / 注销）。',
      errorText: '',
      onSuccess: () => rerender(),
    }));
    f.appendChild(aboutSection());
    return f;
  }

  f.appendChild(accountSection());
  f.appendChild(dataSection());
  f.appendChild(aboutSection());

  return f;
}
