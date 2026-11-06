// Puts a portable node executable into resources/node/ for the desktop app to
// run the Backend with. By default it copies the Node.js running this script
// (so the desktop backend uses the same runtime it was built/tested with).
// Set THOTH_NODE_VERSION (e.g. "22.12.0") to download that official build instead.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { paths } = require('./lib');

const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
const target = path.join(paths.nodeResourceDir, nodeName);

function download(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return download(res.headers.location, dest).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
            }
            const out = fs.createWriteStream(dest);
            res.pipe(out);
            out.on('finish', () => out.close(resolve));
            out.on('error', reject);
        }).on('error', reject);
    });
}

function versionOf(exe) {
    try {
        return execFileSync(exe, ['-v'], { encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

async function main() {
    fs.mkdirSync(paths.nodeResourceDir, { recursive: true });
    const requested = process.env.THOTH_NODE_VERSION?.trim().replace(/^v/, '');
    const wanted = requested ? `v${requested}` : process.version;

    if (fs.existsSync(target) && versionOf(target) === wanted) {
        console.log(`Portable node ${wanted} already present: ${target}`);
        return;
    }

    if (requested) {
        if (process.platform !== 'win32') throw new Error('THOTH_NODE_VERSION download is only implemented for win-x64.');
        const url = `https://nodejs.org/dist/${wanted}/win-${process.arch}/node.exe`;
        console.log(`Downloading ${url}`);
        const tmp = `${target}.download`;
        await download(url, tmp);
        fs.renameSync(tmp, target);
    } else {
        console.log(`Copying ${process.execPath} (${wanted})`);
        fs.copyFileSync(process.execPath, target);
    }

    const actual = versionOf(target);
    if (actual !== wanted) throw new Error(`Portable node check failed: expected ${wanted}, got ${actual}`);
    console.log(`Portable node ${actual} ready: ${target}`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
