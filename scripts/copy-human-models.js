// scripts/copy-human-models.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
    }
  }
}

(async () => {
  try {
    const src = path.join(process.cwd(), 'node_modules', '@vladmandic', 'human', 'models');
    const dest = path.join(process.cwd(), 'public', 'models');
    await copyDir(src, dest);
    console.log('[copy-human-models] Copied models ->', dest);
  } catch (err) {
    console.error('[copy-human-models] Failed:', err.message);
    process.exit(0); // jangan gagalkan install
  }
})();
