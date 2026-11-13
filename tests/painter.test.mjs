'use strict';

/**
 * اختبارات الراسمة — painter.test.mjs
 * خلايا شاشة → مقاطع بصرية بأنماطها + موضع المؤشر البصري.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { rowToVisual, cursorVisualX } from '../core/painter.js';

const CH = (s) => Array.from(s).map((ch) => ({ ch, style: undefined }));

test('صف عربي: معكوس بصريًا مع فهارس الخلايا المنطقية', () => {
  const { parts, arabic } = rowToVisual(CH('مرحبا'));
  assert.equal(arabic, true);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, '\uFE8E\uFE92\uFEA3\uFEAE\uFEE3');
  assert.deepEqual(parts[0].cells, [4, 3, 2, 1, 0]);
  assert.ok(parts[0].clusters.every((c) => c.rtl === true));
});

test('صف لاتيني يمر كما هو مع rtl=false', () => {
  const { parts, arabic } = rowToVisual(CH('hello world'));
  assert.equal(arabic, false);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, 'hello world');
  assert.ok(parts[0].clusters.every((c) => c.rtl === false));
  assert.deepEqual(parts[0].cells, Array.from({ length: 11 }, (_, i) => i));
});

test('الأنماط: عربي أحمر + لاتيني أزرق — كل نمط يبقى مع نصه بعد الترتيب', () => {
  const red = { fg: '#ff0000' };
  const blue = { fg: '#0000ff' };
  const cells = [
    ...Array.from('مرحبا').map((ch) => ({ ch, style: red })),
    ...Array.from(' world').map((ch) => ({ ch, style: blue })),
  ];
  const { parts } = rowToVisual(cells);
  assert.equal(parts.length, 2);
  // 'world ' (بما فيه الفراغ من الخلية 5) ثم العربية المعكوسة
  assert.equal(parts[0].text, 'world ');
  assert.strictEqual(parts[0].style, blue);
  assert.deepEqual(parts[0].cells, [6, 7, 8, 9, 10, 5]);
  assert.equal(parts[1].text, '\uFE8E\uFE92\uFEA3\uFEAE\uFEE3');
  assert.strictEqual(parts[1].style, red);
  assert.deepEqual(parts[1].cells, [4, 3, 2, 1, 0]);
  // العناقيد: كل عنقود عربي RTL بعرض 1
  assert.deepEqual(parts[1].clusters.map((c) => c.rtl), [true, true, true, true, true]);
});

test('خلايا بنفس النمط المتجاور تُدمج (مرجع الكائن نفسه)', () => {
  const s = { fg: '#0f0' };
  const cells = [...Array.from('ab').map((ch) => ({ ch, style: s }))];
  const { parts } = rowToVisual(cells);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, 'ab');
  assert.strictEqual(parts[0].style, s);
});

test('محارف خفية تُحذف من الصف حتى بلا عربية', () => {
  const { parts } = rowToVisual([{ ch: 'a', style: undefined }, { ch: '\u200E', style: undefined }, { ch: 'b', style: undefined }]);
  assert.equal(parts[0].text, 'ab');
  assert.deepEqual(parts[0].cells, [0, 2]);
});

test('مؤشر نهاية سطر عربي: يظهر عند الحافة اليسرى (بداية العربية بصريًا)', () => {
  const { parts } = rowToVisual(CH('مرحبا'));
  // بعد كتابة "مرحبا" المؤشر عند الخلية 5 (نهاية السطر)
  assert.equal(cursorVisualX(parts, 5, 5), 0);
});

test('مؤشر وسط نص لاتيني: يبقى بمكانه', () => {
  const { parts } = rowToVisual(CH('hello'));
  assert.equal(cursorVisualX(parts, 3, 5), 3);
  assert.equal(cursorVisualX(parts, 0, 5), 0);
  assert.equal(cursorVisualX(parts, 5, 5), 5);
});

test('مؤشر نهاية سطر مختلط: العربية آخر ما كُتب → المؤشر قبلها بصريًا', () => {
  // "hello مرحبا": 5+1+5 = 11 خلية؛ المؤشر عند 11 (نهاية)
  const cells = CH('hello مرحبا');
  const { parts } = rowToVisual(cells);
  const x = cursorVisualX(parts, 11, 11);
  // العربية تبدأ بصريًا عند العمود 6 (بعد "hello ") وتنتهي عند 6
  assert.equal(x, 6); // يسار آخر حرف عربي بصريًا (قبل "ا" النهائية)
});

test('أقواس معكوسة عبر حدود المقاطع تظل متناسقة', () => {
  const { parts } = rowToVisual(CH('(مرحبا)'));
  assert.equal(parts[0].text, '(\uFE8E\uFE92\uFEA3\uFEAE\uFEE3)');
});

test('أرقام عربية-هندية داخل صف تحفظ ترتيبها', () => {
  const { parts } = rowToVisual(CH('سعر ٤٥ ريال'));
  const text = parts.map((p) => p.text).join('');
  assert.equal(text, '\uFEDD\uFE8E\uFEF3\uFEAD ٤٥ \uFEAE\uFECC\uFEB3');
});
