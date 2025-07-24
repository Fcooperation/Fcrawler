const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { URL } = require('url');

const chromiumPath = '/usr/bin/chromium'; // adjust if different
const MAX_RETRIES = 3;
const CRAWLED = new Set();
const OUTPUT_DIR = './output';
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function fetchWithAxios(url, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
        timeout: 10000
      });
      return res.data;
    } catch (err) {
      console.warn(`⚠️ Axios failed (${i + 1}/${retries}):`, err.message);
      await new Promise(res => setTimeout(res, 1000));
    }
  }
  return null;
}

async function renderPageWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const html = await page.content();
  const screenshotPath = `${OUTPUT_DIR}/screenshot_${Date.now()}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await browser.close();
  return { html, screenshotPath };
}

async function crawl(url, depth = 0, maxDepth = 2) {
  if (CRAWLED.has(url) || depth > maxDepth || !url.startsWith('http')) return;
  CRAWLED.add(url);
  console.log(`🔍 Crawling: ${url}`);

  let html = await fetchWithAxios(url);
  let usedAxios = true;

  if (!html || html.length < 100 || /enable javascript/i.test(html)) {
    console.log('⚠️ Falling back to Puppeteer...');
    const puppeteerResult = await renderPageWithPuppeteer(url);
    html = puppeteerResult.html;
  }

  const $ = cheerio.load(html);
  const title = $('title').text().trim() || 'Untitled';

  const blocks = [];
  $('p, h1, h2, h3, img').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const src = $(el).attr('src');
      if (src && !src.startsWith('data:')) blocks.push(`<img src="${src}" />`);
    } else {
      blocks.push(`<${tag}>${$(el).text()}</${tag}>`);
    }
  });

  const structuredHtml = `
    <html>
      <head><title>${title}</title></head>
      <body>${blocks.join('\n')}</body>
    </html>
  `.trim();

  const filename = `${OUTPUT_DIR}/page_${Date.now()}.html`;
  fs.writeFileSync(filename, structuredHtml, 'utf8');
  console.log(`✅ Saved structured HTML: ${filename}`);

  const links = $('a[href]').map((_, el) => $(el).attr('href')).get();
  for (const link of links) {
    const absolute = new URL(link, url).href;
    if (absolute.startsWith('http') && !CRAWLED.has(absolute)) {
      await crawl(absolute, depth + 1, maxDepth);
    }
  }
}

(async () => {
  const startUrl = process.argv[2] || 'https://example.com';
  await crawl(startUrl);
  console.log('✅ Crawl complete.');
})();
