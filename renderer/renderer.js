'use strict';

/**
 * araterm renderer — يعرض الإطارات البصرية القادمة من العملية الرئيسية
 * (النص عربي معالج مسبقًا: مشكَّل ومرتب بصريًا مع أنماطه)،
 * ويحوّل لوحة المفاتيح إلى بايتات تُرسل للصدفة.
 */

const rowsEl = document.getElementById('rows');
const cursorEl = document.getElementById('cursor');
const screenEl = document.getElementById('screen');

// تتبع تشخيصي: كل خطوة من حياة الصفحة تُسجَّل في araterm-debug.log
const rdbg = (msg) => { try { window.araterm?.debug?.(msg); } catch { /* تجاهل */ } };
rdbg(`renderer.js بدأ — الجسر ${window.araterm ? 'موجود' : 'مفقود!!'}`);
window.addEventListener('error', (e) => rdbg(`window error: ${e.message} @${e.filename}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', (e) => rdbg(`unhandled rejection: ${e.reason}`));

let cellW = 8.4;   // يُقاس بعد تحميل الخط
let cellH = 19;    // يُقاس بعد تحميل الخط
let lastCols = 90;
let lastRows = 28;

/** قياس مقاس الخلية من خط الشاشة */
function measureCell() {
  const probe = document.createElement('span');
  probe.className = 'row';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.textContent = 'MMMMMMMMMM';
  document.body.appendChild(probe);
  cellW = probe.getBoundingClientRect().width / 10;
  cellH = probe.getBoundingClientRect().height;
  probe.remove();
}

/** تطبيق نمط على عنصر span */
function applyStyle(el, style) {
  if (!style) return;
  if (style.fg) el.style.color = style.fg;
  if (style.bg) el.style.backgroundColor = style.bg;
  if (style.bold) el.style.fontWeight = 'bold';
  if (style.italic) el.style.fontStyle = 'italic';
  if (style.underline) el.style.textDecoration = 'underline';
  if (style.dim) el.style.opacity = '0.6';
  if (style.inverse) {
    const c = el.style.color;
    el.style.color = style.bg || 'var(--bg)';
    el.style.backgroundColor = c || 'var(--fg)';
  }
}

/** عرض خطأ داخل النافذة (بدل صمت أعمى) */
function showError(msg) {
  const d = document.createElement('div');
  d.className = 'row';
  d.style.color = '#e05e5e';
  d.textContent = `⚠ خطأ: ${msg}`;
  rowsEl.replaceChildren(d);
  cursorEl.style.display = 'none';
}

/** رسم إطار كامل */
function drawFrame(frame) {
  try {
    const frag = document.createDocumentFragment();
  for (let r = 0; r < frame.rows.length; r++) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'row';
    const parts = frame.rows[r].parts;
    if (!parts || parts.length === 0) {
      rowDiv.appendChild(document.createTextNode('\u00A0'));
    } else {
      for (const p of parts) {
        const span = document.createElement('span');
        applyStyle(span, p.style);
        span.textContent = p.text;
        rowDiv.appendChild(span);
      }
    }
    frag.appendChild(rowDiv);
  }
  rowsEl.replaceChildren(frag);

  // المؤشر
  const c = frame.cursor;
  if (c && !c.hidden) {
    cursorEl.style.display = 'block';
    cursorEl.style.left = 8 + c.visualX * cellW + 'px';
    cursorEl.style.top = 8 + c.row * cellH + 'px';
    cursorEl.style.width = cellW + 'px';
    cursorEl.style.height = cellH + 'px';
  } else {
    cursorEl.style.display = 'none';
  }
  } catch (err) {
    showError(`تعطل الرسم — ${err && err.message ? err.message : err}`);
  }
}

/** إبلاغ الرئيسية بالمقاس الجديد بالخلايا */
function reportSize() {
  const w = screenEl.clientWidth - 16;
  const h = screenEl.clientHeight - 16;
  lastCols = Math.max(10, Math.floor(w / cellW));
  lastRows = Math.max(4, Math.floor(h / cellH));
  window.araterm.resize(lastCols, lastRows);
}

// ---------------------------------------------------------------------------
// المدخلات: لوحة مفاتيح → متتاليات VT
// ---------------------------------------------------------------------------

const SEQ = {
  Enter: '\r',
  Backspace: '\x7f',
  Tab: '\t',
  Escape: '\x1b',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  Delete: '\x1b[3~',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  Insert: '\x1b[2~',
};

document.addEventListener('keydown', (e) => {
  // كترل + حرف → بايت التحكم
  if (e.ctrlKey && !e.altKey && /^Key[A-Z]$/.test(e.code)) {
    const byte = String.fromCharCode(e.code.charCodeAt(3) - 64);
    e.preventDefault();
    window.araterm.sendInput(byte);
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return; // الاختصارات النظامية تمر
  if (SEQ[e.key] !== undefined) {
    e.preventDefault();
    window.araterm.sendInput(SEQ[e.key]);
    return;
  }
  // حرف قابل للطبع (بما فيه العربية)
  if (e.key.length === 1) {
    rdbg(`مفتاح: ${JSON.stringify(e.key)}`);
    e.preventDefault();
    window.araterm.sendInput(e.key);
  }
});

// لصق: النص كما هو (الصدفة تعيد صداه عبر الـ pty فيُرسم مصححًا)
document.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') ?? '';
  if (text) window.araterm.sendInput(text.replace(/\r?\n/g, '\r'));
  e.preventDefault();
});

// عجلة الفأرة: تمرير السجل
screenEl.addEventListener('wheel', (e) => {
  window.araterm.scroll(Math.sign(e.deltaY));
  e.preventDefault();
}, { passive: false });

// ---------------------------------------------------------------------------
// التهيئة
// ---------------------------------------------------------------------------

// لو فشل تحميل الجسر (preload) نظهر السبب بدل نافذة فارغة صامتة
if (!window.araterm) {
  const d = document.createElement('div');
  d.style.cssText = 'color:#e05e5e;padding:16px;font-size:15px';
  d.textContent = '⚠ لم يُحمّل جسر preload — أرسل ملف araterm-debug.log';
  document.body.appendChild(d);
} else {

let gotFrame = false;

rdbg('بدأ تسجيل المستمعين (onFrame/onError/onExit)');

window.araterm.onError((msg) => showError(msg));
window.araterm.onFrame((frame) => {
  if (!gotFrame) rdbg('أول إطار وصل من الرئيسية ✅');
  gotFrame = true;
  drawFrame(frame);
});
window.araterm.onExit(({ exitCode }) => {
  const msg = document.createElement('div');
  msg.className = 'exit-msg';
  msg.textContent = `\u2014 انتهت الصدفة (كود الخروج ${exitCode}) \u2014`;
  screenEl.appendChild(msg);
});

if (document.fonts?.ready) {
  rdbg('بانتظار جاهزية الخطوط (fonts.ready)...');
  document.fonts.ready.then(() => { rdbg('الخطوط جاهزة — استدعاء start()'); start(); });
} else {
  start();
}

function start() {
  rdbg('start() يبدأ');
  measureCell();
  reportSize();
  window.addEventListener('resize', () => reportSize());
  window.araterm.ready();

  // حارس مراقبة: إن لم تصل أي بيانات من الصدفة خلال 4 ثوانٍ قل للمستخدم
  setTimeout(() => {
    if (!gotFrame) {
      showError('لم تصل بيانات من الصدفة — أغلق النافذة وأرسل ملف araterm-debug.log');
    }
  }, 4000);
}

}
