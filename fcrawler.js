// All required modules  
const fs = require("fs");  
const axios = require("axios");  
const cheerio = require("cheerio");  
const puppeteer = require("puppeteer-core");  
const path = require("path");  
const { URL } = require("url");  
const crypto = require("crypto");  
const robotsParser = require("robots-parser");  
const { createClient } = require("@supabase/supabase-js"); // added Supabase client  
  
// Configuration  
const MAX_RETRIES = 3;  
const MAX_FILE_SIZE = 25 * 1024 * 1024;  
const USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";  
const CHROMIUM_PATH = "/usr/bin/chromium";  
const DEFAULT_THROTTLE = 5000;  
  
const SUPABASE_URL = "https://your-project-id.supabase.co";  
const SUPABASE_KEY = "your-service-role-key";  
const SUPABASE_BUCKET = "fweb";  
const SUPABASE_TABLE = "search-index";  
  
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);  
  
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
];  
  
// Utils  
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));  
const hash = (str) => crypto.createHash("md5").update(str).digest("hex").substring(0, 12);  
  
// Load and parse robots.txt per domain  
async function getRobots(url) {  
  const { origin } = new URL(url);  
  if (domainRules[origin]) return domainRules[origin];  
  try {  
    const res = await axios.get(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT } });  
    const robots = robotsParser(`${origin}/robots.txt`, res.data);  
  
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
  
async function throttleDomain(url) {  
  const { hostname } = new URL(url);  
  const now = Date.now();  
  const last = domainLastAccess[hostname] || 0;  
  const delay = DEFAULT_THROTTLE;  
  const wait = Math.max(0, delay - (now - last));  
  if (wait > 0) await sleep(wait);  
  domainLastAccess[hostname] = Date.now();  
}  
  
async function fetchWithAxios(url) {  
  await throttleDomain(url);  
  for (let i = 0; i < MAX_RETRIES; i++) {  
    try {  
      const response = await axios.get(url, {  
        headers: { "User-Agent": USER_AGENT },  
        timeout: 10000,  
      });  
      const html = response.data;  
      if (/enable javascript/i.test(html) || html.length < 100) return null;  
      return html;  
    } catch (err) {  
      await sleep(1000);  
    }  
  }  
  return null;  
}  
  
async function renderPageWithPuppeteer(url) {  
  const robots = await getRobots(url);  
  if (!robots.isAllowed(url, "*")) return null;  
  await throttleDomain(url);  
  
  const browser = await puppeteer.launch({  
    executablePath: CHROMIUM_PATH,  
    headless: "new",  
    args: ["--no-sandbox", "--disable-setuid-sandbox"],  
    defaultViewport: null,  
  });  
  
  const page = await browser.newPage();  
  await page.setUserAgent(USER_AGENT);  
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
  } catch {  
    return null;  
  } finally {  
    await browser.close();  
  }  
}  
  
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
            const res = await axios.get(assetUrl, { responseType: "arraybuffer" });  
            fs.writeFileSync(assetPath, res.data);  
          }  
          $(el).attr(attr, hashedName);  
        } catch {}  
      }).get()  
    );  
  }  
}  
  
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
  
async function crawl(url, depth = 0) {  
  if (visited.has(url) || depth > 2) return;  
  visited.add(url);  
  
  const robots = await getRobots(url);  
  if (!robots.isAllowed(url, "*")) return;  
  
  let html = await fetchWithAxios(url);  
  let usedPuppeteer = false;  
  if (!html) {  
    html = await renderPageWithPuppeteer(url);  
    usedPuppeteer = true;  
  }  
  if (!html) return;  
  
  const $ = cheerio.load(html);  
  const metaRobots = $('meta[name="robots"]').attr("content");  
  if (metaRobots && /noindex/i.test(metaRobots)) return;  
  
  const title = $("title").text().trim() || "untitled";  
  const pageHash = hash(url);  
  const filename = `page-${pageHash}.html`;  
  const filepath = path.join(outputDir, filename);  
  await rewriteAssets($, url, pageHash);  
  fs.writeFileSync(filepath, $.html(), "utf8");  
  
  const cleanText = $("body").text().trim().replace(/\s+/g, " ");  
  const contentFingerprint = hash(cleanText);  
  if (fingerprintsSeen.has(contentFingerprint)) return;  
  fingerprintsSeen.add(contentFingerprint);  
  
  const lang = $("html").attr("lang") || "unknown";  
  const canonical = $('link[rel="canonical"]').attr("href") || url;  
  
  searchIndex.push({  
    title,  
    url,  
    canonical,  
    filename,  
    js_rendered: usedPuppeteer,  
    language: lang,  
    text: cleanText.slice(0, 500),  
    content_fingerprint: contentFingerprint,  
  });  
  
  $("a[href]").each(async (_, el) => {  
    const href = $(el).attr("href");  
    const ext = path.extname(href).toLowerCase();  
    if ([".pdf", ".zip", ".mp3", ".docx"].includes(ext)) {  
      const absUrl = new URL(href, url).href;  
      const outPath = path.join(outputDir, path.basename(absUrl));  
      await downloadFile(absUrl, outPath);  
    }  
  });  
  
  const links = extractLinks($, url);  
  for (const link of links) {  
    if (!visited.has(link)) crawlQueue.push({ url: link, depth: depth + 1 });  
  }  
}  
  
// 🔽 Save + Supabase upload  
async function saveIndex() {  
  const indexPath = path.join(outputDir, "search_index.json");  
  fs.writeFileSync(indexPath, JSON.stringify(searchIndex, null, 2));  
  console.log("✅ Saved search_index.json");  
  
  if (discoveredSitemaps.length > 0) {  
    const sitemapPath = path.join(outputDir, "discovered_sitemaps.txt");  
    fs.writeFileSync(sitemapPath, discoveredSitemaps.join("\n"));  
    console.log("🗺️ Discovered sitemaps saved.");  
  }  
  
  try {  
    const fileBuffer = fs.readFileSync(indexPath);  
    const filename = `search_index_${Date.now()}.json`;  
    await supabase.storage.from(SUPABASE_BUCKET).upload(filename, fileBuffer, { upsert: true, contentType: "application/json" });  
    console.log("📦 Uploaded to Supabase Storage");  
  
    await supabase.from(SUPABASE_TABLE).insert({  
      id: crypto.randomUUID(),  
      created_at: new Date().toISOString(),  
      data: searchIndex,  
    });  
    console.log("📚 Uploaded to Supabase Table");  
  } catch (err) {  
    console.error("❌ Supabase upload failed:", err.message);  
  }  
}  
  
// Entry point  
(async () => {  
  const startUrl = process.argv[2] || "https://vm.tiktok.com/ZSSdhekg9/";  
  
  for (const url of PRIORITY_DOMAINS) crawlQueue.push({ url, depth: 0 });  
  if (!PRIORITY_DOMAINS.includes(startUrl)) crawlQueue.push({ url: startUrl, depth: 0 });  
  
  while (crawlQueue.length > 0) {  
    const { url, depth } = crawlQueue.shift();  
    await crawl(url, depth);  
  }  
  
  await saveIndex();  
})();
