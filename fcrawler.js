const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const robotsParser = require("robots-parser");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");
const FormData = require("form-data");

// CONFIG
const CHROMIUM_PATH = "/usr/bin/chromium-browser";
const USER_AGENT = "fcrawler1.0";
const START_URLS = [
  "https://example.com",
  "https://wikipedia.org",
  "https://espn.com",
  "https://bbc.com"
];

// ✅ Round-Robin Token Assignment
const TOKENS = {
  img: [
    "vJMrHkZvOqg7ZyuqY3PLeMabIX2Oy5IAaqziLIPdk",
    "RXAm9kZ5Iqg7ZlXaRXfvKslSqc19nxNUcebmYQjak",
    "THCtRXZYIqg7ZNzbkHdHFl9Vi76h73cGcEyne3CtV",
    "z5oyqkZsIqg7Z8U7Ep1os4XXpI7ic0L40NJ5LS8kk",
    "5IirvXZMIqg7ZOQDnhREmhzj1E5fJwEWEhQnraNe7",
    "XHFGy7ZlIqg7ZaKWDkLJ1k7Xe96JOtt8PHRBdTY4k",
    "ItC7rXZ6Iqg7ZSr8FyPBJcMmDXglcFDk2v72avm67",
    "SYy2EVZGIqg7ZfkiOyDhV3MzYs758c9gcNhNwBYhk"
  ],
  vid_doc: [
    "qE79zVZcIqg7Z9CSRS0JPivV6wwrSm5LSJfDmtF6y",
    "Q3RwfXZkAqg7ZfqmWtyEsuKYk0qYnquPnELbxYkPy",
    "i8l4tVZWAqg7Zs7yal9wRg1VTB0i80ay7WJ9LoWp7",
    "s2hf3XZgAqg7ZgAEmMo984NHvq9caJaUd3pMTW6Vy"
  ],
  html: [
    "X7683XZ1Nqg7ZdVsrUxmJUdJ5VULzO93agRTSMUiy",
    "JeJGF7ZTNqg7ZKkO3vrc0DVynITBdf6sI5F3bG48k",
    "GvL2yVZPNqg7Z65UnTHMMBhSo6OJSKgglDV99JrwX"
  ]
};

const visited = new Set();
const delay = ms => new Promise(r => setTimeout(r, ms));

// ✨ Helper: Clean filename
function sanitizeFilename(url) {
  return url.replace(/[^\w-]+/g, "_").slice(0, 150);
}

// ✅ Upload to pCloud
async function uploadToPCloud(filePath, token) {
  const filename = path.basename(filePath);
  try {
    // Check if it exists
    const check = await axios.get("https://api.pcloud.com/file_exists", {
      params: { auth: token, path: "/" + filename }
    });

    if (check.data.exists) {
      console.log(`☁️ Skipped (already exists): ${filename}`);
      return;
    }

    // Upload
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("filename", filename);
    form.append("auth", token);

    const res = await axios.post("https://api.pcloud.com/uploadfile", form, {
      headers: form.getHeaders()
    });

    if (res.data.result === 0) {
      console.log(`☁️ Uploaded to pCloud: ${filename}`);
    } else {
      console.warn(`⚠️ Upload error: ${res.data.error}`);
    }
  } catch (err) {
    console.warn(`⚠️ Upload failed for ${filename}: ${err.message}`);
  }
}

// ✅ Save search index and upload
function saveSearchIndex(accountIndex, entry) {
  const searchPath = `output/index_account_${accountIndex}.json`;
  let index = [];
  if (fs.existsSync(searchPath)) index = JSON.parse(fs.readFileSync(searchPath));
  index.push(entry);
  fs.writeFileSync(searchPath, JSON.stringify(index, null, 2));
  uploadToPCloud(searchPath, TOKENS.html[accountIndex % TOKENS.html.length]);
}

// ✅ Save HTML and upload
async function saveAsHtml(url, title, content, accountIndex) {
  const filename = sanitizeFilename(url) + ".html";
  const fullPath = path.join(__dirname, "output", filename);
  const html = `
    <!DOCTYPE html>
    <html><head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>body { font-family: Arial; padding: 20px; line-height: 1.6; }</style>
    </head><body>
      <h1>${title}</h1>
      ${content}
    </body></html>
  `;
  fs.writeFileSync(fullPath, html);
  console.log(`💾 Saved: ${filename}`);

  saveSearchIndex(accountIndex, {
    type: "html",
    source: url,
    filename,
    description: `Rebuilt HTML of ${title}`
  });

  await uploadToPCloud(fullPath, TOKENS.html[accountIndex % TOKENS.html.length]);
}

// ✅ Save favicon and upload
async function crawlFavicon(siteUrl, accountIndex) {
  try {
    const base = new URL(siteUrl).origin;
    const faviconUrl = `${base}/favicon.ico`;
    const res = await axios.get(faviconUrl, { responseType: "arraybuffer" });
    const filename = sanitizeFilename(base) + "_favicon.ico";
    const fullPath = path.join(__dirname, "output", filename);
    fs.writeFileSync(fullPath, res.data);
    console.log(`🌟 Favicon saved: ${filename}`);

    saveSearchIndex(accountIndex, {
      type: "favicon",
      source: faviconUrl,
      filename,
      description: `Favicon for ${base}`
    });

    await uploadToPCloud(fullPath, TOKENS.img[accountIndex % TOKENS.img.length]);
  } catch {
    console.warn(`⚠️ Favicon not found for ${siteUrl}`);
  }
}

// ✅ Extract blocks with previews
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
        blocks.push(`<a href="${abs}" target="_blank"><div style="width:250px;height:250px;background:#ccc;">🎬 Video Preview</div><div>${filename}</div></a>`);
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

    if (isVideo || isDoc) {
  const filename = path.basename(abs).split("?")[0];
  const icon = isVideo ? "🎥" : ext.includes("pdf") ? "📕" : ext.includes("zip") ? "🗜️" : "📄";

  const html = `<a href="${abs}" target="_blank">
    <div style="width:250px;height:250px;background:#ddd;display:flex;align-items:center;justify-content:center;border-radius:12px;">${icon}</div>
    <div style="margin-top:8px;font-weight:bold;text-align:center;">${filename}</div>
  </a>`;

  const cardFilename = sanitizeFilename(abs) + "_card.html";
  const cardPath = path.join(__dirname, "output", cardFilename);
  fs.writeFileSync(cardPath, html);

  const token = TOKENS.vid_doc[indexTracker.vid_doc % TOKENS.vid_doc.length];
  indexTracker.vid_doc++;

  saveSearchIndex(indexTracker.vid_doc, {
    type: isVideo ? "video" : "doc",
    source: abs,
    filename: cardFilename,
    description: `Card for ${filename}`
  });

  uploadToPCloud(cardPath, token);
}
  });

  return blocks.join("\n");
}

// ✅ Robots
async function checkRobotsPermission(siteUrl, agent) {
  try {
    const base = new URL(siteUrl).origin;
    const robotsUrl = `${base}/robots.txt`;
    const res = await axios.get(robotsUrl, { headers: { "User-Agent": agent } });
    const robots = robotsParser(robotsUrl, res.data);
    return robots.isAllowed(siteUrl, agent);
  } catch {
    return true;
  }
}

// ✅ Get sitemap URLs
async function getSitemapUrls(baseUrl) {
  try {
    const res = await axios.get(new URL("/sitemap.xml", baseUrl).href, { headers: { "User-Agent": USER_AGENT } });
    const parsed = await xml2js.parseStringPromise(res.data);
    return parsed.urlset.url.map(u => u.loc[0]);
  } catch {
    return [];
  }
}

// ✅ Fetch HTML via axios or puppeteer
async function fetchPageContent(url) {
  try {
    const res = await axios.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: 10000 });
    return res.data;
  } catch {
    const browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: "new",
      args: ["--no-sandbox"]
    });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const content = await page.content();
    await browser.close();
    return content;
  }
}

// ✅ Crawl one page
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

    const htmlIndex = indexTracker.html % TOKENS.html.length;
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

// ✅ Main entry
(async () => {
  if (!fs.existsSync("output")) fs.mkdirSync("output");

  for (const site of START_URLS) {
    const base = new URL(site).origin;
    const sitemapUrls = await getSitemapUrls(base);
    const allUrls = [site, ...sitemapUrls];
    const indexTracker = { img: 0, html: 0, vid_doc: 0 };

    for (const url of allUrls) {
      await crawlPage(url, base, indexTracker);
    }
  }
})();
