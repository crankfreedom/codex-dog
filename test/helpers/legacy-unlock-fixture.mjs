import assert from 'node:assert/strict';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const [directory,target,source]=process.argv.slice(2);
assert(resolve(directory).startsWith(resolve(tmpdir())+sep));
assert(/^dog-readonly-lock-/.test(directory.split(sep).at(-1)));
assert(/^[a-f0-9-]{36}$/.test(target));
process.env.CODEX_RESUME_LOCK_DIR=directory;
const {FileJournal}=await import(pathToFileURL(resolve(source)).href);
const journal=new FileJournal(join(directory,'only-isolated-job.json'),false);
journal.save({version:1,id:randomUUID(),mode:'simulation',phase:'send_uncertain',targetThreadId:target,callerThreadId:randomUUID(),marker:randomUUID(),accountFingerprint:'isolated-fixture',prompt:'仅隔离测试，不发送',evidence:{},nextCheckAt:0,baselineTurnIds:[]});
let initiallyBlocked=false;
try{const release=journal.lock(target);release();}catch{initiallyBlocked=true;}
assert(initiallyBlocked);
journal.unlock();
const release=journal.lock(target);release();
process.send?.({initiallyBlocked,oldUnlockRemovedDeadOwner:true});
