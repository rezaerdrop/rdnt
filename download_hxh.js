// Hunter x Hunter Ch 410 downloader (Manga Plus by Shueisha)
// Uses Playwright (browser-level auth) + intercepts the manga_viewer_v3 response.
// Run: node download_hxh.js
// Output: C:/Users/rezaf/Downloads/hxh-410/ (jpg pages + hxh-410.pdf)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OUT_DIR = path.join(process.env.USERPROFILE || 'C:/Users/rezaf', 'Downloads', 'hxh-410');

function downloadFile(url, outPath) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outPath);
    const doReq = (u) => lib.get(u, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://mangaplus.shueisha.co.jp/' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return doReq(res.headers.location);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(outPath); } catch (e) {}
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + u));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(outPath); } catch (e) {}
      reject(err);
    });
    doReq(url);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('[1/5] Launching browser, opening Manga Plus title page...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await ctx.newPage();

  // Capture the title_detailV3 response to find chapter 410's chapterId.
  let titleData = null;
  page.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('/title_detailV3') && resp.status() === 200) {
      try { titleData = await resp.json(); } catch (e) {}
    }
  });

  await page.goto('https://mangaplus.shueisha.co.jp/titles/100015', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(2000);

  if (!titleData) {
    await browser.close();
    throw new Error('Did not capture title_detailV3 response. Try with headless: false to debug.');
  }

  // Find chapter 410 ID. chapters is grouped per language, each group has a `chapters` array.
  const allGroups = titleData.chapters || [];
  let chapterId = null;
  for (const group of allGroups) {
    const list = (group && group.chapters) || [];
    for (const ch of list) {
      if (String(ch.chapterNo) === '410') {
        chapterId = ch.id;
        break;
      }
    }
    if (chapterId) break;
  }
  if (!chapterId) {
    fs.writeFileSync(path.join(OUT_DIR, '_title.json'), JSON.stringify(titleData, null, 2));
    await browser.close();
    throw new Error('Chapter 410 ID not found. titleData saved.');
  }
  console.log(`[2/5] Chapter 410 ID = ${chapterId}. Navigating to viewer...`);

  // Now load the viewer page and capture manga_viewer_v3 response.
  let viewerData = null;
  page.removeAllListeners('response');
  page.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('/manga_viewer_v3') && resp.status() === 200) {
      try { viewerData = await resp.json(); } catch (e) {}
    }
  });

  await page.goto(`https://mangaplus.shueisha.co.jp/viewer/${chapterId}`, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(3000);

  if (!viewerData) {
    // Wait a bit more and try once.
    await sleep(3000);
  }

  // If still no viewerData, the chapter might be locked (older than 3). Bail.
  if (!viewerData) {
    fs.writeFileSync(path.join(OUT_DIR, '_viewer_page.html'), await page.content());
    await browser.close();
    throw new Error('Did not capture manga_viewer_v3 response. Ch 410 might be locked.');
  }

  // Extract page URLs.
  const pages = viewerData.pages || [];
  const pageUrls = pages.map((p) => p.imageUrl || p.url || p.image_url).filter(Boolean);
  console.log(`[3/5] Got ${pageUrls.length} pages. Downloading...`);

  // Also grab the title for the PDF cover.
  const chapterName = (viewerData.chapterName || viewerData.title || 'Chapter 410').replace(/[^\w\-\.\(\)\[\] ]/g, '_');
  const titleName = viewerData.titleName || 'Hunter x Hunter';

  for (let i = 0; i < pageUrls.length; i++) {
    const outPath = path.join(OUT_DIR, `page_${String(i + 1).padStart(3, '0')}.jpg`);
    process.stdout.write(`  page ${String(i + 1).padStart(3, '0')}/${pageUrls.length} ... `);
    try {
      await downloadFile(pageUrls[i], outPath);
      const sz = fs.statSync(outPath).size;
      console.log(`OK (${(sz / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.log('FAIL: ' + e.message);
    }
    await sleep(120);
  }

  console.log('[4/5] Assembling PDF via headless browser...');
  // Use the existing browser context to render all images stacked.
  const html = `<!doctype html><html><head><meta charset=utf-8><style>
    body { margin:0; padding:0; background:#000; }
    .cover { color:#fff; text-align:center; padding:40px 20px; font-family:sans-serif; }
    .cover h1 { font-size:32px; margin:10px 0; }
    .cover h2 { font-size:18px; font-weight:normal; color:#ccc; }
    img { display:block; width:100%; height:auto; page-break-after:always; }
  </style></head><body>
    <div class="cover"><h1>${titleName}</h1><h2>${chapterName}</h2></div>
    ${pageUrls.map((_, i) => `<img src="file:///${OUT_DIR.replace(/\\/g, '/')}/page_${String(i + 1).padStart(3, '0')}.jpg" />`).join('\n')}
  </body></html>`;
  const htmlPath = path.join(OUT_DIR, '_viewer.html');
  fs.writeFileSync(htmlPath, html);

  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(2500);
  const pdfPath = path.join(OUT_DIR, 'hxh-410.pdf');
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await browser.close();

  console.log(`[5/5] DONE.`);
  console.log(`Pages: ${OUT_DIR}`);
  console.log(`PDF:   ${pdfPath} (${(fs.statSync(pdfPath).size / (1024 * 1024)).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});