const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");

const MAX_RETRIES = 3;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROMIUM_PATH = "/usr/bin/chromium"; // Headless Chromium path

const outputDir = path.join(__dirname, "output");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const searchIndex = [];

// Sleep helper
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Hash for filename uniqueness
const hash = (str) => crypto.createHash("md5").update(str).digest("hex").substring(0, 12);

// Try Axios fetch
async function fetchWithAxios(url) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await axios.get(url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 10000,
      });
      const html = response.data;
      if (/enable javascript/i.test(html) || html.length < 100) {
        console.warn("❌ Page likely needs JavaScript. Falling back to Puppeteer.");
        return null;
      }
      return html;
    } catch (err) {
      console.warn(`⚠️ Axios retry ${i + 1} failed for ${url}: ${err.message}`);
      await sleep(1000);
    }
  }
  return null;
}

// Puppeteer renderer
async function renderPageWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  const html = await page.content();
  await browser.close();
  return html;
}

// Download files (.pdf, .zip, etc.)
async function downloadFile(fileUrl, outputPath) {
  try {
    const head = await axios.head(fileUrl);
    const size = parseInt(head.headers["content-length"] || "0");
    if (size && size > MAX_FILE_SIZE) return false;

    const response = await axios({ url: fileUrl, method: "GET", responseType: "stream" });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    return new Promise((res) => {
      writer.on("finish", () => res(true));
      writer.on("error", () => res(false));
    });
  } catch {
    return false;
  }
}

// Extract all links from page
function extractLinks($, baseUrl) {
  const links = new Set();
  $("a[href]").each((_, el) => {
    try {
      const href = $(el).attr("href");
      const abs = new URL(href, baseUrl).href;
      if (abs.startsWith("http")) links.add(abs);
    } catch {}
  });
  return Array.from(links);
}

// Main crawler
async function crawl(url, visited = new Set(), depth = 0) {
  if (visited.has(url) || depth > 2) return;
  visited.add(url);

  console.log(`🔍 Crawling: ${url}`);

  let html = await fetchWithAxios(url);

  if (!html) {
    console.log("⚙️ Using Puppeteer for rendering...");
    try {
      html = await renderPageWithPuppeteer(url);
    } catch (err) {
      console.error(`❌ Puppeteer failed for ${url}: ${err.message}`);
      return;
    }
  }

  const $ = cheerio.load(html);
  const title = $("title").text().trim() || "untitled";
  const filename = `page-${hash(url)}.html`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, html, "utf8");

  // Download important files
  $("a[href]").each(async (_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const ext = path.extname(href).toLowerCase();
    if ([".pdf", ".zip", ".mp3", ".docx"].includes(ext)) {
      const absUrl = new URL(href, url).href;
      const outPath = path.join(outputDir, path.basename(absUrl));
      const success = await downloadFile(absUrl, outPath);
      if (success) console.log(`⬇️ Downloaded: ${absUrl}`);
    }
  });

  // Save search index
  searchIndex.push({
    title,
    url,
    filename,
    text: $("body").text().trim().replace(/\s+/g, " ").slice(0, 500),
  });

  // Crawl deeper
  const links = extractLinks($, url);
  for (const link of links) {
    await crawl(link, visited, depth + 1);
  }
}

// Save index
function saveIndex() {
  const indexPath = path.join(outputDir, "search_index.json");
  fs.writeFileSync(indexPath, JSON.stringify(searchIndex, null, 2));
  console.log("✅ Saved search_index.json");
}

// Run
(async () => {
  const startUrl = process.argv[2] || "https://archive.org/";
  await crawl(startUrl);
  saveIndex();
})();
