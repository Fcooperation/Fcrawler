const puppeteer = require("puppeteer-core");
const cheerio = require("cheerio");
const axios = require("axios");
const { URL } = require("url");
const path = require("path");

const CHROMIUM_PATH = "/usr/bin/chromium-browser"; // Change to your chromium path if different
const TARGET_URL = "https://example.com"; // 🧠 Change to target

// Check if the site is JavaScript-heavy
async function isJavaScriptSite(url) {
  try {
    const browser = await puppeteer.launch({ executablePath: CHROMIUM_PATH, headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    const content = await page.content();
    const text = await page.evaluate(() => document.body.innerText.trim().length);
    await browser.close();

    const staticText = (await axios.get(url)).data.replace(/<[^>]*>/g, "").length;

    const diff = Math.abs(text - staticText);
    return diff > 100; // Heuristic threshold
  } catch (err) {
    console.error("⚠️ JS check failed. Assuming HTML site.");
    return false;
  }
}

// Extract internal links from homepage
async function getInternalLinks(url) {
  const base = new URL(url).origin;
  const html = (await axios.get(url)).data;
  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href]").each((_, el) => {
    let link = $(el).attr("href");
    if (!link) return;

    if (link.startsWith("/")) {
      link = base + link;
    } else if (!link.startsWith("http")) {
      link = base + "/" + link;
    }

    if (link.startsWith(base)) {
      links.add(link.split("#")[0]);
    }
  });

  return [...links];
}

// Crawl using Axios + Cheerio
async function crawlWithAxios(url) {
  try {
    const html = (await axios.get(url)).data;
    const $ = cheerio.load(html);
    const title = $("title").text().trim();
    console.log("📄 Axios:", title, "—", url);
  } catch (err) {
    console.error("❌ Axios error:", url, err.message);
  }
}

// Crawl using Puppeteer
async function crawlWithPuppeteer(url) {
  try {
    const browser = await puppeteer.launch({ executablePath: CHROMIUM_PATH, headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const title = await page.title();
    console.log("🤖 Puppeteer:", title, "—", url);
    await browser.close();
  } catch (err) {
    console.error("❌ Puppeteer error:", url, err.message);
  }
}

// MAIN
(async () => {
  console.log("🔍 Scanning", TARGET_URL);

  const isJS = await isJavaScriptSite(TARGET_URL);
  console.log("🧠 Site type:", isJS ? "JavaScript-heavy" : "Static HTML");

  const links = await getInternalLinks(TARGET_URL);
  console.log("🔗 Found", links.length, "internal pages to crawl");

  const tasks = links.map(url => isJS ? crawlWithPuppeteer(url) : crawlWithAxios(url));
  await Promise.allSettled(tasks);

  console.log("✅ Crawling complete.");
})();
