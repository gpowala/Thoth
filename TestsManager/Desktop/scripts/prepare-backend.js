// Stages a production-only copy of the Backend's node_modules for packaging,
// without touching Backend/node_modules (which keeps its dev dependencies).
const fs = require('fs');
const path = require('path');
const { paths, run } = require('./lib');

const staging = paths.backendStaging;
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

for (const file of ['package.json', 'package-lock.json']) {
    const src = path.join(paths.backendDir, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, file));
}

run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], staging);
console.log(`\nBackend production dependencies staged in ${staging}`);
