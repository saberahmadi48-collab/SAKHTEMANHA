#!/usr/bin/env node
/**
 * بازرس فارسی بودن رابط کاربری.
 *
 * چرا این اسکریپت وجود دارد: «۱۰۰٪ فارسی» بدون ابزار سنجش، یک ادعاست نه یک
 * تضمین. با رشد پروژه (BM-01 تا BM-07) هر توسعه‌دهنده‌ای ممکن است یک
 * `<button>Save</button>` جا بگذارد. این اسکریپت آن را پیش از merge پیدا
 * می‌کند.
 *
 * سه چیز را بررسی می‌کند:
 *   ۱. متن انگلیسی در JSX که کاربر می‌بیند.
 *   ۲. کلاس‌های Tailwind جهت‌دار فیزیکی (ml-, pl-, left-, text-left) که در
 *      چیدمان راست‌چین در سمت اشتباه می‌نشینند.
 *   ۳. بازگشت فونت خارجی (next/font/google، fonts.googleapis، CDN) که وابستگی
 *      شبکه‌ای ممنوع را دوباره وارد پروژه می‌کند.
 *
 * اجرا:  npm run i18n:lint --workspace @bops/web
 * خروج ۱ در صورت یافتن تخلف، تا در CI جلوی merge را بگیرد.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** کلاس‌های جهت‌دار فیزیکی که باید با معادل منطقی جایگزین شوند. */
const PHYSICAL_DIRECTION_CLASSES = [
  { wrong: /\bm[lr]-\d/, right: 'ms-* / me-*' },
  { wrong: /\bp[lr]-\d/, right: 'ps-* / pe-*' },
  { wrong: /\b(left|right)-\d/, right: 'start-* / end-*' },
  { wrong: /\btext-(left|right)\b/, right: 'text-start / text-end' },
  { wrong: /\bborder-[lr]\b/, right: 'border-s / border-e' },
  { wrong: /\brounded-[lr]-/, right: 'rounded-s-* / rounded-e-*' },
];

/**
 * متن انگلیسی داخل JSX.
 *
 * فقط به دنبال متنی می‌گردد که بین > و < قرار دارد و حروف لاتین دارد. عمداً
 * سخت‌گیر نیست تا هشدار کاذب کم باشد؛ هدف گرفتن «Save» و «No data found» است،
 * نه هر نویسه‌ی لاتین.
 */
const JSX_ENGLISH_TEXT = />\s*([A-Za-z][A-Za-z\s.,!?'"-]{2,})\s*</g;

/**
 * منابع فونت خارجی که در پروژه ممنوع‌اند.
 *
 * چرا این قاعده لازم است: محلی کردن فونت یک کار «یک‌باره» است که به‌راحتی
 * برگشت می‌خورد — کافی است کسی برای افزودن یک فونت دوم دوباره سراغ
 * `next/font/google` برود و بی‌صدا وابستگی شبکه به بیلد بازگردد. تفاوتش با
 * دو قاعده‌ی بالا این است که خطایش در ظاهر صفحه دیده نمی‌شود؛ فقط در محیطی
 * که به گوگل دسترسی ندارد ظاهر می‌شود — یعنی محیط کاربر نهایی.
 */
const FORBIDDEN_FONT_SOURCES = [
  { pattern: /next\/font\/google/, label: 'next/font/google' },
  { pattern: /fonts\.googleapis\.com/, label: 'fonts.googleapis.com' },
  { pattern: /fonts\.gstatic\.com/, label: 'fonts.gstatic.com' },
  { pattern: /cdn\.jsdelivr\.net\/.*(font|woff)/i, label: 'jsDelivr (فونت)' },
  { pattern: /use\.typekit\.net/, label: 'Typekit' },
  { pattern: /fonts\.cdnfonts\.com/, label: 'cdnfonts' },
];

/**
 * فایل‌هایی که از قاعده‌ی فونت معاف‌اند.
 *
 * `fetch-vazirmatn.mjs` عمداً به CDN وصل می‌شود — کارش دقیقاً همین است: یک‌بار
 * فایل را می‌آورد تا داخل مخزن ذخیره شود. خودِ همین فایل بازرس هم الگوها را
 * به‌صورت متن دارد و نباید خودش را تخلف حساب کند.
 */
const FONT_RULE_EXEMPT = new Set(['scripts/fetch-vazirmatn.mjs', 'scripts/check-persian-ui.mjs']);

/** موارد مجاز: نام‌های فنی که متن رابط نیستند. */
const ALLOWED_ENGLISH = new Set([
  'BOPS',
  'API',
  'UUID',
  'IRR',
  'RTL',
  'LTR',
]);

async function* walk(dir, extensions) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      yield* walk(full, extensions);
    } else if (extensions.test(entry.name)) {
      yield full;
    }
  }
}

const violations = [];

/**
 * بازرسی فونت روی دامنه‌ی وسیع‌تری از فایل‌ها اجرا می‌شود: یک <link> به
 * گوگل‌فونت می‌تواند در CSS، در پیکربندی، یا در هر ماژولی باشد — نه فقط .tsx.
 */
const FONT_SCAN_DIRS = [SRC, join(ROOT, 'scripts')];
const FONT_SCAN_FILES = [join(ROOT, 'tailwind.config.ts'), join(ROOT, 'next.config.mjs')];

const fontScanned = new Set();
for (const dir of FONT_SCAN_DIRS) {
  for await (const file of walk(dir, /\.(tsx?|jsx?|mjs|css|scss)$/)) {
    fontScanned.add(file);
  }
}
for (const file of FONT_SCAN_FILES) {
  fontScanned.add(file);
}

for (const file of fontScanned) {
  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  const rel = relative(ROOT, file).split('\\').join('/');
  if (FONT_RULE_EXEMPT.has(rel)) continue;

  content.split('\n').forEach((line, index) => {
    // کامنت‌ها نادیده گرفته می‌شوند: توضیح دادن اینکه «چرا از گوگل‌فونت استفاده
    // نمی‌کنیم» خودش تخلف نیست. بدون این بررسی، بازرس روی مستندسازی خودش خطا
    // می‌دهد و توسعه‌دهنده یاد می‌گیرد خروجی را نادیده بگیرد — که بدتر از
    // نداشتن بازرس است.
    const trimmed = line.trim();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      return;
    }

    for (const { pattern, label } of FORBIDDEN_FONT_SOURCES) {
      if (pattern.test(line)) {
        violations.push({
          file: rel,
          line: index + 1,
          kind: 'FONT',
          detail: `منبع فونت خارجی «${label}». فونت باید محلی و از src/assets/fonts بارگذاری شود.`,
          text: trimmed.slice(0, 100),
        });
      }
    }
  });
}

for await (const file of walk(SRC, /\.tsx$/)) {
  const content = await readFile(file, 'utf8');
  const lines = content.split('\n');
  const rel = relative(ROOT, file);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    // توضیحات کد را نادیده بگیر — متن انگلیسی در کامنت مجاز است.
    const trimmed = line.trim();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      return;
    }

    // ۱. کلاس‌های جهت‌دار فیزیکی
    for (const { wrong, right } of PHYSICAL_DIRECTION_CLASSES) {
      if (wrong.test(line)) {
        violations.push({
          file: rel,
          line: lineNumber,
          kind: 'RTL',
          detail: `کلاس جهت‌دار فیزیکی یافت شد. به‌جای آن از ${right} استفاده کنید.`,
          text: trimmed.slice(0, 100),
        });
      }
    }

    // ۲. متن انگلیسی در JSX
    JSX_ENGLISH_TEXT.lastIndex = 0;
    let match;
    while ((match = JSX_ENGLISH_TEXT.exec(line)) !== null) {
      const text = match[1].trim();
      if (ALLOWED_ENGLISH.has(text.toUpperCase())) continue;
      // متنی که حرف فارسی دارد مشکلی ندارد.
      if (/[\u0600-\u06FF]/.test(text)) continue;
      violations.push({
        file: rel,
        line: lineNumber,
        kind: 'i18n',
        detail: `متن انگلیسی در رابط کاربری: «${text}»`,
        text: trimmed.slice(0, 100),
      });
    }
  });
}

if (violations.length === 0) {
  console.log('✅ بازرسی فارسی: هیچ تخلفی یافت نشد.');
  process.exit(0);
}

console.error(`❌ بازرسی فارسی: ${violations.length} مورد یافت شد.\n`);
for (const v of violations) {
  console.error(`  [${v.kind}] ${v.file}:${v.line}`);
  console.error(`         ${v.detail}`);
  console.error(`         ${v.text}\n`);
}
process.exit(1);
