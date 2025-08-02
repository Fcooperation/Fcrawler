const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const robotsParser = require("robots-parser");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

// CONFIG SECTION
const CHROMIUM_PATH = "/usr/bin/chromium-browser";
const USER_AGENT = "fcrawler1.0";
const START_URLS = [
  "https://example.com",
  "https://wikipedia.org",
  "https://espn.com",
  "https://bbc.com"
];

// 🔒 Placeholders for your pCloud upload tokens
const TOKENS = {
  img: ["vJMrHkZvOqg7ZyuqY3PLeMabIX2Oy5IAaqziLIPdk", "TOKEN2", "TOKEN3", "TOKEN4", "TOKEN5", "TOKEN6", "TOKEN7", "TOKEN8"],
  vid_doc: ["TOKEN9", "TOKEN10", "i8l4tVZWAqg7Zs7yal9wRg1VTB0i80ay7WJ9LoWp7", "s2hf3XZgAqg7ZgAEmMo984NHvq9caJaUd3pMTW6Vy"],
  html: ["X7683XZ1Nqg7ZdVsrUxmJUdJ5VULzO93agRTSMUiy", "JeJGF7ZTNqg7ZKkO3vrc0DVynITBdf6sI5F3bG48k", "GvL2yVZPNqg7Z65UnTHMMBhSo6OJSKgglDV99JrwX"]
};

const visited = new Set();
const delay = ms => new Promise(r => setTimeout(r, ms));

// Utilities
function sanitizeFilename(url) {
  return url.replace(/[^\w-]+/g, "_").slice(0, 150);
}

function saveSearchIndex(accountIndex, entry) {
  const searchPath = `output/index_account_${accountIndex}.json`;
  let index = [];
  if (fs.existsSync(searchPath)) index = JSON.parse(fs.readFileSync(searchPath));
  index.push(entry);
  fs.writeFileSync(searchPath, JSON.stringify(index, null, 2));
}

// Robots.txt check
async function checkRobotsPermission(siteUrl, crawlerAgent) {
  try {
    const base = new URL(siteUrl).origin;
    const robotsUrl = `${base}/robots.txt`;
    const res = await axios.get(robotsUrl, { headers: { "User-Agent": crawlerAgent } });
    const robots = robotsParser(robotsUrl, res.data);
    const allowed = robots.isAllowed(siteUrl, crawlerAgent);
    console.log(`🤖 Robots.txt check @ ${siteUrl}: ${allowed ? "Allowed" : "Disallowed"}`);
    return allowed;
  } catch {
    console.warn(`⚠️ Failed to fetch robots.txt for ${siteUrl}, assuming allowed.`);
    return true;
  }
}

// Sitemap fetch
async function getSitemapUrls(baseUrl) {
  try {
    const res = await axios.get(new URL("/sitemap.xml", baseUrl).href, {
      headers: { "User-Agent": USER_AGENT },
    });
    const parsed = await xml2js.parseStringPromise(res.data);
    const urls = parsed.urlset.url.map(u => u.loc[0]);
    console.log(`🗺️ Sitemap: Found ${urls.length} URLs`);
    return urls;
  } catch {
    console.warn(`⚠️ No sitemap found at ${baseUrl}`);
    return [];
  }
}

// Favicon handling
async function crawlFavicon(siteUrl, accountIndex) {
  try {
    const base = new URL(siteUrl).origin;
    const faviconUrl = `${base}/favicon.ico`;
    const res = await axios.get(faviconUrl, { responseType: "arraybuffer" });
    const filename = sanitizeFilename(base) + "_favicon.ico";
    fs.writeFileSync(path.join(__dirname, "output", filename), res.data);
    console.log(`🌟 Favicon saved: ${filename}`);

    saveSearchIndex(accountIndex, {
      type: "favicon",
      source: faviconUrl,
      filename,
      description: `Favicon for ${base}`,
    });

  } catch (err) {
    console.warn(`⚠️ Favicon not found for ${siteUrl}`);
  }
}

// Extract page blocks
function extractBlockContent($, pageUrl) {
  const blocks = [];

  $("body").find("p, h1, h2, h3, ul, li, img, a, video").each((_, el) => {
    const tag = $(el).get(0).tagName;

    if (tag === "img") {
      const src = $(el).attr("src");
      if (src) blocks.push(`<img src="${src}" style="max-width:100%;" />`);
    } else if (tag === "video") {
      const src = $(el).attr("src") || $(el).find("source").attr("src");
      if (src) {
        const abs = new URL(src, pageUrl).href;
        const filename = path.basename(abs).split("?")[0];
        blocks.push(`
          <a href="${abs}" target="_blank" style="text-decoration:none;">
            <div style="width:250px;height:250px;background:#ccc;border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;margin:10px 0;">
              🎬 Video Preview
            </div>
            <div style="font-weight:bold;margin-bottom:20px;">${filename}</div>
          </a>
        `);
      }
    } else if (tag === "a") {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && text) blocks.push(`<a href="${href}">${text}</a>`);
    } else {
      blocks.push(`<${tag}>${$(el).text().trim()}</${tag}>`);
    }
  });

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const abs = new URL(href, pageUrl).href;
    const ext = path.extname(abs).toLowerCase();
    const isVideo = /(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|\.mp4|\.webm)/.test(abs);
    const isDoc = /\.(pdf|zip|docx?|pptx?|xlsx?)$/.test(ext);

    if (isVideo) {
      const filename = path.basename(abs).split("?")[0];
      blocks.push(`
        <a href="${abs}" target="_blank" style="text-decoration:none;">
          <div style="width:250px;height:250px;background:#bbb;border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;margin:10px 0;">
            🎥 Video Link
          </div>
          <div style="font-weight:bold;margin-bottom:20px;">${filename}</div>
        </a>
      `);
    } else if (isDoc) {
      const filename = path.basename(abs).split("?")[0];
      const icon = ext.includes("pdf") ? "📕" : ext.includes("zip") ? "🗜️" : "📄";
      blocks.push(`
        <a href="${abs}" target="_blank" style="text-decoration:none;">
          <div style="width:100%;display:flex;align-items:center;background:#eee;padding:10px;border-radius:8px;margin:10px 0;">
            <div style="font-size:2rem;margin-right:10px;">${icon}</div>
            <div style="font-weight:bold;">${filename}</div>
          </div>
        </a>
      `);
    }
  });

  return blocks.join("\n");
}

// HTML Save
async function saveAsHtml(url, title, content, accountIndex) {
  const filename = sanitizeFilename(url) + ".html";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }</style>
    </head>
    <body>
      <h1>${title}</h1>
      ${content}
    </body>
    </html>
  `;
  fs.writeFileSync(path.join(__dirname, "output", filename), html);
  console.log(`💾 Saved: ${filename}`);

  saveSearchIndex(accountIndex, {
    type: "html",
    source: url,
    filename,
    description: `Rebuilt HTML of ${title}`
  });
}

// HTML fetch
async function fetchPageContent(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });
    return res.data;
  } catch (err) {
    console.warn(`⚠️ Axios failed, trying Puppeteer for ${url}`);
    try {
      const browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setUserAgent(USER_AGENT);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      const content = await page.content();
      await browser.close();
      return content;
    } catch (puppeteerError) {
      throw new Error(`Puppeteer failed for ${url}: ${puppeteerError.message}`);
    }
  }
}

// Crawler
async function crawlPage(url, base, indexTracker) {
  if (visited.has(url)) return;
  visited.add(url);

  const allowed = await checkRobotsPermission(url, USER_AGENT);
  if (!allowed) return;

  try {
    const html = await fetchPageContent(url);
    const $ = cheerio.load(html);
    const title = $("title").text().trim() || url;
    const content = extractBlockContent($, url);

    const htmlIndex = 13 + (indexTracker.html % TOKENS.html.length);
    await saveAsHtml(url, title, content, htmlIndex);
    indexTracker.html++;

    await crawlFavicon(url, indexTracker.img % TOKENS.img.length);
    indexTracker.img++;

    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const resolved = new URL(href, base).href;
        if (resolved.startsWith(base) && !visited.has(resolved)) {
          links.push(resolved);
        }
      } catch {}
    });

    for (const link of links) {
      await delay(500);
      await crawlPage(link, base, indexTracker);
    }
  } catch (err) {
    console.warn(`❌ Failed: ${url} — ${err.message}`);
  }
}

// MAIN
(async () => {
  if (!fs.existsSync("output")) fs.mkdirSync("output");

  for (const site of START_URLS) {
    console.log("🚀 Starting:", site);
    const base = new URL(site).origin;
    const sitemapUrls = await getSitemapUrls(base);
    const allUrls = [site, ...sitemapUrls];
    const indexTracker = { img: 0, html: 0 };

    for (const url of allUrls) {
      await crawlPage(url, base, indexTracker);
    }
  }
})();
