import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TargetLeaseAdapter } from '../../packages/infrastructure/target-lease.ts';

const [mode, directory, target, source] = process.argv.slice(2);
let release;
process.on('message', message => {
  if (message === 'release') { try { release?.(); process.send({ released: true }); } catch { process.send({ released: false }); } finally { process.exit(0); } }
  if (message === 'crash') process.exit(41);
  if (message === 'acquire') acquire();
});
async function acquire() {
  try {
    if (mode === 'legacy') {
      process.env.CODEX_RESUME_LOCK_DIR = directory;
      const { FileJournal } = await import(pathToFileURL(source).href);
      release = new FileJournal(join(directory, `fixture-job-${process.pid}.json`), false).lock(target);
    } else {
      const locks = new TargetLeaseAdapter({ directory, verified: true }); locks.start(); const lease = locks.acquire(target); release = () => locks.release(lease);
    }
    process.send({ acquired: true, pid: process.pid });
  } catch { process.send({ acquired: false, pid: process.pid }); process.exit(0); }
}
process.send({ listening: true });
