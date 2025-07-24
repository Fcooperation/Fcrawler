const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

async function crawlPage(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  console.log(`🟢 Crawling: ${url}`);
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  // Create output folder
  const folder = "./output";
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);

  // Extract data
  const html = await page.content();
  const title = await page.title();
  const links = await page.$$eval("a", as => as.map(a => a.href));

  // Save HTML
  const safeTitle = title.replace(/[\/\\?%*:|"<>]/g, "-").slice(0, 50);
  const htmlPath = path.join(folder, `${safeTitle}.html`);
  fs.writeFileSync(htmlPath, html);

  // Save screenshot
  const screenshotPath = path.join(folder, `${safeTitle}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Save metadata log
  const metadata = {
    title,
    url,
    file: htmlPath,
    screenshot: screenshotPath,
    links,
  };
  fs.writeFileSync(
    path.join(folder, `${safeTitle}_meta.json`),
    JSON.stringify(metadata, null, 2)
  );

  console.log(`✅ Saved: ${title}`);
  console.log(`📎 Links found: ${links.length}`);
  await browser.close();
}

// Run this with any site
crawlPage("https://example.com");
