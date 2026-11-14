'use strict';

/**
 * araterm — العملية الرئيسية (Electron main)
 *
 *   pty (cmd/pwsh/bash) ──> @xterm/headless (محاكي VT) ──> painter (محرك arafix)
 *        ──> إطارات بصرية إلى النافذة عبر IPC
 *
 * الكتابة أثناء الطبع تظهر سليمة لأن الصدفة تعيد صدى كل حرف عبر الـ pty،
 * ونحن نرسم تلك الأBytes عبر محرك التشكيل — على عكس التيرمنالات الغبية.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ptyPkg from 'node-pty';
import headlessPkg from '@xterm/headless';
import { rowToVisual, cursorVisualX } from './core/painter.js';

const { spawn } = ptyPkg;
const { Terminal } = headlessPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// علاج عطل معروف في Electron على ويندوز: بعض تعريفات GPU تقتل عملية الرسم
// فتفتح النافذة فارغة صامتة (لا فائدة تسريع عتادي في تيرمنال نصي)
app.disableHardwareAcceleration();

// ---------------------------------------------------------------------------
// تشخيص: ملف سجل بجانب المشروع + عرض الأخطاء في النافذة بدل صمت أعمى
// ---------------------------------------------------------------------------
const DEBUG_LOG = path.join(__dirname, 'araterm-debug.log');
let dataChunks = 0;

function dbg(msg) {
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* القرص غير متاح — نتجاهل */ }
}

process.on('uncaughtException', (err) => {
  dbg(`UNCAUGHT ${err && err.stack ? err.stack : err}`);
  try {
    if (win && !win.isDestroyed()) win.webContents.send('frame-error', String(err && err.message ? err.message : err));
  } catch { /* قد تكون النافذة ميتة */ }
});
process.on('unhandledRejection', (err) => {
  dbg(`UNHANDLED ${err && err.stack ? err.stack : err}`);
});

function notifyError(err) {
  dbg(`ERROR ${err && err.stack ? err.stack : err}`);
  try {
    if (win && !win.isDestroyed()) win.webContents.send('frame-error', String(err && err.message ? err.message : err));
  } catch { /* النافذة غير متاحة */ }
}

const COLS = 90;
const ROWS = 28;

/** ألوان ANSI الأساسية والساطعة → CSS */
const ANSI = [
  '#2e2e2e', '#c74242', '#38a13e', '#c7a542',
  '#4257c7', '#a13ea1', '#3ea1a1', '#c7c7c7',
  '#7f7f7f', '#e05e5e', '#5ecb62', '#e0c95e',
  '#5e71e0', '#cb5ecb', '#5ecbcb', '#ffffff',
];

/** تحويل لون من xterm (رقم أو RGB) إلى CSS */
function toCss(color, isDefault) {
  if (isDefault) return null;
  if (color < 16) return ANSI[color];
  if (color < 256) {
    // لوحة xterm-256: مكعب ألوان + تدرج رمادي
    if (color < 232) {
      const c = color - 16;
      const lv = (v) => (v === 0 ? 0 : 55 + v * 40);
      const r = lv(Math.floor(c / 36)), g = lv(Math.floor(c / 6) % 6), b = lv(c % 6);
      return `rgb(${r},${g},${b})`;
    }
    const v = 8 + (color - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  return `#${(color - (1 << 24)).toString(16).padStart(6, '0')}`;
}

let win = null;
let term = null;
let ptyProc = null;
let renderTimer = null;

/** كاش الأنماط: مفتاح نصي → كائن نمط واحد (يتيح دمج المقاطع) */
const styleCache = new Map();
function cellStyle(cell) {
  const key = [
    cell.isFgDefault() ? -1 : cell.getFgColor(),
    cell.isBgDefault() ? -1 : cell.getBgColor(),
    cell.isBold() ? 1 : 0,
    cell.isItalic() ? 1 : 0,
    cell.isUnderline() ? 1 : 0,
    cell.isInverse() ? 1 : 0,
    cell.isDim() ? 1 : 0,
  ].join('|');
  let s = styleCache.get(key);
  if (!s) {
    s = {
      fg: toCss(cell.getFgColor(), cell.isFgDefault()),
      bg: toCss(cell.getBgColor(), cell.isBgDefault()),
      bold: cell.isBold() || false,
      italic: cell.isItalic() || false,
      underline: cell.isUnderline() || false,
      inverse: cell.isInverse() || false,
      dim: cell.isDim() || false,
    };
    styleCache.set(key, s);
  }
  return s;
}

/** قراءة صف من مخزن xterm وتحويله إلى خلايا الراسمة */
function readRow(line, cols) {
  if (!line) return [];
  const cells = [];
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    cells.push({ ch: cell.getChars(), style: cellStyle(cell), w: cell.getWidth() });
  }
  return cells;
}

/** بناء إطار كامل (كل الصفوف المرئية + المؤشر) وإرساله للنافذة */
function sendFrame() {
  if (!win || win.isDestroyed()) return;
  try {
    const buf = term.buffer.active;
    const rows = [];
    for (let r = 0; r < term.rows; r++) {
      const line = buf.getLine(buf.viewportY + r);
      const cells = readRow(line, term.cols);
      rows.push(rowToVisual(cells));
    }

    // المؤشر (يُخفى عند التمرير في السجل — إصدار أولي)
    const scrolled = buf.viewportY > 0;
    const cursorRow = buf.cursorY;
    const cursor = {
      row: cursorRow,
      visualX: buf.cursorX,
      hidden: scrolled || cursorRow >= term.rows,
    };
    if (!cursor.hidden && rows[cursorRow]) {
      cursor.visualX = cursorVisualX(rows[cursorRow].visualClusters, buf.cursorX, term.cols);
    }
    win.webContents.send('frame', { rows, cursor });
  } catch (err) {
    notifyError(err);
  }
}

/** جدولة إطار بعد ~16ms (دمج الدفعات المتلاحقة من الـ pty) */
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    sendFrame();
  }, 16);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'araterm',
    backgroundColor: '#12121c',
    useContentSize: true,
    webPreferences: {
      // .cjs إلزامي: package.json فيها type:module — Electron يحمّل الـ preload
      // بـ require() فأي .js يُرفض بـ ERR_REQUIRE_ESM والجسر لا يوجد (عطل النافذة الفارغة)
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // توجيه كل رسائل/أخطاء صفحة النافذة إلى سجل التشخيص
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    dbg(`CONSOLE[${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('did-finish-load', () => dbg('renderer page loaded'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => dbg(`LOAD FAILED code=${code} ${desc} ${url}`));
  win.webContents.on('render-process-gone', (_e, details) => dbg(`RENDER GONE reason=${details.reason} exitCode=${details.exitCode}`));
  win.webContents.on('unresponsive', () => dbg('RENDER UNSRESPONSIVE'));
}

function spawnShell() {
  const isWin = process.platform === 'win32';
  const shell = isWin
    ? process.env.COMSPEC || 'cmd.exe'
    : process.env.SHELL || '/bin/bash';
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    LANG: `${envLocale()}.UTF-8`,
    LC_ALL: `${envLocale()}.UTF-8`,
  };

  // allowProposedApi إلزامي: واجهة buffer مستخدمة أعلاه وهي "مقترحة" في xterm
  term = new Terminal({
    cols: COLS, rows: ROWS, scrollback: 5000,
    allowProposedApi: true,
  });
  dbg(`spawn shell=${shell} cwd=${os.homedir()} node=${process.version} electron=${process.versions.electron}`);
  try {
    ptyProc = spawn(shell, [], {
      name: 'xterm-256color',
      cols: COLS,
      rows: ROWS,
      cwd: os.homedir(),
      env,
    });
  } catch (err) {
    dbg(`SPAWN FAILED ${err && err.stack ? err.stack : err}`);
    notifyError(err);
    return;
  }

  ptyProc.onData((chunk) => {
    dataChunks++;
    if (dataChunks <= 5) dbg(`pty data #${dataChunks} (${chunk.length} bytes)`);
    term.write(chunk);
    scheduleRender();
  });

  // OSC 0/2: عنوان النافذة — أدوات AI تضعه (مثل ✳ Antigravity — Claude)
  try {
    if (typeof term.onTitleChange === 'function') {
      term.onTitleChange((t) => {
        if (win && !win.isDestroyed() && t) win.setTitle(String(t));
      });
    } else {
      dbg('onTitleChange غير متاح في هذا الإصدار من xterm — العناوين معطلة');
    }
  } catch (err) { dbg(`onTitleChange: ${err.message}`); }
  ptyProc.onExit(({ exitCode }) => {
    dbg(`pty exit code=${exitCode} (بعد ${dataChunks} دفعة بيانات)`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('exit', { exitCode });
    }
    ptyProc = null;
  });
}

function envLocale() {
  const raw = process.env.LANG || process.env.LC_ALL || '';
  const m = /^([a-z]{2}_[A-Z]{2})/.exec(raw);
  if (m) return m[1];
  return process.platform === 'win32' ? 'en_US' : 'en_US';
}

app.whenReady().then(() => {
  dbg('=== araterm main ready ===');
  createWindow();
  spawnShell();

  ipcMain.on('ready', () => {
    dbg('renderer ready');
    sendFrame();
  });
  ipcMain.on('dbg', (_e, msg) => dbg(`RENDERER ${msg}`));
  // لصق مضوّق: أدوات AI تفعّل bracketed paste فتستقبل عدة أسطر كمدخل واحد
  ipcMain.on('paste', (_e, text) => {
    if (!ptyProc) return;
    let data = String(text);
    let bracketed = false;
    try {
      bracketed = !!(term.modes && term.modes.bracketedPaste);
      if (bracketed) data = `\x1b[200~${data}\x1b[201~`;
    } catch (err) { dbg(`modes: ${err.message}`); }
    dbg(`paste ${data.length} بايت (bracketed=${bracketed})`);
    ptyProc.write(data);
  });
  ipcMain.on('input', (_e, data) => {
    dbg(`input ${JSON.stringify(String(data))} (pty=${ptyProc ? 'حي' : 'ميت'})`);
    if (ptyProc) ptyProc.write(String(data));
  });
  ipcMain.on('resize', (_e, { cols, rows }) => {
    cols = Math.max(10, Math.min(400, Math.floor(cols)));
    rows = Math.max(4, Math.min(200, Math.floor(rows)));
    term.resize(cols, rows);
    if (ptyProc) ptyProc.resize(cols, rows);
    sendFrame();
  });
  ipcMain.on('scroll', (_e, delta) => {
    const buf = term.buffer.active;
    const max = Math.max(0, buf.length - term.rows);
    buf.viewportY = Math.max(0, Math.min(max, buf.viewportY + Math.sign(delta) * Math.min(3, Math.abs(delta))));
    sendFrame();
  });

  win.on('closed', () => { win = null; });
});

app.on('window-all-closed', () => app.quit());
