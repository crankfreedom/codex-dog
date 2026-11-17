import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { releasePolicy } from '../build/release-policy.mjs';

if (process.argv.includes('--environment')) {
  const environment = JSON.parse(execFileSync('gh', ['api', 'repos/crankfreedom/codex-dog/environments/codex-dog-signing'], { encoding: 'utf8', windowsHide: true }));
  assert(environment.protection_rules.some(rule => rule.type === 'required_reviewers' && rule.reviewers.length > 0), '签名环境必须先配置审批人，缺失时拒绝构建');
  console.log('签名环境审批规则存在；实际审批由 GitHub 执行。');
  process.exit(0);
}
for (const name of await readdir('.github/workflows')) {
  if (!name.endsWith('.yml')) continue;
  const text = await readFile('.github/workflows/' + name, 'utf8'); const document = parseDocument(text, { uniqueKeys: true }); assert.equal(document.errors.length, 0, name + ' YAML'); const value = document.toJS();
  assert.equal(value.permissions.contents, 'read'); assert(!value.on.release && !value.on.pull_request_target, '不使用发布事件或高权限 PR 入口');
  for (const job of Object.values(value.jobs)) {
    const installIndex = job.steps.findIndex(step => step.run === 'pnpm install:electron');
    const buildIndex = job.steps.findIndex(step => step.run === 'pnpm build');
    assert(installIndex >= 0 && installIndex < buildIndex, '必须在编译/实装之前显式准备 Electron 运行时');
    assert.equal(job['runs-on'], 'windows-2025'); assert(job['timeout-minutes'] <= 45);
    assert(!job.permissions, '当前不增加 job 写权限');
    for (const step of job.steps) {
      if (step.uses) assert(/^[\w/-]+@[a-f0-9]{40}$/.test(step.uses), 'Action 必须固定完整 SHA');
      assert(!/gh\s+release|--publish\s+(always|onTag)|git\s+(push|tag)|npm\s+publish/.test(step.run ?? ''), '当前流程只构建，不发布或建标签');
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
    }
  }
  if (name === 'windows-build.yml') {
    assert.deepEqual(Object.keys(value.on), ['workflow_dispatch']);
    assert.deepEqual(value.on.workflow_dispatch.inputs.mode.options, ['preview', 'signed-beta']);
    const job = value.jobs.package; assert(job.if.includes("refs/heads/main")); assert(job.environment.includes('codex-dog-signing'));
    assert(job.steps.some(step => step.run === 'node scripts/check-release.mjs --environment' && step.if === "inputs.mode == 'signed-beta'"));
  }
}
assert.throws(() => releasePolicy('signed-stable', '0.6.0', 'fixture'), /SIGNING_NOT_CONFIGURED/);
assert.throws(() => releasePolicy('preview', '0.6.0', 'fixture'), /CHANNEL_MISMATCH/);
const preview = releasePolicy('preview', '0.6.0-beta.1', 'fixture'); assert(!preview.signing.forceCodeSigning && preview.appId.endsWith('.preview'));
assert((await readFile('scripts/package-release.mjs', 'utf8')).includes("publish: 'never'"));
console.log('通过：发行身份、缺凭据阻断、YAML、Action SHA、只读权限、签名环境门禁及无 stable 发布入口。');
