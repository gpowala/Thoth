const { spawnSync } = require('child_process');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const testsManagerDir = path.resolve(desktopDir, '..');

const paths = {
    desktopDir,
    backendDir: path.join(testsManagerDir, 'Backend'),
    frontendDir: path.join(testsManagerDir, 'Frontend'),
    frontendDist: path.join(testsManagerDir, 'Frontend', 'dist', 'thot-test-manager', 'browser'),
    backendStaging: path.join(desktopDir, 'staging', 'backend'),
    nodeResourceDir: path.join(desktopDir, 'resources', 'node')
};

function run(command, args, cwd) {
    console.log(`\n> [${path.relative(testsManagerDir, cwd) || '.'}] ${command} ${args.join(' ')}`);
    // npm is a .cmd shim on Windows and needs a shell; absolute executables don't.
    const shell = process.platform === 'win32' && !path.isAbsolute(command);
    const result = shell
        ? spawnSync([command, ...args].join(' '), { cwd, stdio: 'inherit', shell: true })
        : spawnSync(command, args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
    }
}

module.exports = { paths, run };
