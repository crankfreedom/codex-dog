import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const documents = ['README.md', 'PROJECT_PLAN.md', ...(await readdir('docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
assert((await readFile('PROJECT_PLAN.md', 'utf8')).split('\n').length <= 130, '总览保持精简，不重新堆入详细规范');
let combined = '';
for (const file of documents) {
  const text = await readFile(file, 'utf8'); combined += '\n' + text;
  assert(!text.includes('\uFFFD'), file);
  assert(text.split('\n').length >= 10, `${file} 内容不足以独立成文`);
  assert.equal(text.split('\n').filter(line => line.startsWith('~~~')).length % 2, 0, `${file} 围栏`);
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(match[1])) continue;
    await access(resolve(dirname(file), match[1].split('#')[0]));
  }
}
const rows = combined.split(/\r?\n/).filter(line => line.startsWith('| ')).map(line => line.split('|').slice(1, -1).map(value => value.trim()));
const counts = { M: 13, P: 18, C: 82, A: 40, G: 6, TX: 6 };
for (const [prefix, count] of Object.entries(counts)) {
  const pattern = new RegExp(`^${prefix}\\d{2}(?: |$)`);
  const ids = rows.filter(row => pattern.test(row[0])).map(row => row[0].match(new RegExp(`^${prefix}\\d{2}`))[0]);
  const start = prefix === 'M' ? 0 : 1;
  assert.deepEqual(ids, Array.from({ length: count }, (_, i) => prefix + String(i + start).padStart(2, '0')), `${prefix} 迁移完整且唯一`);
}
console.log('通过：总览体量、详细文档分工、链接、编号迁移及设计基线无遗漏。');
