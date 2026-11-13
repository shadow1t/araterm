# araterm

**تيرمنال عربي أولًا — الكتابة والمخرجات معًا، سليمة دائمًا**
**Arabic-first terminal emulator — typing and output, both correct**

[![Node CI](https://github.com/shadow1t/araterm/actions/workflows/ci.yml/badge.svg)](https://github.com/shadow1t/araterm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![powered by arafix](https://img.shields.io/badge/powered%20by-arafix-7aa2f7.svg)](https://github.com/shadow1t/arafix)

<div dir="rtl">

## الوعد

اكتب عربيًا في أي وقت — **يظهر متصلًا واضحًا فورًا**. وشغّل أي أمر أو أداة AI —
**مخرجاتها العربية سليمة**. لا أنابيب، لا استدعاء أدوات، لا انتظار.

كيف؟ في araterm **نحن من يرسم الشاشة**: كل حرف — سواء صدى ما تكتبه أو مخرجات
البرامج — يمر عبر محرك [arafix](https://github.com/shadow1t/arafix) (تشكيل سياقي
+ إعادة ترتيب BiDi) قبل أن يُرسم. هذا ما عجزت عنه أدوات الأنابيب للأبد، لأنها
لا تملك الرسم — أما التيرمنال فيملكه.

## المعمارية

```
لوحة المفاتيح ──┐
                ├─> node-pty (cmd/pwsh/bash) ──> @xterm/headless (محاكي VT)
   البرامج ─────┘            │
                              v
                     core/painter.js + محرك arafix
                     (خلايا → تشكيل → ترتيب بصري + أنماط + مؤشر)
                              │
                              v
                     النافذة (Electron) — عربي سليم
```

- **@xterm/headless** (محرك Terminal في VS Code) يفكك كل متتاليات VT: ألوان،
  مؤشر، تمرير، تحكم — بلا تنفيذ جزئي هش من عندنا.
- **node-pty** يشغّل صدفتك الحقيقية (ConPTY في ويندوز / PTY في لينكس وماك).
- **محرك arafix** — قلب المشروع — يحوّل كل صف إلى نص عربي مشكَّل ومرتب بصريًا،
  مع التصاق الألوان بنصها وحساب موضع المؤشر على مستوى العنقود.

## الحالة: v0.1 — نموذج أولي يعمل

**ما يعمل الآن:**
- ✅ صدفة حقيقية (CMD/PowerShell في ويندوز، bash/zsh في لينكس وماك)
- ✅ **الكتابة العربية تظهر متصلة ومرتبة فورًا** (الهدف الأساسي)
- ✅ مخرجات أي برنامج تُعرض مصححة — مع الحفاظ على الألوان والأنماط
- ✅ مؤشر وامضاء بموضعه البصري الصحيح تقريبًا (على مستوى العنقود)
- ✅ سجل رجوع بعجلة الفأرة (scrollback)
- ✅ نسخ (تحديد نص عادي) ولصق (Ctrl+V)
- ✅ أساسيات المفاتيح: أسهم، Enter، Backspace، Tab، Ctrl+C/D/L/Z…
- ✅ اختبارات وحدية للراسمة (node --test)

**قيد معروف في v0.1 (بصدق):**
- ⚠️ تطبيقات الشاشة الكاملة (vim/htop) قد تتشوش عناصرها العربية — إعادة الترتيب
  مصممة للأسطر النصية أساسًا؛ توافق TUI عنصر قائمة في الخارطة.
- ⚠️ الأحرف العريضة (CJK) تُعامل بعرض خلية واحدة في حساب المؤشر.

## التشغيل

```bash
git clone https://github.com/shadow1t/araterm.git
cd araterm
npm install
npm start        # أو: npx electron .
```

المتطلبات: Node.js ≥ 18 + ويندوز 10+ (ConPTY) أو macOS أو لينكس.
في ويندوز قد يحتاج `node-pty` أدوات بناء Visual Studio Build Tools إن لم تنزل
نسخته المجمعة مسبقًا (npm يفعل ذلك تلقائيًا غالبًا).

## خارطة الطريق

- [ ] v0.2: تبويبات + عنوان نافذة من OSC + خطوط قابلة للضبط من الواجهة
- [ ] v0.3: توافق TUI (vim/htop) — وضع "BiDi خام" للتطبيقات التي ترسم نفسها
- [ ] v0.4: إعدادات (ثيمات، خط، صدفة افتراضية) + حفظ الجلسة
- [ ] v0.5: توزيع كحزمة تثبيت (NSIS/MSI) وإصدار GitHub Releases
- [ ] v1.0: تقسيم نوافذ (panes) + بروفايلات + نشر npm

## لماذا هذا المشروع؟

لأن Windows Terminal لا يطبق BiDi حتى اليوم، وkitty كذلك، ومستخدم العربية
يظل مهمّشًا في التيرمنالات منذ عقود. araterm مبني ليكون **تيرمنالًا يضع
العربية في المقام الأول** — لا إضافة لاحقة.

## الترخيص

[MIT](LICENSE) © 2026 Rasheed (shadow1t)

</div>

---

## English

**araterm** is an Arabic-first terminal: typed Arabic and program output both
render correctly, because araterm owns the rendering pipeline and pushes every
line through the [arafix](https://github.com/shadow1t/arafix) engine
(contextual shaping + simplified BiDi, UAX #9) before drawing.

Stack: Electron + node-pty + @xterm/headless (the VS Code terminal engine) +
arafix as the text core. Status: **v0.1 prototype** — real shell, correct typed
echo, colors preserved through reordering, cluster-level cursor, scrollback,
copy/paste. Known limits: full-screen TUI apps (vim/htop) and wide CJK cursor
metrics are on the roadmap.

```bash
npm install && npm start
```

License: [MIT](LICENSE) © 2026 Rasheed (shadow1t)
