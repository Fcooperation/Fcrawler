const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const visited = new Set();
const maxDepth = 1;

async function crawlPage(url, depth = 0) {
  if (visited.has(url) || depth > maxDepth) return;
  visited.add(url);

  console.log(`🔍 Scanning ${url}`);

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium", // Adjust if needed
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
  } catch (err) {
    console.warn(`❌ Failed to load ${url}:`, err.message);
    await browser.close();
    return;
  }

  const html = await page.content();

  // Save page
  const safeFilename = url.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const savePath = path.join(__dirname, "pages", `${safeFilename}.html`);
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, html);
  console.log(`💾 Saved ${url} -> ${savePath}`);

  // Extract all internal <a href> links
  const baseURL = new URL(url);
  const links = await page.$$eval("a[href]", (anchors) =>
    anchors.map(a => a.href)
  );

  const internalLinks = links.filter(link => {
    try {
      const target = new URL(link, baseURL);
      return target.hostname === baseURL.hostname;
    } catch {
      return false;
    }
  });

  console.log(`🔗 Found ${links.length} links (${internalLinks.length} internal)`);

  await browser.close();

  // Recurse on internal links
  for (const link of internalLinks) {
    await crawlPage(link, depth + 1);
  }
}

(async () => {
  const startURL = "https://archive.org";
  await crawlPage(startURL);
  console.log("✅ Crawling complete.");
})();
