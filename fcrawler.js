// fcrawler.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const cheerio = require('cheerio');
const { parseStringPromise } = require('xml2js');

const START_URL = 'https://en.wikipedia.org/wiki/Main_Page';
const DOMAIN = 'https://en.wikipedia.org';
const ROBOTS_TXT = `${DOMAIN}/robots.txt`;
const SITEMAP_INDEX = 'https://en.wikipedia.org/sitemap-index.xml';
const VISITED = new Set();
const ALLOWED_PATHS = [];
const DISALLOWED_PATHS = [];
const searchIndex = [];

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetch(url) {
  try {
    const res = await axios.get(url, { timeout: 10000 });
    return res.data;
  } catch (err) {
    console.error(`[ERROR] Failed to fetch: ${url}`, err.message);
    return null;
  }
}

function isAllowed(pathname) {
  for (const dis of DISALLOWED_PATHS) {
    if (pathname.startsWith(dis)) return false;
  }
  for (const allow of ALLOWED_PATHS) {
    if (pathname.startsWith(allow)) return true;
  }
  return false;
}

async function parseRobotsTxt() {
  const content = await fetch(ROBOTS_TXT);
  if (!content) return;

  const lines = content.split('\n');
  let active = false;
  for (let line of lines) {
    line = line.trim();
    if (line.toLowerCase().startsWith('user-agent:')) {
      active = line.includes('*');
    } else if (active && line.toLowerCase().startsWith('disallow:')) {
      const path = line.split(':')[1].trim();
      if (path) DISALLOWED_PATHS.push(path);
    } else if (active && line.toLowerCase().startsWith('allow:')) {
      const path = line.split(':')[1].trim();
      if (path) ALLOWED_PATHS.push(path);
    }
  }
  console.log('Parsed robots.txt ✅');
}

async function parseSitemaps() {
  const xml = await fetch(SITEMAP_INDEX);
  if (!xml) return [];

  const result = await parseStringPromise(xml);
  const locs = result.sitemapindex.sitemap.map(entry => entry.loc[0]);
  return locs;
}

async function extractUrlsFromSitemap(url) {
  const xml = await fetch(url);
  if (!xml) return [];

  const result = await parseStringPromise(xml);
  const urls = result.urlset.url.map(u => u.loc[0]);
  return urls.filter(u => isAllowed(new URL(u).pathname));
}

async function saveRenderedPage(url) {
  const filename = path.basename(url).replace(/[^\w]/g, '_');
  const htmlFile = `pages/${filename}.html`;
  const screenshotFile = `screenshots/${filename}.png`;

  // Render and save HTML
  try {
    const dump = execSync(`chromium --headless --no-sandbox --disable-gpu --dump-dom ${url}`, { timeout: 10000 }).toString();
    fs.writeFileSync(htmlFile, dump);
  } catch (err) {
    console.error(`[ERROR] Failed to dump HTML for: ${url}`);
    return;
  }

  // Screenshot
  try {
    execSync(`chromium --headless --no-sandbox --disable-gpu --screenshot=${screenshotFile} --window-size=1280,720 ${url}`, { timeout: 10000 });
  } catch (err) {
    console.error(`[ERROR] Failed to screenshot: ${url}`);
  }

  // Extract metadata
  const titleMatch = /<title>(.*?)<\/title>/i.exec(fs.readFileSync(htmlFile, 'utf8'));
  const title = titleMatch ? titleMatch[1] : 'No Title';

  searchIndex.push({
    title,
    url,
    filename: `${filename}.html`,
    screenshot: `${filename}.png`,
    timestamp: new Date().toISOString(),
  });

  console.log(`✅ Saved: ${url}`);
}

async function crawl(url, depth = 0, maxDepth = 2) {
  if (VISITED.has(url) || depth > maxDepth) return;
  VISITED.add(url);

  if (!isAllowed(new URL(url).pathname)) return;

  await saveRenderedPage(url);

  // Parse links
  const html = await fetch(url);
  if (!html) return;

  const $ = cheerio.load(html);
  const links = $('a[href]')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter(href => href.startsWith('/wiki/') && !href.includes(':'))
    .map(href => DOMAIN + href.split('#')[0]);

  for (const link of links) {
    await delay(500); // respectful crawl delay
    await crawl(link, depth + 1, maxDepth);
  }
}

async function main() {
  fs.mkdirSync('pages', { recursive: true });
  fs.mkdirSync('screenshots', { recursive: true });

  await parseRobotsTxt();
  const sitemapUrls = await parseSitemaps();

  const allArticleUrls = [];
  for (const sitemap of sitemapUrls.slice(0, 2)) {
    const urls = await extractUrlsFromSitemap(sitemap);
    allArticleUrls.push(...urls);
  }

  const selectedUrls = allArticleUrls.slice(0, 5); // limit for testing
  selectedUrls.unshift(START_URL);

  for (const url of selectedUrls) {
    await crawl(url);
  }

  fs.writeFileSync('search_index.json', JSON.stringify(searchIndex, null, 2));
  console.log('🔍 Finished crawling & indexing.');
}

main();
