const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const robotsParser = require('robots-parser');

const url = process.argv[2] || 'https://example.com';
const outputDir = './output';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

const userAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const crawlDelay = 1000; // delay between retries in ms
const maxRetries = 3;
const mimeWhitelist = ['text/html', 'application/xhtml+xml'];

function getDomainRoot(u) {
  const { protocol, hostname } = new URL(u);
  return `${protocol}//${hostname}`;
}

async function obeysRobots(url) {
  try {
    const robotsUrl = getDomainRoot(url) + '/robots.txt';
    const res = await axios.get(robotsUrl, { headers: { 'User-Agent': userAgent } });
    const robots = robotsParser(robotsUrl, res.data);
    return robots.isAllowed(url, userAgent);
  } catch {
    return true; // allow if robots.txt is not accessible
  }
}

async function fetchWithAxios(url, retries = 0) {
  try {
    const startTime = Date.now();
    const res = await axios.get(url, {
      headers: { 'User-Agent': userAgent },
      timeout: 10000,
      responseType: 'text',
      validateStatus: status => status >= 200 && status < 400,
    });

    const contentType = res.headers['content-type'] || '';
    if (!mimeWhitelist.some(type => contentType.includes(type))) {
      console.warn(`⚠️ MIME type "${contentType}" not accepted. Skipping.`);
      return false;
    }

    const $ = cheerio.load(res.data);
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('//')) $(el).attr('src', 'https:' + src);
    });

    const html = $.html();
    const htmlFile = `${outputDir}/page.html`;
    fs.writeFileSync(htmlFile, html);
    console.log('✅ Axios page saved to:', htmlFile);

    const text = $('body').text().replace(/\s+/g, ' ').trim();
    if (text.length < 100 || /javascript required|enable javascript/i.test(html)) {
      console.warn('⚠️ Content too short or JS required. Switching to Puppeteer...');
      return false;
    }

    console.log(`⏱️ Axios fetch took ${Date.now() - startTime}ms`);
    return true;
  } catch (err) {
    console.warn(`⚠️ Axios failed (Attempt ${retries + 1}/${maxRetries}):`, err.message);
    if (retries < maxRetries) {
      await new Promise(res => setTimeout(res, crawlDelay));
      return fetchWithAxios(url, retries + 1);
    }
    return false;
  }
}

async function usePuppeteer(url) {
  const htmlFile = `${outputDir}/page.html`;
  const screenshotFile = `${outputDir}/screenshot.png`;

  try {
    const startTime = Date.now();
    console.log('🚀 Launching Puppeteer...');

    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium', // Adjust if needed
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const page = await browser.newPage();
    await page.setUserAgent(userAgent);

    console.log('🌍 Navigating to page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Optional: click or scroll here if needed
    // await page.click('button.accept'); // Example

    const html = await page.content();
    fs.writeFileSync(htmlFile, html);
    console.log('✅ Puppeteer HTML saved to:', htmlFile);

    await page.screenshot({ path: screenshotFile, fullPage: true });
    console.log('📸 Puppeteer screenshot saved:', screenshotFile);

    console.log(`⏱️ Puppeteer fetch took ${Date.now() - startTime}ms`);
    await browser.close();
  } catch (err) {
    console.error('❌ Puppeteer failed:', err.message);
  }
}

(async () => {
  console.log('🔍 Checking robots.txt...');
  const allowed = await obeysRobots(url);
  if (!allowed) {
    console.log('⛔ Blocked by robots.txt, skipping.');
    return;
  }

  console.log('⚡ Trying Axios + Cheerio...');
  const axiosSuccess = await fetchWithAxios(url);

  if (!axiosSuccess) {
    console.log('🔁 Falling back to headless Puppeteer...');
    await usePuppeteer(url);
  }
})();
