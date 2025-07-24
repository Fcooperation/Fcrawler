const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const xml2js = require('xml2js');
const robotsParser = require('robots-parser');
const path = require('path');

const START_URL = 'https://en.wikipedia.org/wiki/Main_Page';
const BASE_DOMAIN = 'https://en.wikipedia.org';
const MAX_PAGES = 50;

const visited = new Set();
const searchIndex = [];
let robots;

async function fetchRobotsTxt() {
  const robotsTxtUrl = `${BASE_DOMAIN}/robots.txt`;
  try {
    const res = await axios.get(robotsTxtUrl);
    robots = robotsParser(robotsTxtUrl, res.data);
    console.log('[✓] robots.txt loaded and parsed');
  } catch (err) {
    console.warn('[!] Failed to load robots.txt:', err.message);
    robots = robotsParser(robotsTxtUrl, '');
  }
}

async function fetchSitemaps() {
  const sitemapUrl = 'https://en.wikipedia.org/sitemap-index.xml';
  try {
    const res = await axios.get(sitemapUrl);
    const parsed = await xml2js.parseStringPromise(res.data);
    const sitemaps = parsed.sitemapindex.sitemap.map(s => s.loc[0]);
    return sitemaps.slice(0, 5); // limit for now
  } catch (err) {
    console.warn('[!] Failed to load sitemaps:', err.message);
    return [];
  }
}

function sanitizeFilename(url) {
  return url.replace(/[^a-z0-9]/gi, '_').slice(0, 80);
}

async function crawlPage(url, browser) {
  if (visited.has(url) || !url.startsWith(BASE_DOMAIN)) return;
  if (!robots.isAllowed(url, '*')) return;

  visited.add(url);
  console.log(`[→] Crawling: ${url}`);

  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const title = await page.title();
    const html = await page.content();
    const timestamp = new Date().toISOString();
    const filename = sanitizeFilename(url);
    const htmlPath = path.join('pages', `${filename}.html`);
    const imgPath = path.join('screenshots', `${filename}.png`);

    // Save HTML
    await fs.outputFile(htmlPath, html);

    // Save screenshot
    await page.setViewport({ width: 1280, height: 720 });
    await page.screenshot({ path: imgPath });

    // Add to index
    searchIndex.push({ title, url, filename: `${filename}.html`, screenshot: `${filename}.png`, timestamp });

    // Parse links
    const $ = cheerio.load(html);
    const links = $('a[href]').map((i, el) => $(el).attr('href')).get();

    for (const href of links) {
      if (visited.size >= MAX_PAGES) break;
      let fullUrl = href;
      if (href && href.startsWith('/wiki/') && !href.includes(':')) {
        fullUrl = BASE_DOMAIN + href;
        await crawlPage(fullUrl, browser);
      }
    }
  } catch (err) {
    console.warn(`[x] Error on ${url}:`, err.message);
  } finally {
    await page.close();
  }
}

(async () => {
  await fs.ensureDir('pages');
  await fs.ensureDir('screenshots');
  await fetchRobotsTxt();

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const sitemapUrls = await fetchSitemaps();

  for (const sitemapUrl of sitemapUrls) {
    if (visited.size >= MAX_PAGES) break;
    try {
      const res = await axios.get(sitemapUrl);
      const parsed = await xml2js.parseStringPromise(res.data);
      const urls = parsed.urlset.url.map(u => u.loc[0]);
      for (const url of urls.slice(0, 10)) {
        if (visited.size >= MAX_PAGES) break;
        await crawlPage(url, browser);
      }
    } catch (err) {
      console.warn(`[!] Failed to parse sitemap: ${sitemapUrl}`);
    }
  }

  // Also crawl from root manually
  if (visited.size < MAX_PAGES) {
    await crawlPage(START_URL, browser);
  }

  await browser.close();
  await fs.writeJson('search_index.json', searchIndex, { spaces: 2 });

  console.log(`\n✅ Done. Total pages crawled: ${visited.size}`);
})(
