// Builds everything the desktop app consumes, using each project's own scripts:
//   1. Backend  -> Backend/dist            (npm run build)
//   2. Frontend -> Frontend/dist/...       (npm run build)
//   3. Backend production node_modules     (staging/backend)
//   4. Portable node.exe                   (resources/node)
// Packaging itself is done by electron-builder (see "pack"/"dist" scripts).
const fs = require('fs');
const path = require('path');
const { paths, run } = require('./lib');

function buildProject(dir) {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) {
        run('npm', ['install', '--no-audit', '--no-fund'], dir);
    }
    run('npm', ['run', 'build'], dir);
}

buildProject(paths.backendDir);
buildProject(paths.frontendDir);
run(process.execPath, [path.join(__dirname, 'prepare-backend.js')], paths.desktopDir);
run(process.execPath, [path.join(__dirname, 'prepare-node.js')], paths.desktopDir);

console.log('\nAll desktop inputs are built.');
