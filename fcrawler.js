const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const robotsParser = require('robots-parser');

const url = process.argv[2] || 'https://example.com';
const outputDir = './output';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

const userAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const crawlDelay = 1000; // ms delay between retries
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
    return true; // Proceed if robots.txt not reachable
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
      console.warn('⚠️ Content too short or JS required. Switching to Chromium...');
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

function useChromium(url) {
  const htmlFile = `${outputDir}/page.html`;
  const screenshotFile = `${outputDir}/screenshot.png`;

  try {
    const startTime = Date.now();

    console.log('🌐 Using Chromium to dump DOM...');
    execSync(`chromium --headless --no-sandbox --disable-gpu --dump-dom "${url}" > "${htmlFile}"`);
    console.log('✅ Chromium HTML dumped:', htmlFile);

    execSync(`chromium --headless --no-sandbox --disable-gpu --screenshot="${screenshotFile}" --window-size=1280x720 "${url}"`);
    console.log('📸 Chromium screenshot saved:', screenshotFile);

    console.log(`⏱️ Chromium fetch took ${Date.now() - startTime}ms`);
  } catch (err) {
    console.error('❌ Chromium failed:', err.message);
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
    console.log('🔁 Falling back to headless Chromium...');
    useChromium(url);
  }
})();
