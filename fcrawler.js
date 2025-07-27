// All required modules
const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// 🔐 Your Supabase credentials (replace these!)
const SUPABASE_URL = "https://pwsxezhugsxosbwhkdvf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3c3hlemh1Z3N4b3Nid2hrZHZmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTkyODM4NywiZXhwIjoyMDY3NTA0Mzg3fQ.u7lU9gAE-hbFprFIDXQlep4q2bhjj0QdlxXF-kylVBQ";
const SUPABASE_BUCKET = "fstorage"; // You must create this bucket in Supabase web UI

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const { URL } = require("url");
const crypto = require("crypto");
const robotsParser = require("robots-parser");

// Configuration
const MAX_RETRIES = 3;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROMIUM_PATH = "/usr/bin/chromium";
const DEFAULT_THROTTLE = 5000;

// State
const outputDir = path.join(__dirname, "output");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const visited = new Set();
const domainRules = {};
const domainLastAccess = {};
const searchIndex = [];
const crawlQueue = [];
const fingerprintsSeen = new Set();
const discoveredSitemaps = [];

const PRIORITY_DOMAINS = [
  "https://example.com",
  "https://another-favorite.com",
  "https://fcooperation-phone-accessories.blogspot.com/?m=1",
];

// Utils
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const hash = (str) => crypto.createHash("md5").update(str).digest("hex").substring(0, 12);

async function uploadToSupabaseStorage(filePath, folderName) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const supabasePath = `${folderName}/${fileName}`; // e.g., example.com/page-abc123.html

  const { error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(supabasePath, fileBuffer, {
      contentType: getMimeType(fileName),
      upsert: true,
    });

  if (error) {
    console.error(`❌ Failed to upload ${fileName}:`, error.message);
  } else {
    console.log(`✅ Uploaded to Supabase: ${supabasePath}`);
  }
}

// Get MIME type from extension
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".html") return "text/html";
  if (ext === ".json") return "application/json";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

// Load and parse robots.txt per domain
async function getRobots(url) {
  const { origin } = new URL(url);
  if (domainRules[origin]) return domainRules[origin];
  try {
    const res = await axios.get(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
    });
    const robots = robotsParser(`${origin}/robots.txt`, res.data);

    // 🧭 Extract sitemaps from robots.txt
    const sitemapUrls = res.data
      .split("\n")
      .filter(line => line.toLowerCase().startsWith("sitemap:"))
      .map(line => line.split(":")[1].trim());
    for (const sm of sitemapUrls) {
      if (!discoveredSitemaps.includes(sm)) discoveredSitemaps.push(sm);
    }

    domainRules[origin] = robots;
    return robots;
  } catch {
    const robots = robotsParser("", "");
    domainRules[origin] = robots;
    return robots;
  }
}

// Delay requests per domain
async function throttleDomain(url) {
  const { hostname } = new URL(url);
  const now = Date.now();
  const last = domainLastAccess[hostname] || 0;
  const delay = DEFAULT_THROTTLE;
  const wait = Math.max(0, delay - (now - last));
  if (wait > 0) await sleep(wait);
  domainLastAccess[hostname] = Date.now();
}

// Axios fetch
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

// Puppeteer rendering with scroll
async function renderPageWithPuppeteer(url) {
  const robots = await getRobots(url);
  if (!robots.isAllowed(url, "*")) {
    console.warn(`🚫 Blocked by robots.txt for '*': ${url}`);
    return null;
  }

  await throttleDomain(url);

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-infobars",
      "--window-size=1920,1080",
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    let prevHeight = 0;
    while (true) {
      const newHeight = await page.evaluate("document.body.scrollHeight");
      if (newHeight === prevHeight) break;
      prevHeight = newHeight;
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await sleep(2000);
    }

    const html = await page.content();
    return html;
  } catch (err) {
    console.warn(`⚠️ Puppeteer rendering failed: ${err.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

// Download files
async function downloadFile(fileUrl, outputPath) {
  try {
    const head = await axios.head(fileUrl);
    const size = parseInt(head.headers["content-length"] || "0");
    if (size && size > MAX_FILE_SIZE) return false;
    const response = await axios({ url: fileUrl, method: "GET", responseType: "arraybuffer" });
    fs.writeFileSync(outputPath, response.data);
    await uploadToSupabaseStorage(filepath, "html");
const domainFolder = new URL(fileUrl).hostname.replace(/^www\./, "");
await uploadToSupabaseStorage(outputPath, domainFolder);
return true;
    return true;
  } catch {
    return false;
  }
}

// Rewrite and save assets
async function rewriteAssets($, baseUrl, pageHash) {
  const assetAttrs = [
    { tag: "img", attr: "src" },
    { tag: "link", attr: "href" },
    { tag: "script", attr: "src" },
    { tag: "source", attr: "src" },
  ];

  for (const { tag, attr } of assetAttrs) {
    await Promise.all(
      $(tag)
        .map(async (_, el) => {
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
        })
        .get()
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

// Main crawler
async function crawl(url, depth = 0) {
  if (visited.has(url) || depth > 2) return;
  visited.add(url);

  const robots = await getRobots(url);
  if (!robots.isAllowed(url, "*")) {
    console.warn(`🚫 Blocked by robots.txt: ${url}`);
    return;
  }

  console.log(`🔍 Crawling: ${url}`);

  let html = await fetchWithAxios(url);
  let usedPuppeteer = false;

  if (!html) {
    console.log("⚙️ Using Puppeteer for rendering...");
    html = await renderPageWithPuppeteer(url);
    usedPuppeteer = true;
  }

  if (!html) return;

  const $ = cheerio.load(html);

  // 🛑 Skip if <meta name="robots" content="noindex">
  const metaRobots = $('meta[name="robots"]').attr("content");
  if (metaRobots && /noindex/i.test(metaRobots)) {
    console.warn(`🛑 Meta robots tag blocks indexing: ${url}`);
    return;
  }

  const title = $("title").text().trim() || "untitled";
  const pageHash = hash(url);
  const filename = `page-${pageHash}.html`;
  const filepath = path.join(outputDir, filename);

  await rewriteAssets($, url, pageHash);
  fs.writeFileSync(filepath, $.html(), "utf8");
  await uploadToSupabaseStorage(filepath, "html");

  // Add current page to search index
const searchItem = {
  url,
  title,
  filename,
  lang,
  canonical,
  content_fingerprint: contentFingerprint,
  js_rendered: usedPuppeteer,
};

searchIndex.push(searchItem); // still store locally

// Insert into Supabase Table immediately
const { error } = await supabase
  .from("searchindex")
  .insert(searchItem);

if (error) {
  console.error(`❌ Failed to insert: ${url}`, error.message);
} else {
  console.log(`📥 Inserted to searchindex: ${url}`);
}

  const cleanText = $("body").text().trim().replace(/\s+/g, " ");
  const contentFingerprint = hash(cleanText);

  // 🧠 Deduplicate based on content hash
  if (fingerprintsSeen.has(contentFingerprint)) {
    console.warn(`⚠️ Duplicate content detected. Skipping: ${url}`);
    return;
  }
  fingerprintsSeen.add(contentFingerprint);

  const lang = $("html").attr("lang") || "unknown";
  const canonical = $('link[rel="canonical"]').attr("href") || url;

  
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

  const links = extractLinks($, url);
  for (const link of links) {
    if (!visited.has(link)) crawlQueue.push({ url: link, depth: depth + 1 });
  }
}

// Save search index
function saveIndex() {
  const indexPath = path.join(outputDir, "search_index.json");
  fs.writeFileSync(indexPath, JSON.stringify(searchIndex, null, 2));
  console.log("✅ Saved search_index.json");

  if (discoveredSitemaps.length > 0) {
    const sitemapPath = path.join(outputDir, "discovered_sitemaps.txt");
    fs.writeFileSync(sitemapPath, discoveredSitemaps.join("\n"));
    console.log("🗺️ Discovered sitemaps saved.");
  }
}

// Entry point
(async () => {
  const startUrl = process.argv[2] || "https://vm.tiktok.com/ZSSdhekg9/";

  for (const url of PRIORITY_DOMAINS) {
    crawlQueue.push({ url, depth: 0 });
  }

  if (!PRIORITY_DOMAINS.includes(startUrl)) {
    crawlQueue.push({ url: startUrl, depth: 0 });
  }

  while (crawlQueue.length > 0) {
    const { url, depth } = crawlQueue.shift();
    await crawl(url, depth);
  }

  saveIndex();


  
  
})();
