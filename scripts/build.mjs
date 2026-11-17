import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse, compileScript } from '@vue/compiler-sfc';

await mkdir('out/renderer', { recursive: true });
for (const [name, entry] of Object.entries({ main: 'apps/desktop/main.ts', worker: 'apps/desktop/worker.ts', preload: 'apps/desktop/preload.ts', cli: 'apps/cli/main.ts' })) {
  const result = await build({ entryPoints: [entry], outfile: `out/${name}.cjs`, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], define: { __DOG_BUILD_VERSION__: JSON.stringify(process.env.DOG_BUILD_VERSION ?? JSON.parse(await (await import('node:fs/promises')).readFile('package.json', 'utf8')).version) }, metafile: true, sourcemap: false });
  await writeFile(`out/${name}.meta.json`, JSON.stringify(result.metafile, null, 2));
}
await build({ entryPoints: ['apps/desktop/renderer/renderer.ts'], outfile: 'out/renderer/renderer.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', minify: true,
  define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  plugins: [{ name: 'vue-sfc', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
    const { descriptor, errors } = parse(await readFile(path, 'utf8'), { filename: path }); if (errors.length) throw errors[0];
    const result = compileScript(descriptor, { id: path, inlineTemplate: true }); return { contents: result.content, loader: 'ts', resolveDir: (await import('node:path')).dirname(path) };
  }); } }], metafile: true }).then(async result => writeFile('out/renderer.meta.json', JSON.stringify(result.metafile, null, 2)));
for (const file of ['index.html', 'style.css']) await copyFile(resolve('apps/desktop/renderer', file), resolve('out/renderer', file));
await copyFile('packages/infrastructure/windows-pipe.ps1', 'out/windows-pipe.ps1');
console.log('阶段 3 构建完成：只读设置、诊断、历史及统一桌面。');
