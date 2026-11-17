import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('electron/package.json'); const root = dirname(packagePath);
const { version } = JSON.parse(await readFile(packagePath, 'utf8'));
if (version !== '45.0.0' || process.platform !== 'win32' || process.arch !== 'x64') throw new Error('ELECTRON_RUNTIME_UNSUPPORTED');
if (process.env.ELECTRON_OVERRIDE_DIST_PATH) throw new Error('ELECTRON_OVERRIDE_NOT_ALLOWED');
await new Promise((resolveCall, reject) => {
  const child = spawn(process.execPath, [join(root, 'install.js')], { windowsHide: true, stdio: 'inherit' });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolveCall() : reject(new Error('ELECTRON_RUNTIME_INSTALL_FAILED')));
});
const installedVersion = (await readFile(join(root, 'dist/version'), 'utf8')).trim().replace(/^v/, '');
const path = (await readFile(join(root, 'path.txt'), 'utf8')).trim();
if (installedVersion !== version || path !== 'electron.exe') throw new Error('ELECTRON_RUNTIME_MISMATCH');
await access(resolve(root, 'dist', path));
console.log('Electron 45.0.0 Windows x64 运行时已显式就绪；下载校验由固定版本原生安装器执行。');
