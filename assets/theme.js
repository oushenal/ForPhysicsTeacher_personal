/* ============================================================
   physics · 主题（外观）管理
   ------------------------------------------------------------
   两个独立维度：
     ① 明暗主题（paper 浅 / ink 深）—— 写 <html data-theme>
     ② 身份色色相（--brand-hue）—— 饱和度/亮度不变，只旋转色相
   两者都持久化到 localStorage。
   色值本体都在 themes.css，这里只管切变量。
   ============================================================ */

const THEME_KEY = 'physics.theme';
const HUE_KEY = 'physics.hue';

const THEMES = [
  { id: 'paper', name: '纸质档', desc: '暖米白纸感，默认' },
  { id: 'ink', name: '墨夜', desc: '深底，课堂投屏 / 夜间' },
];

/** 色相预设：饱和度不变，只转色环上的位置（用户点名要的绿色系/蓝色系） */
const HUES = [
  { id: 'rust', name: '赭红', hue: 11,  desc: '默认' },
  { id: 'amber', name: '琥珀', hue: 32,  desc: '橙黄' },
  { id: 'green', name: '苔绿', hue: 140, desc: '绿色系' },
  { id: 'teal', name: '青碧', hue: 175, desc: '青绿色' },
  { id: 'blue', name: '靛蓝', hue: 215, desc: '蓝色系' },
  { id: 'violet', name: '紫棠', hue: 280, desc: '紫色系' },
];

/** 当前生效的主题 id（读 DOM，因为可能被别处改过） */
export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'paper';
}

/** 当前生效的色相 hue 值（读 CSS 变量） */
export function currentHue() {
  return Number(document.documentElement.style.getPropertyValue('--brand-hue')) || 11;
}

export function listThemes() {
  return THEMES;
}

export function listHues() {
  return HUES;
}

/** 从 localStorage 恢复主题（页面加载时调一次即可） */
export function applyStoredTheme() {
  let saved = 'paper';
  try { saved = localStorage.getItem(THEME_KEY) || 'paper'; } catch { /* 隐私模式 */ }
  if (!THEMES.some((t) => t.id === saved)) saved = 'paper';
  setTheme(saved, false);

  let hue = 11;
  try { hue = Number(localStorage.getItem(HUE_KEY)) || 11; } catch { /* 隐私模式 */ }
  if (!HUES.some((h) => h.hue === hue)) hue = 11;
  setHue(hue, false);
}

/**
 * 设置主题。persist=false 时不写 localStorage（给 applyStoredTheme 用，避免重复写）。
 */
export function setTheme(id, persist = true) {
  if (!THEMES.some((t) => t.id === id)) id = 'paper';
  document.documentElement.setAttribute('data-theme', id);
  // 让表单控件、滚动条等原生部件也跟着主题走
  document.documentElement.style.colorScheme = id === 'ink' ? 'dark' : 'light';
  if (persist) {
    try { localStorage.setItem(THEME_KEY, id); } catch { /* 隐私模式 */ }
  }
  return id;
}

/**
 * 设置身份色色相（只转色环，饱和度和亮度由 themes.css 里的 hsl() 结构决定）。
 * hue 是 0-360 的数字；persist=false 时不写 localStorage。
 */
export function setHue(hue, persist = true) {
  const n = Number(hue) || 11;
  // 直接改 <html> 上的 --brand-hue，让所有 hsl(var(--brand-hue)…) 跟着变
  document.documentElement.style.setProperty('--brand-hue', String(n));
  if (persist) {
    try { localStorage.setItem(HUE_KEY, String(n)); } catch { /* 隐私模式 */ }
  }
  return n;
}
