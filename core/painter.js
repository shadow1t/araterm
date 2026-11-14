'use strict';

/**
 * araterm painter — قلب العرض العربي.
 *
 * درس معماري حاسم (2026-11-14، من أول تشغيل حقيقي): نافذتنا صفحة DOM داخل
 * Chromium — والمتصفح يشكّل العربية ويطبق BiDi بنفسه أصلاً. إرسال النص
 * "بترتيب بصري معكوس مسبقًا" (منطق التيرمنالات الغبية) جعل المتصفح يعكسه
 * مرة ثانية → انقلاب مزدوج: مرحبا ظهرت معكوسة حتى في رسائل cmd الإنجليزية.
 *
 * العقد الجديد:
 *   parts          → نص **منطقي** (الترتيب الأصلي) بأنماطه — يُرسم كما هو في
 *                    DOM، والمتصفح يتكفل بالتشكيل والاتجاه (dir="auto" لكل صف).
 *   visualClusters → الترتيب البصري كما سيرسمه المتصفح بالضبط (يسار→يمين)،
 *                    يُستخدم **لحساب موضع المؤشر فقط** عبر محرك arafix.
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
 * تحويل خلايا صف إلى مقاطع منطقية للعرض + عناقيد بصرية للمؤشر.
 *
 * @param {Array<{ch: string, style?: object}>} cells خلايا الصف بالترتيب المنطقي
 * @param {'auto'|'rtl'|'ltr'} [dir] اتجاه الفقرة (auto = أول حرف قوي — يطابق dir="auto" في HTML)
 * @returns {{parts: Array<Part>, arabic: boolean, visualClusters: Array<{cellIndex: number, rtl: boolean, w: number}>}}
 *
 * Part = { text, style, cells, clusters } — text بالترتيب المنطقي الأصلي.
 * visualClusters مرتب يسار→يمين كما سيرسمه المتصفح (لتقريب موضع المؤشر).
 */
export function rowToVisual(cells, dir = 'auto') {
  const hasArabic = cells.some((c) => c.ch && ARABIC_RE.test(c.ch));

  // عناقيد منطقية كما هي — بلا تشكيل: المتصفح يشكّل بنفسه وبخطوط أفضل
  const clusters = [];
  for (let i = 0; i < cells.length; i++) {
    const ch = cells[i].ch;
    if (ch === '' || ch == null || INVISIBLE.has(ch)) continue;
    clusters.push({ base: ch, rest: '', meta: cells[i].style, cellIndex: i });
  }

  // مقاطع العرض: منطقية، دمج المتجاور بنفس مرجع النمط
  const parts = [];
  for (const c of clusters) {
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

  // الترتيب البصري — لحساب المؤشر فقط:
  // shapeClusters لدمج لام-ألف في عنقود واحد بعرض 1 (كما يرسمها المتصفح)
  // reorderClusters بترتيب يسار→يمين مطابق لخوارزمية UAX#9 في Chromium
  const visualClusters = hasArabic
    ? reorderClusters(shapeClusters(clusters), dir).map((c) => ({
        cellIndex: c.cellIndex,
        rtl: RTL_RE.test(c.base),
        w: (c.base + c.rest).length,
      }))
    : clusters.map((c) => ({ cellIndex: c.cellIndex, rtl: false, w: (c.base + c.rest).length }));

  return { parts, arabic: hasArabic, visualClusters };
}

/**
 * الموضع البصري (عدد أحرف من يسار الصف) للمؤشر عند الفجوة المنطقية cursorX.
 *
 * القاعدة (مستوى العنقود): في عنقود RTL الفجوة المنطقية قبلَه ترسم بعده
 * بصريًا (يمينه)، والفجوة بعدَه ترسم قبله (يساره) — والعكس في LTR.
 *
 * @param {Array<{cellIndex, rtl, w}>} visualClusters ناتج rowToVisual (مرتب يسار→يمين)
 * @param {number} cursorX موضع المؤشر المنطقي (0 = بداية الصف)
 * @param {number} totalCells عدد خلايا الصف (لحالة نهاية السطر)
 * @returns {number} الموضع البصري بالأحرف
 */
export function cursorVisualX(visualClusters, cursorX, totalCells) {
  // حالة نهاية السطر: فجوة بعد آخر خلية منطقية
  if (cursorX >= totalCells) {
    const k = totalCells - 1;
    let visual = 0;
    for (const cl of visualClusters) {
      if (cl.cellIndex === k) return cl.rtl ? visual : visual + cl.w;
      visual += cl.w;
    }
    return visual;
  }

  // فجوة قبل الخلية cursorX
  let visual = 0;
  for (const cl of visualClusters) {
    if (cl.cellIndex === cursorX) return cl.rtl ? visual + cl.w : visual;
    visual += cl.w;
  }
  return visual; // الخلية غير موجودة (مثل ألف لام-ألف المدمجة) — أفضل تقريب
}
