'use strict';

/**
 * araterm painter — قلب العرض العربي.
 *
 * يحوّل صفًا من خلايا الشاشة (حرف + نمط لكل خلية) إلى مقاطع بالترتيب
 * البصري الصحيح عبر محرك arafix (تشكيل سياقي + BiDi)، مع التصاق النمط
 * (اللون/الوزن) بنصه أثناء إعادة الترتيب، وحساب الموضع البصري للمؤشر
 * على مستوى العنقود الواحد (العربي RTL واللاتيني LTR في نفس المقطع).
 *
 * وحدة نقية بلا اعتماد على Electron — قابلة للاختبار بـ node --test.
 */

import { shapeClusters, reorderClusters } from 'arafix';

/** محارف خفية: لا تُعرض أصلًا (علامات اتجاه وأصفار عرض). */
const INVISIBLE = new Set([
  '\u061C', '\u200B', '\u200C', '\u200D', '\u200E', '\u200F',
  '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
  '\u2066', '\u2067', '\u2068', '\u2069', '\uFEFF',
]);

/** هل الحرف عربي (أو صورة عرضية عربية)؟ */
const ARABIC_RE = /[\u0621-\u064A\u0671-\u06D3\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** عنقود بصري يمين-إلى-يسار؟ (صور العرض FE70+ حتمًا RTL). */
const RTL_RE = /[\u0621-\u064A\u0671-\u06D3\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * تحويل خلايا صف إلى مقاطع بصرية.
 *
 * @param {Array<{ch: string, style?: object}>} cells خلايا الصف بالترتيب المنطقي
 * @param {'auto'|'rtl'|'ltr'} [dir] اتجاه الفقرة
 * @returns {{parts: Array<Part>, arabic: boolean}}
 *
 * Part = { text, style, cells: number[], clusters: {cellIndex, rtl, w}[] }
 *   clusters يصف كل عنقود: فهرس خليته المنطقية، اتجاهه، وعرضه البصري (أحرف).
 */
export function rowToVisual(cells, dir = 'auto') {
  const hasArabic = cells.some((c) => c.ch && ARABIC_RE.test(c.ch));

  if (!hasArabic) {
    // لا عربية في الصف: تمرير مباشر مع دمج الخلايا المتشابهة النمط
    const parts = [];
    const push = (ch, i) => {
      const last = parts[parts.length - 1];
      if (last && last.style === cells[i].style) {
        last.text += ch;
        last.cells.push(i);
        last.clusters.push({ cellIndex: i, rtl: false, w: 1 });
      } else {
        parts.push({
          text: ch,
          style: cells[i].style,
          cells: [i],
          clusters: [{ cellIndex: i, rtl: false, w: 1 }],
        });
      }
    };
    for (let i = 0; i < cells.length; i++) {
      const ch = cells[i].ch;
      if (ch === '' || ch == null || INVISIBLE.has(ch)) continue;
      push(ch, i);
    }
    return { parts, arabic: false };
  }

  // عناقيد تحمل النمط وفهرس الخلية، ثم تشكيل ثم ترتيب بصري
  const clusters = [];
  for (let i = 0; i < cells.length; i++) {
    const ch = cells[i].ch;
    if (ch === '' || ch == null || INVISIBLE.has(ch)) continue;
    clusters.push({ base: ch, rest: '', meta: cells[i].style, cellIndex: i });
  }

  const visual = reorderClusters(shapeClusters(clusters), dir);

  // دمج المتجاورين بنفس النمط، مع اتجاه لكل عنقود على حدة
  const parts = [];
  for (const c of visual) {
    const cluster = { cellIndex: c.cellIndex, rtl: RTL_RE.test(c.base), w: (c.base + c.rest).length };
    const last = parts[parts.length - 1];
    if (last && last.style === c.meta) {
      last.text += c.base + c.rest;
      last.cells.push(c.cellIndex);
      last.clusters.push(cluster);
    } else {
      parts.push({
        text: c.base + c.rest,
        style: c.meta,
        cells: [c.cellIndex],
        clusters: [cluster],
      });
    }
  }
  return { parts, arabic: true };
}

/**
 * الموضع البصري (عدد أحرف من يسار الصف) للمؤشر عند الفجوة المنطقية cursorX.
 *
 * القاعدة (مستوى العنقود): في عنقود RTL الفجوة المنطقية قبلَه ترسم بعده
 * بصريًا (يمينه)، والفجوة بعدَه ترسم قبله (يساره) — والعكس في LTR.
 *
 * @param {Array<Part>} parts ناتج rowToVisual للصف
 * @param {number} cursorX موضع المؤشر المنطقي (0 = بداية الصف)
 * @param {number} totalCells عدد خلايا الصف (لحالة نهاية السطر)
 * @returns {number} الموضع البصري بالأحرف
 */
export function cursorVisualX(parts, cursorX, totalCells) {
  // حالة نهاية السطر: فجوة بعد آخر خلية منطقية
  if (cursorX >= totalCells) {
    const k = totalCells - 1;
    let visual = 0;
    for (const p of parts) {
      for (const cl of p.clusters) {
        if (cl.cellIndex === k) return cl.rtl ? visual : visual + cl.w;
        visual += cl.w;
      }
    }
    return visual;
  }

  // فجوة قبل الخلية cursorX
  let visual = 0;
  for (const p of parts) {
    for (const cl of p.clusters) {
      if (cl.cellIndex === cursorX) return cl.rtl ? visual + cl.w : visual;
      visual += cl.w;
    }
  }
  return visual; // الخلية غير موجودة (مثل فجوة لام-ألف) — أفضل تقريب
}
