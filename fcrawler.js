const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const url = process.argv[2] || 'https://vm.tiktok.com/ZSSeQ7KNb/';
const outputDir = './output';
const sharedDir = '/data/data/com.termux/files/home/storage/shared/Download'; // Termux shared storage

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

function dumpHTML(url) {
  const htmlFile = `${outputDir}/page.html`;
  try {
    console.log("📄 Dumping rendered HTML...");
    execSync(`chromium --headless --no-sandbox --disable-gpu --dump-dom "${url}" > ${htmlFile} 2>/dev/null`);
    console.log("✅ HTML dumped to:", htmlFile);

    // Copy to phone storage
    const htmlDest = path.join(sharedDir, 'page.html');
    fs.copyFileSync(htmlFile, htmlDest);
    console.log("📥 Copied HTML to:", htmlDest);

  } catch (err) {
    console.error("❌ Failed to dump HTML:", err.message);
  }
}

function takeScreenshot(url) {
  const screenshotFile = `${outputDir}/screenshot.png`;
  try {
    console.log("📸 Taking screenshot...");
    execSync(`chromium --headless --no-sandbox --disable-gpu --screenshot="${screenshotFile}" --window-size=1280x720 "${url}" 2>/dev/null`);
    console.log("✅ Screenshot saved to:", screenshotFile);

    // Copy to phone storage
    const imgDest = path.join(sharedDir, 'screenshot.png');
    fs.copyFileSync(screenshotFile, imgDest);
    console.log("📥 Copied screenshot to:", imgDest);

  } catch (err) {
    console.error("❌ Failed to take screenshot:", err.message);
  }
}

dumpHTML(url);
takeScreenshot(url);
