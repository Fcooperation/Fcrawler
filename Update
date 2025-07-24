const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const path = require("path");
const { URL } = require("url");
const { execSync } = require("child_process");
const crypto = require("crypto");

const MAX_RETRIES = 3;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const searchIndex = [];

const outputDir = path.join(__dirname, "output");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

// Chromium path (already installed on Termux)
const CHROMIUM_PATH = "/usr/bin/chromium";

// Utility: Sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Utility: Hash URL
const hash = (str) =>
  crypto.createHash("md5").update(str).digest("hex").substring(0, 12);

// Utility: Download file
async function downloadFile(fileUrl, outputPath) {
  const head = await axios.head(fileUrl).catch(() => null);
  const size = head?.headers?.["content-length"]
    ? parseInt(head.headers["content-length"])
    : 0;
  if (size && size > MAX_FILE_SIZE) return false;

  const response = await axios({ url: fileUrl, method: "GET", responseType: "stream" });
  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);

  return new Promise((resolve) => {
    writer.on("finish", () => resolve(true));
    writer.on("error", () => resolve(false));
  });
}

// Utility: Render full page using puppeteer
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

// Extract all internal and external links
function extractLinks($, baseUrl) {
  const links = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    try {
      const fullUrl = new URL(href, baseUrl).href;
      if (fullUrl.startsWith("http")) links.add(fullUrl);
    } catch {}
  });
  return Array.from(links);
}

// Main crawl logic
async function crawl(url, visited = new Set(), depth = 0) {
  if (visited.has(url) || depth > 2) return;
  visited.add(url);

  let html = "";
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`Rendering: ${url}`);
      html = await renderPageWithPuppeteer(url);
      break;
    } catch (err) {
      console.error(`Retry ${attempt + 1} failed for ${url}`);
      await sleep(2000);
    }
  }

  if (!html) return;
  const $ = cheerio.load(html);
  const title = $("title").text() || "untitled";

  // Save full HTML
  const filename = `page-${hash(url)}.html`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, html, "utf-8");

  // Extract files: .pdf, .zip, .mp3, .docx
  $("a[href]").each(async (_, el) => {
    const link = $(el).attr("href");
    if (!link) return;
    const ext = path.extname(link).toLowerCase();
    if ([".pdf", ".zip", ".mp3", ".docx"].includes(ext)) {
      const absUrl = new URL(link, url).href;
      const outPath = path.join(outputDir, path.basename(absUrl));
      const success = await downloadFile(absUrl, outPath);
      if (success) console.log(`Downloaded: ${absUrl}`);
    }
  });

  // Index for search
  searchIndex.push({ title, url, filename, text: $("body").text() });

  // Crawl deeper
  const links = extractLinks($, url);
  for (const link of links) await crawl(link, visited, depth + 1);
}

// Save index after crawling
function saveIndex() {
  const indexPath = path.join(outputDir, "search_index.json");
  fs.writeFileSync(indexPath, JSON.stringify(searchIndex, null, 2));
  console.log("Saved search_index.json");
}

// Start crawling
(async () => {
  const startUrl = "https://archive.org/"; // You can change this
  await crawl(startUrl);
  saveIndex();
})();
