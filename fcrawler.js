const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const robotsParser = require("robots-parser");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

const CHROMIUM_PATH = "/usr/bin/chromium-browser"; // Update if needed
const USER_AGENT = "fcrawler1.0";
const START_URLS = [
  "https://example.com",
  "https://wikipedia.org",
  "https://espn.com",
  "https://bbc.com",
];

const visited = new Set();
const delay = ms => new Promise(r => setTimeout(r, ms));

async function checkRobotsPermission(siteUrl, crawlerAgent) {
  try {
    const base = new URL(siteUrl).origin;
    const robotsUrl = `${base}/robots.txt`;
    const res = await axios.get(robotsUrl, { headers: { "User-Agent": crawlerAgent } });
    const robots = robotsParser(robotsUrl, res.data);
    const allowed = robots.isAllowed(siteUrl, crawlerAgent);
    console.log(`🤖 Robots.txt check for ${crawlerAgent} @ ${siteUrl}: ${allowed ? "Allowed" : "Disallowed"}`);
    return allowed;
  } catch (err) {
    console.warn(`⚠️ robots.txt fetch failed for ${siteUrl} — assuming allowed.`);
    return true;
  }
}

async function getSitemapUrls(baseUrl) {
  try {
    const res = await axios.get(new URL("/sitemap.xml", baseUrl).href, {
      headers: { "User-Agent": USER_AGENT }
    });
    const parsed = await xml2js.parseStringPromise(res.data);
    const urls = parsed.urlset.url.map(u => u.loc[0]);
    console.log(`🗺️ Found ${urls.length} URLs in sitemap for ${baseUrl}`);
    return urls;
  } catch (err) {
    console.warn(`⚠️ No sitemap for ${baseUrl}`);
    return [];
  }
}

function sanitizeFilename(url) {
  return url.replace(/[^\w\-]+/g, "_").slice(0, 150);
}

function extractBlockContent($, pageUrl) {
  let blocks = [];

  $("body").find("p, h1, h2, h3, ul, li, img, a, video").each((_, el) => {
    const tag = $(el).get(0).tagName;

    if (tag === "img") {
      const src = $(el).attr("src");
      if (src) blocks.push(`<img src="${src}" style="max-width:100%;" />`);
    } else if (tag === "a") {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href) blocks.push(`<a href="${href}">${text}</a>`);
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
    } else {
      blocks.push(`<${tag}>${$(el).text().trim()}</${tag}>`);
    }
  });

  // Detect common video links not inside <video> tags (like YouTube)
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (
      href &&
      /(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|\.mp4|\.webm)/.test(href)
    ) {
      const abs = new URL(href, pageUrl).href;
      const filename = path.basename(abs).split("?")[0];
      blocks.push(`
        <a href="${abs}" target="_blank" style="text-decoration:none;">
          <div style="width:250px;height:250px;background:#bbb;border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;margin:10px 0;">
            🎥 Video Link
          </div>
          <div style="font-weight:bold;margin-bottom:20px;">${filename}</div>
        </a>
      `);
    }
  });

  return blocks.join("\n");
}

async function saveAsHtml(url, title, content) {
  const filename = sanitizeFilename(url) + ".html";
  const fullContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      ${content}
    </body>
    </html>
  `;
  fs.writeFileSync(path.join(__dirname, "output", filename), fullContent);
  console.log(`💾 Saved: ${filename}`);
}

async function crawlPage(url, base) {
  if (visited.has(url)) return;
  visited.add(url);

  const allowed = await checkRobotsPermission(url, USER_AGENT);
  if (!allowed) return;

  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const title = $("title").text().trim();
    const blockContent = extractBlockContent($, url);
    await saveAsHtml(url, title, blockContent);
    console.log(`📄 Success: [${url}] - "${title}"`);

    // Crawl internal links
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
      await crawlPage(link, base);
    }
  } catch (err) {
    console.warn(`❌ Failed to crawl ${url}: ${err.message}`);
  }
}

(async () => {
  if (!fs.existsSync("output")) fs.mkdirSync("output");

  for (const site of START_URLS) {
    console.log("🚀 Starting crawl:", site);
    const base = new URL(site).origin;

    const sitemapUrls = await getSitemapUrls(base);
    const allUrls = [site, ...sitemapUrls];

    for (const url of allUrls) {
      await crawlPage(url, base);
      await delay(1000);
    }
  }
})();
