import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { windowsPowerShellEnvironment, windowsPowerShellPath } from '../packages/infrastructure/windows-powershell.ts';

test('系统 PowerShell 子进程移除不区分大小写的 PSModulePath，保留其他环境且不修改父进程', () => {
  const original = { PSModulePath: 'pwsh7', PSMODULEPATH: 'duplicate', PATH: 'retained', LOCALAPPDATA: 'retained-local' };
  assert.deepEqual(windowsPowerShellEnvironment(original), { PATH: 'retained', LOCALAPPDATA: 'retained-local' }); assert.equal(original.PSModulePath, 'pwsh7');
});

test('真实 Windows 管道 ACL 接受管理员 SID 别名，但拒绝增加其他允许主体', { skip: process.platform !== 'win32' }, () => {
  const value = JSON.parse(execFileSync(windowsPowerShellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve('packages/infrastructure/windows-pipe.ps1'), '-Mode', 'AclSelfTest', '-PipeName', 'codex-dog-acl-fixture'], { env: windowsPowerShellEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 15000 }));
  assert.equal(value.serializedUsesAlias, true); assert.equal(value.correctAclAccepted, true); assert.equal(value.extraPrincipalRejected, true);
});
test('真实 Windows PowerShell 5.1 可解析 Security/Utility 原生命令，不降低执行策略', { skip: process.platform !== 'win32' }, () => {
  const script = "@{major=$PSVersionTable.PSVersion.Major;security=(Get-Command Get-ExecutionPolicy).ModuleName;utility=(Get-Command Add-Type).ModuleName} | ConvertTo-Json -Compress";
  const value = JSON.parse(execFileSync(windowsPowerShellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env: windowsPowerShellEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 15000 }));
  assert.equal(value.major, 5); assert.equal(value.security, 'Microsoft.PowerShell.Security'); assert.equal(value.utility, 'Microsoft.PowerShell.Utility');
});
