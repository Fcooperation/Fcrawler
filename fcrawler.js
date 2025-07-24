const axios = require('axios');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { parse } = require('node-html-parser');
const robotsParser = require('robots-parser');
const { URL } = require('url');

const START_URL = 'https://vm.tiktok.com/ZSSdhekg9/';
const OUTPUT_DIR = './output';
const SEARCH_INDEX_PATH = path.join(OUTPUT_DIR, 'search_index.json');

const visited = new Set();
const searchIndex = [];

async function isAllowedByRobots(url) {
  try {
    const { origin } = new URL(url);
    const robotsTxtUrl = `${origin}/robots.txt`;
    const res = await axios.get(robotsTxtUrl);
    const robots = robotsParser(robotsTxtUrl, res.data);
    return robots.isAllowed(url, 'Mozilla/5.0');
  } catch {
    return true; // Default to allow if robots.txt fails
  }
}

async function scrollToBottom(page, delay = 1000, maxScrolls = 10) {
  let previousHeight;
  for (let i = 0; i < maxScrolls; i++) {
    try {
      previousHeight = await page.evaluate('document.body.scrollHeight');
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await page.waitForTimeout(delay);
      const newHeight = await page.evaluate('document.body.scrollHeight');
      if (newHeight === previousHeight) break;
    } catch (e) {
      break;
    }
  }
}

async function renderPage(url) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/117 Safari/537.36');

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await scrollToBottom(page);
    const content = await page.content();
    const title = await page.title();
    await browser.close();
    return { content, title };
  } catch (e) {
    await browser.close();
    return null;
  }
}

async function saveHTML(url, html) {
  const safeName = url.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 80);
  const filename = `${safeName}.html`;
  const filePath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, html);
  return filename;
}

async function crawl(url) {
  if (visited.has(url)) return;
  visited.add(url);

  console.log(`🔍 Crawling: ${url}`);

  const allowed = await isAllowedByRobots(url);
  if (!allowed) {
    console.log(`❌ Blocked by robots.txt: ${url}`);
    return;
  }

  const rendered = await renderPage(url);
  if (!rendered) {
    console.log(`❌ Failed to render: ${url}`);
    return;
  }

  const { content, title } = rendered;

  const root = parse(content);
  const text = root.text.trim().replace(/\s+/g, ' ').slice(0, 500);

  const filename = await saveHTML(url, content);

  searchIndex.push({ url, title, filename, text });

  console.log(`✅ Saved: ${filename}`);
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  await crawl(START_URL);

  fs.writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(searchIndex, null, 2));
  console.log(`✅ Saved search_index.json`);
}

main();
