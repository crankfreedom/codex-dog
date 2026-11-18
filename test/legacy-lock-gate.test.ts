import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,existsSync,readFileSync,readdirSync,writeFileSync,renameSync,mkdirSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {LegacyLockGate} from '../packages/infrastructure/legacy-lock-gate.ts';
const directory=()=>mkdtempSync(join(realpathSync.native(tmpdir()),'dog-readonly-lock-中文 空格-'));
const file=(dir:string,target:string)=>join(dir,createHash('sha256').update(target).digest('hex')+'.lock');
const legacySource=resolve(process.env.DOG_LEGACY_SOURCE??'../codex-resume/src/store.ts');

test('只读门禁构造及缺目录检查不创建路径，空目录不冒充真实旧进程绑定',()=>{
 const root=directory(),missing=join(root,'absent'),targetId=randomUUID(),gate=new LegacyLockGate();assert(!existsSync(missing));const absent=gate.inspect({directory:missing,targetId});assert.equal(absent.lockAvailability,'unknown');assert(!existsSync(missing));
 const empty=gate.inspect({directory:root,targetId});assert.equal(empty.lockAvailability,'free');assert.equal(empty.legacyDirectoryBinding,'unknown');assert.equal(empty.status,'unknown');assert.equal(empty.atomicExclusionAcquired,false);assert.deepEqual(readdirSync(root),[]);
 assert.equal(gate.inspect({directory:'relative',targetId}).lockAvailability,'unknown');assert.equal(gate.inspect({directory:'//server/share',targetId}).lockAvailability,'unknown');assert.equal(gate.inspect({directory:root,targetId:targetId.toUpperCase()}).lockAvailability,'unknown');
});

test('严格读取旧 pid/token 协议，活持有者与已退出持有者都不回收，返回不含原 token',()=>{
 const root=directory(),targetId=randomUUID(),path=file(root,targetId),token=randomUUID(),raw=JSON.stringify({pid:process.pid,token});writeFileSync(path,raw);const gate=new LegacyLockGate(),held=gate.inspect({directory:root,targetId});assert.equal(held.status,'blocked');assert.equal(held.lockAvailability,'held');assert.equal(held.holder!.state,'running');assert(!JSON.stringify(held).includes(token));assert.equal(readFileSync(path,'utf8'),raw);
 const stale=new LegacyLockGate({ownerState:()=> 'exited'}).inspect({directory:root,targetId});assert.equal(stale.lockAvailability,'held');assert(stale.reasons.includes('existing_lock_owner_exited_no_reclaim'));assert.equal(readFileSync(path,'utf8'),raw);
 const denied=new LegacyLockGate({ownerState:()=>{throw Error('denied');}}).inspect({directory:root,targetId});assert.equal(denied.holder!.state,'unknown');assert.equal(denied.lockAvailability,'held');assert.equal(readFileSync(path,'utf8'),raw);
});

test('损坏、额外字段、超限及硬链接锁保留为 unknown，不读取为正常空闲',()=>{
 for(const raw of ['{bad',JSON.stringify({pid:-1,token:randomUUID()}),JSON.stringify({pid:process.pid,token:randomUUID(),extra:true}),'x'.repeat(4097)]){const root=directory(),targetId=randomUUID(),path=file(root,targetId);writeFileSync(path,raw);assert.equal(new LegacyLockGate().inspect({directory:root,targetId}).lockAvailability,'unknown');assert.equal(readFileSync(path,'utf8'),raw);}
 const root=directory(),targetId=randomUUID(),path=file(root,targetId),alias=join(root,'alias');writeFileSync(alias,JSON.stringify({pid:process.pid,token:randomUUID()}));linkSync(alias,path);assert.equal(new LegacyLockGate().inspect({directory:root,targetId}).lockAvailability,'unknown');assert(existsSync(path));assert(existsSync(alias));
});

test('锁读取期间文件/目录被替换时 unknown，先前目录身份不能跨替换复用',()=>{
 const root=directory(),targetId=randomUUID(),path=file(root,targetId);writeFileSync(path,JSON.stringify({pid:process.pid,token:randomUUID()}));
 const changed=new LegacyLockGate({ownerState:()=>{renameSync(path,path+'.original');writeFileSync(path,JSON.stringify({pid:process.pid,token:randomUUID()}));return'running';}}).inspect({directory:root,targetId});assert.equal(changed.lockAvailability,'unknown');assert(existsSync(path+'.original'));assert(existsSync(path));
 const parent=directory(),selected=join(parent,'locks');mkdirSync(selected);const gate=new LegacyLockGate(),before=gate.inspect({directory:selected,targetId});renameSync(selected,selected+'.old');mkdirSync(selected);const after=gate.inspect({directory:selected,targetId,expectedDirectoryIdentity:before.directoryIdentity!});assert.equal(after.lockAvailability,'unknown');assert(after.reasons.includes('directory_identity_unverified'));assert.deepEqual(readdirSync(selected),[]);
 const replacedRoot=directory(),sub=join(replacedRoot,'locks');mkdirSync(sub);const subFile=file(sub,targetId);writeFileSync(subFile,JSON.stringify({pid:process.pid,token:randomUUID()}));let moved=false;const swapped=new LegacyLockGate({ownerState:()=>{try{renameSync(sub,sub+'.old');moved=true;}catch{return'unknown';}mkdirSync(sub);writeFileSync(file(sub,targetId),JSON.stringify({pid:process.pid,token:randomUUID()}));return'running';}}).inspect({directory:sub,targetId});if(moved){assert.equal(swapped.lockAvailability,'unknown');assert(existsSync(file(sub+'.old',targetId)));}else{assert.equal(swapped.lockAvailability,'held');assert.equal(swapped.holder!.state,'unknown');assert(existsSync(subFile));}
});

test('父目录 junction/symlink 不能把另一目录或文件伪装为共享锁位置',()=>{
 const parent=directory(),real=join(parent,'real');mkdirSync(real);const alias=join(parent,'alias');symlinkSync(real,alias,process.platform==='win32'?'junction':'dir');const nested=join(real,'locks');mkdirSync(nested);const result=new LegacyLockGate().inspect({directory:join(alias,'locks'),targetId:randomUUID()});assert.equal(result.lockAvailability,'unknown');assert.equal(result.directoryIdentity,null);assert.deepEqual(readdirSync(nested),[]);
});

test('真实独立新版进程原子持锁期间只读检查为 held，释放后为 free 但真实目录绑定仍未知',async()=>{
 const root=directory(),targetId=randomUUID(),child=fork(new URL('./helpers/lock-holder.mjs',import.meta.url),['new',root,targetId,'unused'],{stdio:['ignore','ignore','pipe','ipc']});child.stderr?.resume();const timer=setTimeout(()=>child.kill(),15000);try{await once(child,'message');const waiting=once(child,'message');child.send('acquire');const acquired=(await waiting)[0];assert(acquired.acquired);const gate=new LegacyLockGate();assert.equal(gate.inspect({directory:root,targetId}).lockAvailability,'held');const ended=once(child,'exit');child.send('release');await ended;const released=gate.inspect({directory:root,targetId});assert.equal(released.lockAvailability,'free');assert.equal(released.legacyDirectoryBinding,'unknown');assert.equal(released.status,'unknown');}finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
});

test('旧源码 unlock 会回收已退出新持有者的锁，故旧桌面自动回收策略尚不能通过崩溃兼容门禁',{skip:existsSync(legacySource)?false:'未提供旧源码；此处仅隔离验证旧 unlock，不冒充真实旧桌面门禁'},async()=>{
 const root=directory(),targetId=randomUUID(),path=file(root,targetId),holder=fork(new URL('./helpers/lock-holder.mjs',import.meta.url),['new',root,targetId,'unused'],{stdio:['ignore','ignore','pipe','ipc']});holder.stderr?.resume();let old:ReturnType<typeof fork>|undefined;const timer=setTimeout(()=>{holder.kill();old?.kill();},15000);
 try{await once(holder,'message');const waiting=once(holder,'message');holder.send('acquire');assert((await waiting)[0].acquired);const ended=once(holder,'exit');holder.send('crash');await ended;assert(existsSync(path));const inspector=new LegacyLockGate(),before=inspector.inspect({directory:root,targetId});assert.equal(before.lockAvailability,'held');assert.equal(before.holder!.state,'exited');
 old=fork(new URL('./helpers/legacy-unlock-fixture.mjs',import.meta.url),[root,targetId,legacySource],{stdio:['ignore','ignore','pipe','ipc']});old.stderr?.resume();const message=await once(old,'message'),oldEnded=once(old,'exit');assert.equal(message[0].oldUnlockRemovedDeadOwner,true);await oldEnded;assert(!existsSync(path));const after=inspector.inspect({directory:root,targetId});assert.equal(after.lockAvailability,'free');assert.equal(after.status,'unknown');assert.equal(after.legacyCrashRecoveryCompatibility,'unknown');assert(after.reasons.includes('legacy_stale_reclaim_policy_unverified'));
 }finally{clearTimeout(timer);if(holder.exitCode===null)holder.kill();if(old&&old.exitCode===null)old.kill();}
});
