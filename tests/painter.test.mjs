'use strict';

/**
 * اختبارات الراسمة — العقد الجديد (ما بعد درس الانقلاب المزدوج):
 *   parts: نص **منطقي** (المتصفح يشكّل ويرتب بنفسه — DOM ليس تيرمنال غبيًا)
 *   visualClusters: الترتيب البصري يسار→يمين لحساب موضع المؤشر فقط
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rowToVisual, cursorVisualX } from '../core/painter.js';

const M = '\u0645', R = '\u0631', H = '\u062D', B = '\u0628', A = '\u0627'; // م ر ح ب ا
const LAM = '\u0644';

/** بناء خلايا من نص (نمط واحد مشترك) */
function cells(text, styleFactory) {
  const style = styleFactory || { fg: null };
  return [...text].map((ch) => ({ ch, style }));
}

test('سطر لاتيني: نص منطقي كما هو + دمج الخلايا المتشابهة', () => {
  const { parts, arabic, visualClusters } = rowToVisual(cells('hello'));
  assert.equal(arabic, false);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, 'hello');
  assert.deepEqual(visualClusters.map((c) => c.cellIndex), [0, 1, 2, 3, 4]);
});

test('دمج المتجاور بنفس النمط وفصل المختلف — بالترتيب المنطقي', () => {
  const red = { fg: 'red' }, blue = { fg: 'blue' };
  const cs = [
    { ch: 'a', style: red }, { ch: 'b', style: red },
    { ch: 'c', style: blue }, { ch: 'd', style: blue },
  ];
  const { parts } = rowToVisual(cs);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, 'ab');
  assert.equal(parts[1].text, 'cd');
  assert.equal(parts[0].style, red);
});

test('عربي: parts بالترتيب المنطقي الأصلي وبلا صور عرضية (المتصفح يشكّل)', () => {
  const word = M + R + H + B + A; // مرحبا منطقيًا
  const { parts, arabic } = rowToVisual(cells(word));
  assert.equal(arabic, true);
  assert.equal(parts[0].text, word); // م أولًا وآخرًا — لا عكس
  for (const ch of parts[0].text) {
    assert.ok(!(ch.charCodeAt(0) >= 0xFB50 && ch.charCodeAt(0) <= 0xFEFF),
      `لا يجوز إخراج صور عرضية للتDOM: ${ch.codePointAt(0).toString(16)}`);
  }
});

test('عربي: الترتيب البصري للمؤشر معكوس داخليًا (يسار→يمين: ا ب ح ر م)', () => {
  const word = M + R + H + B + A;
  const { visualClusters } = rowToVisual(cells(word));
  assert.deepEqual(visualClusters.map((c) => c.cellIndex), [4, 3, 2, 1, 0]);
  assert.ok(visualClusters.every((c) => c.rtl && c.w === 1));
});

test('سطر مختلط لاتيني أولًا: dir=auto يعطي فقرة LTR — hello ثم العربية يمينًا', () => {
  const text = 'hello ' + M + R + H + B + A; // "hello مرحبا" — أول قوي = h → LTR
  const { parts, visualClusters } = rowToVisual(cells(text));
  assert.equal(parts[0].text, text); // منطقي كما هو
  // البصري: h e l l o [فراغ] ثم ا ب ح ر م
  assert.deepEqual(visualClusters.map((c) => c.cellIndex), [0, 1, 2, 3, 4, 5, 10, 9, 8, 7, 6]);
});

test('مؤشر نهاية سطر عربي: يرسم عند الحافة اليسرى (مثال مرحبا → 0)', () => {
  const word = M + R + H + B + A;
  const { visualClusters } = rowToVisual(cells(word));
  assert.equal(cursorVisualX(visualClusters, 5, 5), 0);
});

test('مؤشر نهاية "hello مرحبا": يسار عنقود الألف = عمود 6', () => {
  const text = 'hello ' + M + R + H + B + A;
  const { visualClusters } = rowToVisual(cells(text));
  assert.equal(cursorVisualX(visualClusters, 11, 11), 6);
});

test('مؤشر قبل الميم في "hello مرحبا": يمين الميم بصريًا = عمود 11', () => {
  const text = 'hello ' + M + R + H + B + A;
  const { visualClusters } = rowToVisual(cells(text));
  assert.equal(cursorVisualX(visualClusters, 6, 11), 11);
});

test('عربي أولًا في سطر مختلط: dir=auto يعطي فقرة RTL — hello يسارًا', () => {
  const text = M + R + H + B + A + ' hello'; // "مرحبا hello" — أول قوي = م → RTL
  const { visualClusters } = rowToVisual(cells(text));
  // البصري يسار→يمين: h e l l o [فراغ] ا ب ح ر م
  assert.deepEqual(visualClusters.map((c) => c.cellIndex), [6, 7, 8, 9, 10, 5, 4, 3, 2, 1, 0]);
});

test('مؤشر نهاية "مرحبا hello": بعد واو hello البصرية = عمود 5', () => {
  const text = M + R + H + B + A + ' hello';
  const { visualClusters } = rowToVisual(cells(text));
  assert.equal(cursorVisualX(visualClusters, 11, 11), 5);
});

test('لام-ألف: عنقود بصري واحد بعرض 1 (كما يرسمها المتصفح)', () => {
  const { parts, visualClusters } = rowToVisual(cells(LAM + A)); // "لا"
  assert.equal(parts[0].text, LAM + A); // النص المنطقي كما هو — المتصفح يركّبها
  assert.equal(visualClusters.length, 1);
  assert.equal(visualClusters[0].w, 1);
  assert.equal(visualClusters[0].cellIndex, 0);
});

test('محارف خفية (علامات اتجاه): لا تصل إلى العرض', () => {
  const style = {};
  const cs = [
    { ch: 'a', style }, { ch: '\u200F', style }, { ch: 'b', style },
  ];
  const { parts } = rowToVisual(cs);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, 'ab');
});

test('لا عربية: visualClusters بترتيب منطقي مباشر وltr', () => {
  const { visualClusters } = rowToVisual(cells('abc'));
  assert.ok(visualClusters.every((c) => !c.rtl));
  assert.deepEqual(visualClusters.map((c) => c.w), [1, 1, 1]);
});

test('محارف عريضة (إيموجي): w=2 من الخلية يحترم في حساب المؤشر', () => {
  const style = {};
  const cs = [
    { ch: 'a', style, w: 1 },
    { ch: '✅', style, w: 2 }, // East Asian Wide — عمودان في xterm
    { ch: 'b', style, w: 1 },
  ];
  const { parts, visualClusters } = rowToVisual(cs);
  assert.equal(parts[0].text, 'a✅b');
  assert.deepEqual(visualClusters.map((c) => c.w), [1, 2, 1]);
  assert.equal(cursorVisualX(visualClusters, 3, 3), 4);
});

test('إيموجي فلكي بلا w (خارج xterm): يُحسب عمودين تلقائيًا (surrogate pair)', () => {
  const style = {};
  const cs = [{ ch: '😊', style }]; // U+1F60A — زوج عالٍ، طوله 2 وحدتا كود
  const { visualClusters } = rowToVisual(cs);
  assert.equal(visualClusters[0].w, 2);
});
