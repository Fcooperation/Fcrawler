const { execSync } = require('child_process');
const fs = require('fs');
const url = process.argv[2] || 'https://example.com';
const outputDir = './output';

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

function dumpHTML(url) {
  const htmlFile = `${outputDir}/page.html`;
  try {
    console.log("📄 Dumping rendered HTML...");
    execSync(`chromium --headless --no-sandbox --disable-gpu --dump-dom "${url}" > ${htmlFile} 2>/dev/null`);
    console.log("✅ HTML dumped to:", htmlFile);
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
  } catch (err) {
    console.error("❌ Failed to take screenshot:", err.message);
  }
}

dumpHTML(url);
takeScreenshot(url);
