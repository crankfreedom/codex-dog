import { join } from 'node:path';

export function windowsPowerShellPath(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
}
export function windowsPowerShellEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const name of Object.keys(environment)) {
    if (name.toLowerCase() === 'psmodulepath') delete environment[name];
  }
  return environment;
}
export function isWindowsPowerShell(executable: string): boolean {
  return /(?:^|[\\/])powershell\.exe$/i.test(executable);
}
