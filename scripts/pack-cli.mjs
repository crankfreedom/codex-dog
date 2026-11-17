import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('当前仅验证 Windows 控制台可执行文件');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const stage = version.match(/-(g\d+)$/)?.[1];
if (!stage) throw new Error('缺少验证阶段标识');
await mkdir(`release/${stage}`, { recursive: true });
const config = {
  main: resolve('out/cli.cjs'), mainFormat: 'commonjs', executable: process.execPath,
  output: resolve(process.env.DOG_CLI_OUTPUT ?? `release/${stage}/codex-dog.exe`), disableExperimentalSEAWarning: true,
  useSnapshot: false, useCodeCache: false, execArgvExtension: 'none',
};
await writeFile('out/sea-config.json', JSON.stringify(config, null, 2));
const result = spawnSync(process.execPath, ['--build-sea', 'out/sea-config.json'], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`已生成 release/${stage}/codex-dog.exe，内置 Node 运行时；此验证产物未签名、非安装包。`);
