const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const robotsParser = require('robots-parser');

const url = process.argv[2] || 'https://example.com';
const outputDir = './output';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

const sharedDir = '/data/data/com.termux/files/home/storage/shared/Download'; // Termux phone path

const userAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

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
    return true; // If robots.txt can't be fetched, proceed
  }
}

async function fetchWithAxios(url) {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': userAgent },
      timeout: 10000
    });
    const $ = cheerio.load(res.data);
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('//')) $(el).attr('src', 'https:' + src);
    });
    const html = $.html();
    const htmlFile = `${outputDir}/page.html`;
    fs.writeFileSync(htmlFile, html);
    console.log('✅ Axios page saved to:', htmlFile);
    return true;
  } catch (err) {
    console.warn('⚠️ Axios failed, fallback to Chromium:', err.message);
    return false;
  }
}

function useChromium(url) {
  const htmlFile = `${outputDir}/page.html`;
  const screenshotFile = `${outputDir}/screenshot.png`;
  try {
    console.log('🌐 Using Chromium to dump DOM...');
    execSync(`chromium --headless --no-sandbox --disable-gpu --dump-dom "${url}" > "${htmlFile}"`);
    console.log('✅ Chromium HTML dumped:', htmlFile);

    execSync(`chromium --headless --no-sandbox --disable-gpu --screenshot="${screenshotFile}" --window-size=1280x720 "${url}"`);
    console.log('📸 Chromium screenshot saved:', screenshotFile);
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
