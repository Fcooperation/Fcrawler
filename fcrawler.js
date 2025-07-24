const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Target URL
const url = "https://example.com"; // Change this dynamically if needed

// Output file paths
const outputDir = "./output";
const htmlFile = path.join(outputDir, "output.html");
const screenshotFile = path.join(outputDir, "screenshot.png");

// Window size
const windowSize = "1280x720";

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Chromium command paths
const CHROMIUM_BIN = "chromium"; // or "chromium-browser" based on your setup

// Dump rendered HTML
try {
  console.log("📄 Dumping rendered HTML...");
  const htmlContent = execSync(`${CHROMIUM_BIN} --headless --disable-gpu --dump-dom "${url}"`, {
    encoding: "utf-8",
  });
  fs.writeFileSync(htmlFile, htmlContent);
  console.log(`✅ HTML saved to ${htmlFile}`);
} catch (err) {
  console.error("❌ Failed to dump HTML:", err.message);
}

// Take screenshot
try {
  console.log("📸 Taking screenshot...");
  execSync(`${CHROMIUM_BIN} --headless --disable-gpu --screenshot="${screenshotFile}" --window-size=${windowSize} "${url}"`);
  console.log(`✅ Screenshot saved to ${screenshotFile}`);
} catch (err) {
  console.error("❌ Failed to take screenshot:", err.message);
}
