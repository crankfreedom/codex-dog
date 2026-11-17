import { NsisUpdater } from 'electron-updater';
import { CancellationToken } from 'builder-util-runtime';
import { createHash } from 'node:crypto';
import { createReadStream, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { UpdateError } from '../update/ports.ts';
import type { UpdateArtifact, UpdateBackendPort, UpdateCandidate } from '../update/ports.ts';

export class WindowsUpdateBackend implements UpdateBackendPort {
  private options: { packaged: boolean; testDistribution: boolean; fixturePort?: number; executable: string; directory: string };
  private updater?: NsisUpdater;
  private token?: CancellationToken;
  private downloadedBytes = 0;
  constructor(options: WindowsUpdateBackend['options']) { this.options = options; }
  supported() { return process.platform === 'win32' && this.options.packaged && this.options.testDistribution; }
  start() {
    if (!this.supported()) return;
    const port = this.options.fixturePort;
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) throw new UpdateError('INVALID_ARGUMENT', '夹具端口无效');
    const feed = port === undefined ? { provider: 'github' as const, owner: 'crankfreedom', repo: 'codex-dog', channel: 'beta', private: false } : { provider: 'generic' as const, url: `http://127.0.0.1:${port}/`, channel: 'beta', useMultipleRangeRequest: false };
    this.updater = new NsisUpdater(feed);
    const config = join(this.options.directory, 'g05-updater-runtime.json');
    writeFileSync(config, JSON.stringify({ ...feed, updaterCacheDirName: `codex-dog-${basename(this.options.directory)}-${port === undefined ? 'github' : 'fixture'}-updater` }), { mode: 0o600 });
    this.updater.updateConfigPath = config;
    this.updater.logger = null; this.updater.on('error', () => {});
    this.updater.autoDownload = false; this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = true; this.updater.channel = 'beta'; this.updater.allowDowngrade = false;
    this.updater.disableDifferentialDownload = true;
    this.updater.on('download-progress', progress => { this.downloadedBytes = Math.max(this.downloadedBytes, progress.transferred); });
  }
  async check(): Promise<Omit<UpdateCandidate, 'id'> | null> {
    if (!this.updater) throw new UpdateError('UPDATE_UNSUPPORTED', '非 Windows G05 安装测试包');
    try {
      const result = await this.updater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) return null;
      const info = result.updateInfo;
      const files = info.files.filter(file => file.url.endsWith('.exe'));
      const expected = `Codex-Dog-G05-${info.version}-Setup.exe`;
      if (files.length !== 1 || files[0]!.url !== expected || typeof files[0]!.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(files[0]!.sha512) || !Number.isSafeInteger(files[0]!.size) || Number(files[0]!.size) < 1 || Number(files[0]!.size) > 1024 * 1024 * 1024) throw new UpdateError('UPDATE_METADATA_INVALID', '安装包元数据不完整或来源路径异常');
      return { version: info.version, fileName: expected, sha512: files[0]!.sha512, size: files[0]!.size! };
    } catch (error) { if (error instanceof UpdateError) throw error; throw new UpdateError('UPDATE_SOURCE_UNAVAILABLE', 'GitHub/夹具更新元数据不可用'); }
  }
  async download(candidate: UpdateCandidate): Promise<Omit<UpdateArtifact, 'id'>> {
    const found = await this.check();
    if (!found || found.version !== candidate.version || found.sha512 !== candidate.sha512 || found.fileName !== candidate.fileName || found.size !== candidate.size) throw new UpdateError('UPDATE_VERSION_REJECTED', '源版本或哈希已改变，须重新检查');
    this.token = new CancellationToken(); this.downloadedBytes = 0;
    try {
      const files = await this.updater!.downloadUpdate(this.token);
      if (files.length !== 1 || basename(files[0]!) !== candidate.fileName) throw new UpdateError('UPDATE_METADATA_INVALID', '下载产物路径不符合预期');
      const artifact = { version: candidate.version, path: files[0]!, sha512: candidate.sha512, size: candidate.size };
      await this.verify({ ...artifact, id: 'pending' }); return artifact;
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      throw new UpdateError(code.includes('CHECKSUM') || code.includes('SHA512') ? 'UPDATE_INTEGRITY_FAILED' : 'UPDATE_DOWNLOAD_FAILED', '安装包下载或完整性校验失败');
    } finally { this.token = undefined; }
  }
  async verify(artifact: UpdateArtifact) {
    try {
      if (basename(artifact.path) !== `Codex-Dog-G05-${artifact.version}-Setup.exe` || (await stat(artifact.path)).size !== artifact.size) throw new Error('路径/大小异常');
      const hash = createHash('sha512'); for await (const chunk of createReadStream(artifact.path)) hash.update(chunk);
      if (hash.digest('base64') !== artifact.sha512) throw new Error('哈希变化');
    } catch { throw new UpdateError('UPDATE_INTEGRITY_FAILED', '缓存安装包校验失败，旧程序继续运行'); }
  }
  async launchInstaller(artifact: UpdateArtifact, finalGuard: () => void) {
    await this.verify(artifact);
    finalGuard();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(artifact.path, ['--updated', '/S', '--force-run', `/D=${dirname(this.options.executable)}`], { detached: true, windowsHide: true, stdio: 'ignore' });
      child.once('error', () => reject(new UpdateError('UPDATE_INSTALL_FAILED', '无法启动已验证安装包')));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  }
  cancel() { this.token?.cancel(); }
  diagnostics() { return { provider: this.options.fixturePort === undefined ? 'github' : 'loopback-fixture', downloadedBytes: this.downloadedBytes }; }
}
