const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const robotsParser = require("robots-parser");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

const CHROMIUM_PATH = "/usr/bin/chromium-browser"; // Update if different
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

function extractBlockContent($) {
  let blocks = [];

  $("body").find("p, h1, h2, h3, ul, li, img, a").each((_, el) => {
    const tag = $(el).get(0).tagName;
    if (tag === "img") {
      const src = $(el).attr("src");
      if (src) blocks.push(`<img src="${src}" />`);
    } else if (tag === "a") {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href) blocks.push(`<a href="${href}">${text}</a>`);
    } else {
      blocks.push(`<${tag}>${$(el).text().trim()}</${tag}>`);
    }
  });

  return blocks.join("\n");
}

async function saveAsHtml(url, title, content) {
  const filename = sanitizeFilename(url) + ".html";
  const fullContent = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>${title}</title></head>
    <body>${content}</body>
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
    const blockContent = extractBlockContent($);

    await saveAsHtml(url, title, blockContent);
    console.log(`📄 Axios Success: [${url}] - "${title}"`);

    // Extract internal links and queue them
    const links = [];
    $("a[href]").each((_, el) => {
      let href = $(el).attr("href");
      if (!href) return;
      try {
        const resolved = new URL(href, base).href;
        if (resolved.startsWith(base) && !visited.has(resolved)) {
          links.push(resolved);
        }
      } catch {}
    });

    for (const link of links) {
      await delay(500); // optional crawl delay
      crawlPage(link, base);
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
      crawlPage(url, base);
      await delay(1000); // optional
    }
  }
})();
