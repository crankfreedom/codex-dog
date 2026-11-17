import { build, Platform, Arch } from 'electron-builder';
import { mkdir, readFile, writeFile, cp, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const runId = randomUUID().slice(0, 8);
const profile = `g05-install-${runId}`;
const versions = ['0.5.0-beta.1', '0.5.0-beta.2'];
async function command(args, variables) {
  await new Promise((resolveCall, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...variables }, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolveCall() : reject(new Error('构建步骤失败：' + args.join(' '))));
  });
}
const packages = [];
for (const version of versions) {
  const root = resolve('.cache/g05', runId, version); const app = join(root, 'app'); const resources = join(root, 'resources');
  await mkdir(resources, { recursive: true }); await mkdir(app, { recursive: true });
  await command(['scripts/build.mjs'], { DOG_BUILD_VERSION: version });
  const cli = join(resources, 'codex-dog.exe');
  await command(['scripts/pack-cli.mjs'], { DOG_CLI_OUTPUT: cli });
  await cp('out', join(app, 'out'), { recursive: true });
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'codex-dog-g05-test', productName: 'Codex Dog G05 Test', version, main: 'out/main.cjs', description: 'Codex Dog G05 独立安装更新测试', author: 'crankfreedom', private: true }, null, 2));
  await writeFile(join(resources, 'g05-distribution.json'), JSON.stringify({ kind: 'g05-test', profile, repository: 'crankfreedom/codex-dog' }));
  const output = resolve('release/g05', version);
  const files = await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', config: {
    appId: 'local.codex-dog.g05-test', productName: 'Codex Dog G05 Test', executableName: 'CodexDogG05',
    directories: { app, output, buildResources: resolve('build') }, electronVersion: '45.0.0', electronDist: resolve('node_modules/electron/dist'),
    npmRebuild: false, asar: true, asarUnpack: ['out/windows-pipe.ps1'], files: ['out/**', 'package.json', '!out/*.meta.json'], compression: 'normal',
    extraResources: [{ from: cli, to: 'cli/codex-dog.exe' }, { from: join(resources, 'g05-distribution.json'), to: 'g05-distribution.json' }, { from: resolve('build/cli-file-guard.ps1'), to: 'cli-file-guard.ps1' }],
    win: { target: ['nsis'], artifactName: 'Codex-Dog-G05-${version}-Setup.${ext}', signAndEditExecutable: true, signExecutable: false, verifyUpdateCodeSignature: false },
    nsis: { oneClick: true, perMachine: false, allowElevation: false, runAfterFinish: false, createDesktopShortcut: false, createStartMenuShortcut: false, deleteAppDataOnUninstall: false, include: resolve('build/installer.nsh'), differentialPackage: false, packElevateHelper: false },
    publish: [{ provider: 'github', owner: 'crankfreedom', repo: 'codex-dog', releaseType: 'prerelease', channel: 'beta' }],
  } });
  const fileName = `Codex-Dog-G05-${version}-Setup.exe`; const installer = join(output, fileName); const size = (await stat(installer)).size;
  const hash = createHash('sha512'); for await (const chunk of createReadStream(installer)) hash.update(chunk); const sha512 = hash.digest('base64');
  // 非差分 NSIS 的默认清单可能不带 size；补齐受控下载所需大小，哈希仍基于最终安装包。
  await writeFile(join(output, 'beta.yml'), `version: ${JSON.stringify(version)}\nfiles:\n  - url: ${JSON.stringify(fileName)}\n    sha512: ${JSON.stringify(sha512)}\n    size: ${size}\npath: ${JSON.stringify(fileName)}\nsha512: ${JSON.stringify(sha512)}\nreleaseDate: ${JSON.stringify(new Date().toISOString())}\n`);
  packages.push({ version, output, files, size, sha512 });
}
await mkdir('artifacts/g05', { recursive: true });
await writeFile('artifacts/g05/packages.json', JSON.stringify({ runId, profile, appId: 'local.codex-dog.g05-test', executable: 'CodexDogG05.exe', repository: 'crankfreedom/codex-dog', unsignedTestOnly: true, formallyPublished: false, packages }, null, 2));
// 根 out 恢复开发版本，安装版自带各自冻结的 main/worker/CLI。
await command(['scripts/build.mjs'], {});
console.log('两版测试安装包已生成；publish=never，未上传或创建 Release。');
