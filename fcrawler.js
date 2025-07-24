const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { URL } = require('url');
const { uploadFile, loginToMega, saveSearchIndex } = require('./megautils'); // helper file you already have

const chromiumPath = '/usr/bin/chromium';
const MAX_RETRIES = 3;
const CRAWLED = new Set();
const searchIndex = [];

async function fetchWithRetries(url, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, { timeout: 10000 });
      return res.data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}

async function downloadAndUploadFile(fileUrl, pageTitle, pageUrl) {
  try {
    const head = await axios.head(fileUrl);
    const size = parseInt(head.headers['content-length'] || '0');
    if (size > 50 * 1024 * 1024) return null; // Skip files >50MB

    const filename = path.basename(new URL(fileUrl).pathname);
    const localPath = path.join(__dirname, 'downloads', filename);

    const res = await axios.get(fileUrl, { responseType: 'stream' });
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    const writer = fs.createWriteStream(localPath);
    res.data.pipe(writer);
    await new Promise(resolve => writer.on('finish', resolve));

    const megaFile = await uploadFile(localPath, filename, pageTitle);
    return { filename, url: pageUrl, title: pageTitle, megaUrl: megaFile.downloadUrl };
  } catch (err) {
    console.error(`Failed to download/upload ${fileUrl}:`, err.message);
    return null;
  }
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

  const screenshotPath = `thumbs/${Date.now()}.png`;
  await fs.promises.mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await browser.close();
  return { html, screenshotPath };
}

async function crawl(url, depth = 0, maxDepth = 2) {
  if (CRAWLED.has(url) || depth > maxDepth || !url.startsWith('http')) return;
  CRAWLED.add(url);

  try {
    console.log(`Crawling: ${url}`);

    const { html, screenshotPath } = await renderPageWithPuppeteer(url);
    const $ = cheerio.load(html);
    const title = $('title').text().trim() || 'Untitled';

    const blocks = [];
    $('p, h1, h2, h3, img').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'img') {
        const src = $(el).attr('src');
        if (src && !src.startsWith('data:')) {
          blocks.push(`<img src="${src}" />`);
        }
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

    const filename = `page_${Date.now()}.html`;
    const htmlPath = path.join('downloads', filename);
    await fs.promises.writeFile(htmlPath, structuredHtml, 'utf8');

    const megaHtml = await uploadFile(htmlPath, filename, title);
    const megaThumb = await uploadFile(screenshotPath, `thumb_${filename}.png`, title);

    searchIndex.push({
      title,
      url,
      filename,
      text: $('body').text().substring(0, 500),
      thumbnail: megaThumb.downloadUrl
    });

    // Handle file links (PDF, ZIP, MP3, etc.)
    const links = $('a[href]').map((_, el) => $(el).attr('href')).get();
    for (const link of links) {
      const absolute = new URL(link, url).href;
      if (absolute.match(/\.(pdf|zip|mp3|docx?)$/i)) {
        const fileMeta = await downloadAndUploadFile(absolute, title, url);
        if (fileMeta) searchIndex.push(fileMeta);
      }
    }

    // Recurse into valid links
    for (const link of links) {
      const absolute = new URL(link, url).href;
      if (absolute.startsWith('http') && !CRAWLED.has(absolute)) {
        await crawl(absolute, depth + 1, maxDepth);
      }
    }

  } catch (err) {
    console.error(`Error crawling ${url}:`, err.message);
  }
}

(async () => {
  await loginToMega(); // logs into MEGA with your credentials
  const startUrl = 'https://archive.org/';
  await crawl(startUrl);

  await saveSearchIndex(searchIndex);
  console.log('✅ Crawl complete. Search index and files uploaded.');
})();
