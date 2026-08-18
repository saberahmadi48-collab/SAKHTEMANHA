#!/usr/bin/env node
/**
 * دریافت یک‌باره‌ی فایل‌های فونت وزیرمتن و ذخیره‌ی آن‌ها در مخزن پروژه.
 *
 * چرا این اسکریپت وجود دارد و چرا بخشی از بیلد نیست:
 * فونت باید *داخل مخزن* نگهداری شود (الزام ۱). پس این اسکریپت فقط یک‌بار
 * توسط توسعه‌دهنده اجرا می‌شود تا فایل‌ها را بیاورد؛ بیلد و زمان‌اجرا هرگز
 * به شبکه دست نمی‌زنند. اگر این را به `postinstall` وصل می‌کردیم، دقیقاً همان
 * «وابستگی شبکه‌ای به CDN خارجی» را که ممنوع است بازتولید کرده بودیم.
 *
 * منبع: مخزن رسمی وزیرمتن (rastikerdar/vazirmatn) — پروانه‌ی SIL OFL 1.1.
 * نسخه پین شده است: یک تگ ثابت، نه `latest`. با `latest` هر بار اجرا ممکن
 * است فایل متفاوتی بدهد و بازتولیدپذیری از بین برود.
 *
 * اجرا:  node scripts/fetch-vazirmatn.mjs
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v33.003';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(HERE, '..', 'src', 'assets', 'fonts', 'vazirmatn');

/**
 * وزن‌های موردنیاز طبق دستور کار. نام فایل‌ها عمداً همان نام‌های رسمی مخزن
 * وزیرمتن است تا ارتقای نسخه در آینده بدون تغییرنام انجام شود.
 */
const STATIC_FILES = [
  'Vazirmatn-Regular.woff2',
  'Vazirmatn-Medium.woff2',
  'Vazirmatn-SemiBold.woff2',
  'Vazirmatn-Bold.woff2',
];

/**
 * نسخه‌ی متغیر (Variable). با یک فایل تمام وزن‌های ۱۰۰ تا ۹۰۰ را پوشش می‌دهد.
 * به‌عنوان گزینه دریافت می‌شود؛ اگر در دسترس نبود، کار متوقف نمی‌شود.
 */
const VARIABLE_FILE = 'Vazirmatn[wght].woff2';

/**
 * چند آینه (mirror) به ترتیب اولویت.
 *
 * چرا بیش از یکی: در برخی شبکه‌ها یکی از این دامنه‌ها در دسترس نیست. اگر تنها
 * به یک منبع تکیه می‌کردیم، شکست شبکه = شکست کامل کار. این فقط برای همین
 * دریافت یک‌باره است؛ پس از آن فایل‌ها در مخزن‌اند و شبکه بی‌ربط می‌شود.
 */
const MIRRORS = [
  (file) =>
    `https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@${VERSION}/fonts/webfonts/${encodeURIComponent(file)}`,
  (file) =>
    `https://raw.githubusercontent.com/rastikerdar/vazirmatn/${VERSION}/fonts/webfonts/${encodeURIComponent(file)}`,
  (file) =>
    `https://fastly.jsdelivr.net/gh/rastikerdar/vazirmatn@${VERSION}/fonts/webfonts/${encodeURIComponent(file)}`,
];

/** امضای فایل woff2 طبق مشخصات W3C: چهار بایت 'wOF2'. */
const WOFF2_MAGIC = Buffer.from([0x77, 0x4f, 0x46, 0x32]);

async function download(file) {
  const errors = [];

  for (const mirror of MIRRORS) {
    const url = mirror(file);
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        errors.push(`${res.status} ${url}`);
        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer());

      // اعتبارسنجی: یک صفحه‌ی خطای HTML هم پاسخ ۲۰۰ می‌گیرد. اگر بدون بررسی
      // ذخیره شود، فایلی به‌نام «فونت» در مخزن می‌ماند که مرورگر نمی‌تواند
      // بخواند و خطا فقط در زمان‌اجرا و به‌شکل گیج‌کننده ظاهر می‌شود.
      if (!buf.subarray(0, 4).equals(WOFF2_MAGIC)) {
        errors.push(`محتوای دریافتی woff2 معتبر نیست: ${url}`);
        continue;
      }

      return { buf, url };
    } catch (err) {
      errors.push(`${err.message} ${url}`);
    }
  }

  throw new Error(`دریافت ${file} ناموفق بود:\n  - ${errors.join('\n  - ')}`);
}

async function main() {
  await mkdir(FONT_DIR, { recursive: true });

  const report = [];

  // وزن‌های ایستا اجباری‌اند: اگر یکی نیاید، کار باید با خطا متوقف شود.
  for (const file of STATIC_FILES) {
    const { buf, url } = await download(file);
    await writeFile(path.join(FONT_DIR, file), buf);

    const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    report.push({ file, bytes: buf.length, sha256: sha, source: url });
    console.log(`OK  ${file}  ${(buf.length / 1024).toFixed(1)} KiB  sha256:${sha}`);
  }

  // فونت متغیر اختیاری است.
  try {
    const { buf, url } = await download(VARIABLE_FILE);
    await writeFile(path.join(FONT_DIR, VARIABLE_FILE), buf);
    const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    report.push({ file: VARIABLE_FILE, bytes: buf.length, sha256: sha, source: url });
    console.log(`OK  ${VARIABLE_FILE}  ${(buf.length / 1024).toFixed(1)} KiB  sha256:${sha}`);
  } catch {
    console.log(`SKIP ${VARIABLE_FILE} (اختیاری، در دسترس نبود)`);
  }

  // تأیید اینکه فایل‌ها واقعاً روی دیسک نشسته‌اند — نه صرفاً اینکه write خطا نداد.
  const onDisk = (await readdir(FONT_DIR)).filter((f) => f.endsWith('.woff2'));
  const missing = STATIC_FILES.filter((f) => !onDisk.includes(f));
  if (missing.length > 0) {
    throw new Error(`این فایل‌ها روی دیسک یافت نشدند: ${missing.join(', ')}`);
  }

  await writeFile(
    path.join(FONT_DIR, 'MANIFEST.json'),
    `${JSON.stringify({ version: VERSION, license: 'SIL OFL 1.1', files: report }, null, 2)}\n`,
    'utf8',
  );

  console.log(`\nمقصد: ${FONT_DIR}`);
  console.log(`تعداد فایل woff2: ${onDisk.length}`);
}

main().catch((err) => {
  console.error(`\nخطا: ${err.message}`);
  process.exit(1);
});
