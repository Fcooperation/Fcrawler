// fcrawler1.0 crawler with robots.txt check, axios+cheerio fallback, puppeteer-core render

const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const chromium = require("chrome-aws-lambda"); // or path to Chromium
const urlLib = require("url");

// The site to crawl
const targetUrl = "https://example.com";

// User agent
const USER_AGENT = "fcrawler1.0";

// === Function to parse robots.txt ===
async function isBlockedByRobots(url, userAgent = USER_AGENT) {
  try {
    const { hostname, protocol } = new URL(url);
    const robotsUrl = `${protocol}//${hostname}/robots.txt`;

    const res = await axios.get(robotsUrl, { timeout: 5000 });
    const lines = res.data.split("\n");

    let allowed = true;
    let currentUserAgent = null;

    for (let line of lines) {
      line = line.trim();
      if (line.toLowerCase().startsWith("user-agent:")) {
        currentUserAgent = line.split(":")[1].trim().toLowerCase();
      } else if (line.toLowerCase().startsWith("disallow:")) {
        const path = line.split(":")[1].trim();
        if (
          (currentUserAgent === "*" || currentUserAgent === userAgent.toLowerCase()) &&
          urlLib.parse(url).pathname.startsWith(path)
        ) {
          allowed = false;
        }
      }
    }

    return !allowed; // true = blocked
  } catch (err) {
    return false; // No robots.txt or failed to fetch — assume allowed
  }
}

// === Try crawling with axios + cheerio ===
async function crawlWithAxios(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });

    const $ = cheerio.load(res.data);
    const title = $("title").text().trim();
    console.log("✅ Axios success:", title || "no title");
    return res.data;
  } catch (err) {
    console.warn("⚠️ Axios failed:", err.message);
    return null;
  }
}

// === Fallback: Puppeteer render ===
async function crawlWithPuppeteer(url) {
  try {
    const browser = await puppeteer.launch({
      executablePath: await chromium.executablePath,
      headless: true,
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });

    const html = await page.content();
    const title = await page.title();
    console.log("✅ Puppeteer success:", title || "no title");

    await browser.close();
    return html;
  } catch (err) {
    console.error("❌ Puppeteer failed:", err.message);
    return null;
  }
}

// === Main crawl logic ===
(async () => {
  const blocked = await isBlockedByRobots(targetUrl);
  if (blocked) {
    console.log("❌ Blocked by robots.txt for fcrawler1.0");
    return;
  }

  let html = await crawlWithAxios(targetUrl);
  if (!html || html.length < 100) {
    html = await crawlWithPuppeteer(targetUrl);
  }

  if (html) {
    console.log("✅ Final result: Got HTML of length", html.length);
  } else {
    console.log("❌ Could not get page content");
  }
})();
