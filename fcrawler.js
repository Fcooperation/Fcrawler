const { execSync } = require('child_process');
const fs = require('fs');

const url = "https://example.com";

try {
  console.log("📄 Dumping rendered HTML...");
  const html = execSync(`chromium --headless --no-sandbox --disable-gpu --dump-dom "${url}"`).toString();
  fs.writeFileSync("output/page.html", html);
  console.log("✅ HTML dumped to output/page.html");
} catch (err) {
  console.error("❌ Failed to dump HTML:", err.message);
}

try {
  console.log("📸 Taking screenshot...");
  execSync(`chromium --headless --no-sandbox --disable-gpu --screenshot="output/screenshot.png" --window-size=1280x720 "${url}"`);
  console.log("✅ Screenshot saved to output/screenshot.png");
} catch (err) {
  console.error("❌ Failed to take screenshot:", err.message);
}
