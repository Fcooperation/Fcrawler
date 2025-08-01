// 🧠 Required modules
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// 🌐 Start URL
const startUrl = "https://archive.org";

// 📁 Folder to save pages
const saveDir = path.join(__dirname, "pages");
if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);

// 📦 Extract domain
function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// 📤 Save page content
function savePage(url, html) {
  const filename = path.join(
    saveDir,
    url.replace(/[^a-zA-Z0-9]/g, "_") + ".html"
  );
  fs.writeFileSync(filename, html);
  console.log(`💾 Saved ${url} -> ${filename}`);
}

// 🔗 Extract internal links
function extractLinks(html, currentUrl, baseDomain) {
  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href]").each((_, elem) => {
    let href = $(elem).attr("href").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

    try {
      const absUrl = new URL(href, currentUrl);
      if (absUrl.hostname.endsWith(baseDomain)) {
        links.add(absUrl.href.split("#")[0]);
      }
    } catch (e) {}
  });

  return [...links];
}

// 🚀 Crawl function
async function crawl(url, visited = new Set()) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  console.log(`🔍 Scanning ${url}`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const html = await page.content();

    savePage(url, html);
    const baseDomain = getDomain(url);
    const links = extractLinks(html, url, baseDomain);

    console.log(`🔗 Found ${links.length} internal links`);
    visited.add(url);

    for (const link of links) {
      if (!visited.has(link)) {
        await crawl(link, visited);
      }
    }
  } catch (err) {
    console.error(`❌ Failed to crawl ${url}:`, err.message);
  } finally {
    await browser.close();
  }
}

// 🎬 Start crawling
crawl(startUrl).then(() => {
  console.log("✅ Crawling complete.");
});
