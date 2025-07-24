const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");
const robotsParser = require("robots-parser");

const MAX_RETRIES = 3;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROMIUM_PATH = "/usr/bin/chromium"; // Adjust as needed
const DEFAULT_THROTTLE = 5000; // 5 seconds between requests

const outputDir = path.join(__dirname, "output");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const visited = new Set();
const domainRules = {};
const domainLastAccess = {};

const searchIndex = [];

// Sleep
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Hash
const hash = (str) => crypto.createHash("md5").update(str).digest("hex").substring(0, 12);

// Load and parse robots.txt
async function getRobots(url) {
  const { origin } = new URL(url);
  if (domainRules[origin]) return domainRules[origin];

  try {
    const res = await axios.get(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT } });
    const robots = robotsParser(`${origin}/robots.txt`, res.data);
    domainRules[origin] = robots;
    return robots;
  } catch {
    // If fetch fails, allow everything by default
    const robots = robotsParser("", "");
    domainRules[origin] = robots;
    return robots;
  }
}

// Throttle per domain
async function throttleDomain(url) {
  const { hostname } = new URL(url);
  const now = Date.now();
  const last = domainLastAccess[hostname] || 0;
  const delay = DEFAULT_THROTTLE;
  const wait = Math.max(0, delay - (now - last));
  if (wait > 0) await sleep(wait);
  domainLastAccess[hostname] = Date.now();
}

// Axios
async function fetchWithAxios(url) {
  await throttleDomain(url);

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

// Puppeteer
async function renderPageWithPuppeteer(url) {
  const robots = await getRobots(url);
  if (!robots.isAllowed(url, "Googlebot")) {
    console.warn(`🚫 Blocked by robots.txt for Googlebot (Puppeteer skipped): ${url}`);
    return null;
  }

  await throttleDomain(url);

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

// Download File
async function downloadFile(fileUrl, outputPath) {
  try {
    const head = await axios.head(fileUrl);
    const size = parseInt(head.headers["content-length"] || "0");
    if (size && size > MAX_FILE_SIZE) return false;

    const response = await axios({ url: fileUrl, method: "GET", responseType: "arraybuffer" });
    fs.writeFileSync(outputPath, response.data);
    return true;
  } catch {
    return false;
  }
}

// Rewrite assets
async function rewriteAssets($, baseUrl, pageHash) {
  const assetAttrs = [
    { tag: "img", attr: "src" },
    { tag: "link", attr: "href" },
    { tag: "script", attr: "src" },
    { tag: "source", attr: "src" },
  ];

  for (const { tag, attr } of assetAttrs) {
    await Promise.all(
      $(tag).map(async (_, el) => {
        const src = $(el).attr(attr);
        if (!src || src.startsWith("data:")) return;

        try {
          const assetUrl = new URL(src, baseUrl).href;
          const ext = path.extname(assetUrl).split("?")[0] || ".bin";
          const hashedName = `${pageHash}-${hash(assetUrl)}${ext}`;
          const assetPath = path.join(outputDir, hashedName);

          if (!fs.existsSync(assetPath)) {
            const res = await axios.get(assetUrl, {
              responseType: "arraybuffer",
              headers: { "User-Agent": USER_AGENT },
            });
            fs.writeFileSync(assetPath, res.data);
          }

          $(el).attr(attr, hashedName);
        } catch {}
      }).get()
    );
  }
}

// Extract links
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

// Crawl page
async function crawl(url, depth = 0) {
  if (visited.has(url) || depth > 2) return;
  visited.add(url);

  const robots = await getRobots(url);
  if (!robots.isAllowed(url, "Googlebot")) {
    console.warn(`🚫 Blocked by robots.txt: ${url}`);
    return;
  }

  console.log(`🔍 Crawling: ${url}`);

  let html = await fetchWithAxios(url);
  let usedPuppeteer = false;

  if (!html) {
    console.log("⚙️ Using Puppeteer for rendering...");
    try {
      html = await renderPageWithPuppeteer(url);
      usedPuppeteer = true;
    } catch (err) {
      console.error(`❌ Puppeteer failed for ${url}: ${err.message}`);
      return;
    }
  }

  if (!html) return;

  const $ = cheerio.load(html);
  const title = $("title").text().trim() || "untitled";
  const pageHash = hash(url);
  const filename = `page-${pageHash}.html`;
  const filepath = path.join(outputDir, filename);

  await rewriteAssets($, url, pageHash);

  // Save rebuilt page
  fs.writeFileSync(filepath, $.html(), "utf8");

  // Fingerprint content
  const cleanText = $("body").text().trim().replace(/\s+/g, " ");
  const contentFingerprint = hash(cleanText);

  // Save index
  searchIndex.push({
    title,
    url,
    filename,
    js_rendered: usedPuppeteer,
    text: cleanText.slice(0, 500),
    content_fingerprint: contentFingerprint,
  });

  // Download linked files
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

  // Crawl next
  const links = extractLinks($, url);
  for (const link of links) {
    await crawl(link, depth + 1);
  }
}

// Save index
function saveIndex() {
  const indexPath = path.join(outputDir, "search_index.json");
  fs.writeFileSync(indexPath, JSON.stringify(searchIndex, null, 2));
  console.log("✅ Saved search_index.json");
}

// Start
(async () => {
  const startUrl = process.argv[2] || "https://vm.tiktok.com/ZSSdhekg9/";
  await crawl(startUrl);
  saveIndex();
})();
