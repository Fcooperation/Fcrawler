const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const visited = new Set();
const maxDepth = 2;

async function crawlPage(currentUrl, depth = 0) {
  if (visited.has(currentUrl) || depth > maxDepth) return;
  visited.add(currentUrl);

  console.log(`🔍 Scanning ${currentUrl}`);

  let html;
  try {
    const response = await axios.get(currentUrl, {
      headers: { "User-Agent": "fcrawler-bot/1.0" },
      timeout: 10000,
    });
    html = response.data;
  } catch (err) {
    console.warn(`❌ Failed to fetch ${currentUrl}:`, err.message);
    return;
  }

  // Save page
  const safeFilename = currentUrl.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const savePath = path.join(__dirname, "pages", `${safeFilename}.html`);
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, html);
  console.log(`💾 Saved ${currentUrl} -> ${savePath}`);

  // Load and extract links
  const $ = cheerio.load(html);
  const links = $("a[href]")
    .map((i, el) => $(el).attr("href"))
    .get();

  console.log(`🔗 Extracted ${links.length} links from ${currentUrl}`);

  // Filter and normalize internal links
  const base = new URL(currentUrl);
  const internalLinks = links
    .map(link => {
      try {
        return new URL(link, base).href;
      } catch {
        return null;
      }
    })
    .filter(link => {
      return link && new URL(link).hostname === base.hostname;
    });

  console.log(`🔁 ${internalLinks.length} internal links found`);

  // Recursively crawl
  for (const link of internalLinks) {
    await crawlPage(link, depth + 1);
  }
}

// Start crawling
(async () => {
  const startUrl = "https://archive.org";
  await crawlPage(startUrl);
  console.log("✅ Crawling complete.");
})();
