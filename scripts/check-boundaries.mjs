import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const metas = {};
for (const name of ['cli', 'main', 'worker', 'preload']) metas[name] = JSON.parse(await readFile(`out/${name}.meta.json`, 'utf8'));
const cliInputs = Object.keys(metas.cli.inputs);
assert(!cliInputs.some(path => /packages\/(app|modules)\/|fixture-usage|apps\/desktop/.test(path)), 'CLI 不得打包业务实现或模拟数据源');
assert(Object.keys(metas.worker.inputs).some(path => path.endsWith('packages/app/registry.ts')));
assert(!Object.keys(metas.main.inputs).some(path => /modules\/quota|fixture-usage/.test(path)), '主进程不能复制额度业务');
assert(!cliInputs.some(path => /sqlite-store|target-lease|persisted-usage/.test(path)), 'CLI 不能持有数据库或目标租约');
assert(!cliInputs.some(path => /codex-desktop-readonly|codex-goal-readonly/.test(path)), 'CLI 不得自行读取真实 Codex');
assert(!Object.keys(metas.main.inputs).some(path => /sqlite-store/.test(path)), '主进程不能持有业务数据库');
assert(Object.keys(metas.worker.inputs).some(path => path.endsWith('sqlite-store.ts')), '业务 worker 必须持有持久层');
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = `${directory}/${item.name}`;
    if (item.isDirectory()) await scan(file);
    else if (file.endsWith('.ts')) {
      const text = await readFile(file, 'utf8');
      assert(!/codex-resume|auth\.json/.test(text), `${file} 不得导入旧实现或读取认证文件`);
      if (!file.endsWith('codex-desktop-readonly.ts')) assert(!/codex-app-tools-/.test(text), `${file} 只有只读适配器可连接桌面管道`);
      if (!file.endsWith('codex-goal-readonly.ts')) assert(!/goals_1\.sqlite/.test(text), `${file} 只有 Goal 只读适配器可定位源库`);
      if (file.endsWith('codex-desktop-readonly.ts')) assert(!/send_message|consume|resetCredit|app-server/.test(text), '桌面只读适配不得包含发送/消费/独立 App Server');
      if (file.startsWith('packages/modules/')) assert(!/from ['"](?:node:|electron|.*infrastructure|.*apps\/)/.test(text), `${file} 模块不得依赖基础设施`);
      if (file.startsWith('apps/desktop/renderer/') || file.endsWith('/preload.ts')) assert(!/child_process|spawn\(|exec\(/.test(text), `${file} 界面不能执行 CLI`);
    }
  }
}
await scan('apps'); await scan('packages');
console.log('通过：CLI 无业务副本、主进程无额度实现、模块依赖和模拟边界。');
