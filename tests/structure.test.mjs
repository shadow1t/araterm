'use strict';

/**
 * اختبارات بنية المشروع — تحرس من أخطاء لا تظهر إلا في Electron الحقيقي.
 * (درس 2026-11-14: preload.js رُفض بـ ERR_REQUIRE_ESM لأن type:module،
 * فماتت النافذة بصمت على جهاز المستخدم بينما CI كله أخضر)
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

test('preload بامتداد .cjs — Electron يحمّله بـ require() ولا يقبل ESM', () => {
  const mainSrc = readFileSync(path.join(root, 'main.js'), 'utf8');
  const m = /preload:\s*path\.join\(__dirname,\s*'([^']+)'\)/.exec(mainSrc);
  assert.ok(m, 'main.js يجب أن يحدد preload عبر path.join(__dirname, ...)');
  assert.match(m[1], /\.cjs$/,
    `ملف الـ preload "${m[1]}" يجب أن ينتهي بـ .cjs — وإلا رفضه Electron (ERR_REQUIRE_ESM) عند type:module`);
  assert.ok(existsSync(path.join(root, m[1])), `الملف ${m[1]} غير موجود في المستودع`);
});

test('preload.cjs كود CommonJS صرف (لا import/export علوي)', () => {
  const src = readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m, 'preload.cjs لا يجوز أن يحوي import علويًا');
  assert.doesNotMatch(src, /^\s*export\s/m, 'preload.cjs لا يجوز أن يحوي export علويًا');
  assert.match(src, /require\('electron'\)/, 'يجب أن يستخدم require()');
});

test('main.js يمسك بملف ESM (type:module أو امتداد .mjs)', () => {
  const isEsm = pkg.type === 'module' || /main.*\.mjs/.test(pkg.main || '');
  const mainSrc = readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.ok(isEsm, 'هذا الاختبار يفترض main كـ ESM');
  assert.match(mainSrc, /^import\s\{[^}]*\}\sfrom\s'electron';/m,
    'main.js يجب أن يبدأ باستيراد Electron عبر import');
});
