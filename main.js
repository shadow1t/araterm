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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ptyPkg from 'node-pty';
import headlessPkg from '@xterm/headless';
import { rowToVisual, cursorVisualX } from './core/painter.js';

const { spawn } = ptyPkg;
const { Terminal } = headlessPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    cells.push({ ch: cell.getChars(), style: cellStyle(cell) });
  }
  return cells;
}

/** بناء إطار كامل (كل الصفوف المرئية + المؤشر) وإرساله للنافذة */
function sendFrame() {
  if (!win || win.isDestroyed()) return;
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
    cursor.visualX = cursorVisualX(rows[cursorRow].parts, buf.cursorX, term.cols);
  }
  win.webContents.send('frame', { rows, cursor });
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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

  term = new Terminal({ cols: COLS, rows: ROWS, scrollback: 5000 });
  ptyProc = spawn(shell, [], {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: os.homedir(),
    env,
  });

  ptyProc.onData((chunk) => {
    term.write(chunk);
    scheduleRender();
  });
  ptyProc.onExit(({ exitCode }) => {
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
  createWindow();
  spawnShell();

  ipcMain.on('ready', () => sendFrame());
  ipcMain.on('input', (_e, data) => ptyProc && ptyProc.write(String(data)));
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
