const { exec } = require('child_process');
const fs = require('fs');

const url = 'https://example.com';
const filename = 'screenshot.png';

// Run Chromium headless and take a screenshot
exec(`chromium --headless --no-sandbox --disable-gpu --screenshot=${filename} --window-size=1280,720 ${url}`, (err, stdout, stderr) => {
  if (err) {
    console.error('Error running Chromium:', err.message);
    return;
  }

  if (fs.existsSync(filename)) {
    console.log(`Screenshot saved as ${filename}`);
  } else {
    console.log('Screenshot failed.');
  }
});
