import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('out/renderer', { recursive: true });
for (const [name, entry] of Object.entries({ main: 'apps/desktop/main.ts', worker: 'apps/desktop/worker.ts', preload: 'apps/desktop/preload.ts', cli: 'apps/cli/main.ts' })) {
  const result = await build({ entryPoints: [entry], outfile: `out/${name}.cjs`, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], define: { __DOG_BUILD_VERSION__: JSON.stringify(process.env.DOG_BUILD_VERSION ?? JSON.parse(await (await import('node:fs/promises')).readFile('package.json', 'utf8')).version) }, metafile: true, sourcemap: false });
  await writeFile(`out/${name}.meta.json`, JSON.stringify(result.metafile, null, 2));
}
await build({ entryPoints: ['apps/desktop/renderer/renderer.ts'], outfile: 'out/renderer/renderer.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome130' });
for (const file of ['index.html', 'style.css']) await copyFile(resolve('apps/desktop/renderer', file), resolve('out/renderer', file));
await copyFile('packages/infrastructure/windows-pipe.ps1', 'out/windows-pipe.ps1');
console.log('G06 构建完成：发行策略、签名门禁及既有统一入口。');
