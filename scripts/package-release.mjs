import { build, Platform, Arch } from 'electron-builder';
import { mkdir, writeFile, cp, stat, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { releasePolicy } from '../build/release-policy.mjs';

const runId = randomUUID().slice(0, 8);
const policy = releasePolicy(process.env.DOG_RELEASE_MODE ?? 'preview', process.env.DOG_RELEASE_VERSION ?? '0.6.0-beta.1', runId, process.env);
if (policy.signing.forceCodeSigning) await access(resolve('build/icon.ico')).catch(() => { throw new Error('RELEASE_ICON_NOT_CONFIGURED'); });
if (process.argv.includes('--check')) { console.log(JSON.stringify({ mode: policy.mode, version: policy.version, appId: policy.appId, channel: policy.channel, signed: policy.signing.forceCodeSigning, publish: 'never' })); process.exit(0); }
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前只支持 Windows x64 构建');
async function command(executable, args, variables = {}) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(executable, args, { env: { ...process.env, ...variables }, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolveCall() : reject(new Error('发行构建步骤失败')));
  });
}
const root = resolve('.cache/g06', runId); const app = join(root, 'app'); const resources = join(root, 'resources');
const output = resolve('release/g06', policy.mode, policy.version, runId);
await mkdir(app, { recursive: true }); await mkdir(resources, { recursive: true });
const cli = join(resources, 'codex-dog.exe');
try {
  await command(process.execPath, ['scripts/build.mjs'], { DOG_BUILD_VERSION: policy.version });
  await command(process.execPath, ['scripts/pack-cli.mjs'], { DOG_CLI_OUTPUT: cli });
  await cp('out', join(app, 'out'), { recursive: true });
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'codex-dog-' + policy.mode, version: policy.version, productName: policy.productName, main: 'out/main.cjs', description: 'Codex Dog 发行准备；当前仅模拟数据', author: 'crankfreedom', private: true }));
  await writeFile(join(resources, 'dog-distribution.json'), JSON.stringify(policy.manifest));
  await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', config: {
    appId: policy.appId, productName: policy.productName, executableName: policy.executableName,
    directories: { app, output, buildResources: resolve('build') }, electronVersion: '45.0.0', electronDist: resolve('node_modules/electron/dist'),
    npmRebuild: false, asar: true, asarUnpack: ['out/windows-pipe.ps1'], files: ['out/**', 'package.json', '!out/*.meta.json'], compression: 'normal',
    forceCodeSigning: policy.signing.forceCodeSigning,
    extraResources: [{ from: cli, to: 'cli/codex-dog.exe' }, { from: join(resources, 'dog-distribution.json'), to: 'dog-distribution.json' }, { from: resolve('build/cli-file-guard.ps1'), to: 'cli-file-guard.ps1' }, { from: resolve('build/verify-signature.ps1'), to: 'verify-signature.ps1' }],
    win: { target: ['nsis'], artifactName: policy.artifactName, signAndEditExecutable: true, ...(policy.signing.forceCodeSigning ? { icon: resolve('build/icon.ico') } : {}), ...policy.signing.win },
    nsis: { oneClick: true, perMachine: false, allowElevation: false, runAfterFinish: false, createDesktopShortcut: false, createStartMenuShortcut: false, deleteAppDataOnUninstall: false, include: resolve('build/installer.nsh'), differentialPackage: false, packElevateHelper: false },
    publish: [{ provider: 'github', owner: 'crankfreedom', repo: 'codex-dog', releaseType: 'draft', channel: policy.channel === 'stable' ? 'latest' : 'beta' }],
    afterPack: async context => { if (policy.signing.forceCodeSigning) await context.packager.sign(join(context.appOutDir, 'resources/cli/codex-dog.exe')); },
  } });
  const name = policy.artifactName.replace('${version}', policy.version).replace('${ext}', 'exe'); const installer = join(output, name);
  const size = (await stat(installer)).size; const hash = createHash('sha512'); for await (const chunk of createReadStream(installer)) hash.update(chunk); const sha512 = hash.digest('base64');
  if (policy.signing.forceCodeSigning) {
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    for (const file of [installer, join(output, 'win-unpacked', policy.executableName + '.exe'), join(output, 'win-unpacked/resources/cli/codex-dog.exe')]) await command(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve('build/verify-signature.ps1'), '-FilePath', file, '-PublisherName', policy.manifest.publisherName]);
  }
  // 预览产物不提供客户端更新清单，避免无签名构建被误当作正式更新。
  if (policy.signing.forceCodeSigning) await writeFile(join(output, policy.channel === 'stable' ? 'latest.yml' : 'beta.yml'), `version: ${JSON.stringify(policy.version)}\nfiles:\n  - url: ${JSON.stringify(name)}\n    sha512: ${JSON.stringify(sha512)}\n    size: ${size}\npath: ${JSON.stringify(name)}\nsha512: ${JSON.stringify(sha512)}\n`);
  else { const { unlink } = await import('node:fs/promises'); for (const name of ['latest.yml', 'beta.yml']) await unlink(join(output, name)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  await mkdir('artifacts/g06', { recursive: true });
  await writeFile('artifacts/g06/package.json', JSON.stringify({ result: 'passed', runId, mode: policy.mode, version: policy.version, appId: policy.appId, executable: policy.executableName + '.exe', profile: policy.manifest.profile, installer, output, size, sha512, signed: policy.signing.forceCodeSigning, source: 'fixture-only', published: false }, null, 2));
  console.log('发行准备包已生成；publish=never，未上传或发布。');
} finally { await command(process.execPath, ['scripts/build.mjs']); }
