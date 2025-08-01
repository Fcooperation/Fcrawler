const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const robotsParser = require("robots-parser");
const { URL } = require("url");

const CHROMIUM_PATH = "/usr/bin/chromium-browser"; // change if needed
const USER_AGENT = "fcrawler1.0";
const START_URL = "https://example.com"; // your test site

// Get and parse robots.txt
async function checkRobotsPermission(siteUrl, crawlerAgent) {
  try {
    const base = new URL(siteUrl).origin;
    const robotsUrl = `${base}/robots.txt`;
    const res = await axios.get(robotsUrl, { headers: { "User-Agent": crawlerAgent } });

    const robots = robotsParser(robotsUrl, res.data);
    const allowed = robots.isAllowed(siteUrl, crawlerAgent);

    console.log(`🤖 Robots.txt check for ${crawlerAgent}: ${allowed ? "Allowed" : "Disallowed"}`);
    return allowed;
  } catch (err) {
    console.warn("⚠️ robots.txt fetch failed — assuming allowed.");
    return true; // If robots.txt isn't found, proceed
  }
}

// Try Axios + Cheerio first
async function tryAxiosCheerio(url) {
  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });
    const $ = cheerio.load(response.data);
    const title = $("title").text().trim();
    console.log("📄 Axios Success:", title);
    return true;
  } catch (err) {
    console.warn("❌ Axios failed, will try Puppeteer:", err.message);
    return false;
  }
}

// Fallback to Puppeteer
async function tryPuppeteer(url) {
  try {
    const browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const title = await page.title();
    console.log("🤖 Puppeteer Success:", title);
    await browser.close();
    return true;
  } catch (err) {
    console.error("💥 Puppeteer failed:", err.message);
    return false;
  }
}

// MAIN FLOW
(async () => {
  console.log("🚀 Starting crawl:", START_URL);

  const allowed = await checkRobotsPermission(START_URL, USER_AGENT);
  if (!allowed) {
    console.log("⛔️ Access denied by robots.txt — Exiting.");
    return;
  }

  const axiosWorked = await tryAxiosCheerio(START_URL);
  if (!axiosWorked) {
    await tryPuppeteer(START_URL);
  }

  console.log("✅ Finished crawling:", START_URL);
})();
