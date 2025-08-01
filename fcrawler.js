const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const chromium = require("chromium");
const robotsParser = require("robots-parser");
const { URL } = require("url");

// SETTINGS
const USER_AGENT = "fcrawler1.0";
const START_URLS = [
  "https://espn.com",
  "https://wikipedia.org",
  "https://example.com",
  "https://bbc.com",
];

// Get and parse robots.txt
async function checkRobotsPermission(siteUrl, crawlerAgent) {
  try {
    const base = new URL(siteUrl).origin;
    const robotsUrl = `${base}/robots.txt`;
    const res = await axios.get(robotsUrl, { headers: { "User-Agent": crawlerAgent } });

    const robots = robotsParser(robotsUrl, res.data);
    const allowed = robots.isAllowed(siteUrl, crawlerAgent);

    console.log(`🤖 Robots.txt check for ${crawlerAgent} @ ${siteUrl}: ${allowed ? "Allowed" : "Disallowed"}`);
    return allowed;
  } catch (err) {
    console.warn(`⚠️ robots.txt fetch failed for ${siteUrl} — assuming allowed.`);
    return true;
  }
}

// Try Axios + Cheerio
async function tryAxiosCheerio(url) {
  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });
    const $ = cheerio.load(response.data);
    const title = $("title").text().trim();
    console.log(`📄 Axios Success: [${url}] - "${title}"`);
    return true;
  } catch (err) {
    console.warn(`❌ Axios failed @ ${url}, will try Puppeteer: ${err.message}`);
    return false;
  }
}

// Fallback to Puppeteer with Chromium
async function tryPuppeteer(url) {
  try {
    const browser = await puppeteer.launch({
      executablePath: chromium.path,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const title = await page.title();
    console.log(`🤖 Puppeteer Success: [${url}] - "${title}"`);
    await browser.close();
    return true;
  } catch (err) {
    console.error(`💥 Puppeteer failed @ ${url}: ${err.message}`);
    return false;
  }
}

// Crawl a single URL (scan + analyze)
async function crawlUrl(url) {
  console.log(`🚀 Starting crawl: ${url}`);
  const allowed = await checkRobotsPermission(url, USER_AGENT);
  if (!allowed) {
    console.log(`⛔️ Access denied by robots.txt — Skipping ${url}`);
    return;
  }

  const axiosWorked = await tryAxiosCheerio(url);
  if (!axiosWorked) {
    await tryPuppeteer(url);
  }

  console.log(`✅ Finished crawling: ${url}\n`);
}

// Main: Launch all crawls in parallel
(async () => {
  await Promise.all(START_URLS.map(crawlUrl));
})();
