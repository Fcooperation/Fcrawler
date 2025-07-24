const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const urlLib = require("url");
const robotsParser = require("robots-parser");
const mime = require("mime-types");
const crypto = require("crypto");
const { URL } = require("url");
const { execSync } = require("child_process");
const mega = require("./mega");

const visited = new Set();
const searchIndex = [];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB max for download
const DOWNLOADABLE_EXT = /\.(pdf|zip|mp3|docx?|xlsx?|pptx?)$/i;

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchWithRetries(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { timeout: 10000 });
      return response;
    } catch (e) {
      console.warn(`⚠️ Axios retry ${i + 1} failed for ${url}: ${e.message}`);
    }
  }
  return null;
}

async function obeysRobots(url) {
  try {
    const { origin } = new URL(url);
    const robotsTxtUrl = origin + "/robots.txt";
    const response = await fetchWithRetries(robotsTxtUrl);
    if (!response) return true;
    const robots = robotsParser(robotsTxtUrl, response.data);
    return robots.isAllowed(url, "fcrawler");
  } catch {
    return true;
  }
}

async function extractCanonical($, url) {
  const canonical = $("link[rel='canonical']").attr("href");
  if (!canonical) return url;
  return new URL(canonical, url).toString();
}

async function scrollPage(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

async function crawl(url, depth = 0) {
  if (visited.has(url) || depth > 3) return;
  visited.add(url);

  if (!(await obeysRobots(url))) {
    console.log(`🚫 Blocked by robots.txt: ${url}`);
    return;
  }

  console.log(`🔍 Crawling: ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser", // or chromium path on Termux
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
    await scrollPage(page);

    const content = await page.content();
    const $ = cheerio.load(content);
    const title = $("title").text() || "Untitled";

    const canonicalUrl = await extractCanonical($, url);
    if (visited.has(canonicalUrl)) return;
    visited.add(canonicalUrl);

    const blocks = $("body").html();
    const fileName = `${crypto
      .createHash("md5")
      .update(canonicalUrl)
      .digest("hex")}.html`;

    const outputPath = path.join(__dirname, "output", fileName);
    fs.writeFileSync(outputPath, `<html><head><title>${title}</title></head><body>${blocks}</body></html>`);

    await mega.uploadToMega(outputPath, fileName);

    const metadata = {
      title,
      url: canonicalUrl,
      filename: fileName,
      text: $("body").text().trim().slice(0, 500),
    };
    searchIndex.push(metadata);

    // Download and upload files
    $("a[href]").each(async (_, el) => {
      const href = $(el).attr("href");
      const absUrl = new URL(href, url).toString();
      if (DOWNLOADABLE_EXT.test(absUrl)) {
        try {
          const head = await axios.head(absUrl);
          const size = parseInt(head.headers["content-length"] || "0");
          if (size < MAX_FILE_SIZE) {
            const ext = path.extname(absUrl);
            const filePath = path.join(__dirname, "output", path.basename(absUrl));
            const file = await axios.get(absUrl, { responseType: "stream" });
            const writer = fs.createWriteStream(filePath);
            file.data.pipe(writer);
            writer.on("finish", async () => {
              await mega.uploadToMega(filePath, path.basename(filePath));
              fs.unlinkSync(filePath);
            });
          }
        } catch (e) {
          console.warn(`⚠️ Failed file: ${absUrl}`);
        }
      }
    });

    // Follow links
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        const nextUrl = new URL(href, url).toString();
        if (!visited.has(nextUrl) && nextUrl.startsWith("http")) {
          setTimeout(() => crawl(nextUrl, depth + 1), 1000);
        }
      }
    });
  } catch (e) {
    console.error(`❌ Failed to crawl ${url}:`, e.message);
  } finally {
    await browser.close();
  }
}

async function start() {
  const startUrl = process.argv[2] || "https://archive.org/";
  if (!fs.existsSync("output")) fs.mkdirSync("output");

  await crawl(startUrl);

  fs.writeFileSync("search_index.json", JSON.stringify(searchIndex, null, 2));
  console.log("✅ Saved search_index.json");
}

start();
