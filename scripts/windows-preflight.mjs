import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { release,tmpdir } from 'node:os';
import {realpathSync} from 'node:fs';
import { windowsPowerShellEnvironment } from '../packages/infrastructure/windows-powershell.ts';

const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const command = "@{psVersion=$PSVersionTable.PSVersion.ToString();userInteractive=[Environment]::UserInteractive;sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;executionPolicy=(Get-ExecutionPolicy).ToString()} | ConvertTo-Json -Compress";
const value = JSON.parse(execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { env: windowsPowerShellEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }));
const temporaryPath=tmpdir(),canonicalTemporaryPath=realpathSync.native(temporaryPath);
const report = { tempPathCanonical:temporaryPath.toLowerCase()===canonicalTemporaryPath.toLowerCase(), osVersion: release(), nodeVersion: process.versions.node, systemPowerShellVersion: String(value.psVersion).slice(0, 30), interactive: value.userInteractive === true, sessionId: Number.isSafeInteger(value.sessionId) ? value.sessionId : null, executionPolicy: ['Unrestricted', 'RemoteSigned', 'AllSigned', 'Restricted', 'Default', 'Bypass', 'Undefined'].includes(value.executionPolicy) ? value.executionPolicy : 'Unknown', policyModified: false };
await mkdir('artifacts/g06', { recursive: true });
await writeFile('artifacts/g06/windows-preflight.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
