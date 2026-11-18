import {createHash} from 'node:crypto';
import {constants,closeSync,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {isAbsolute,join,normalize,parse,resolve,sep} from 'node:path';

export type LockOwnerState='running'|'exited'|'unknown';
export interface LegacyDirectoryIdentity {canonicalPath:string;device:string;inode:string;birthtimeNs:string}
export interface LegacyLockObservation {
 status:'blocked'|'unknown';
 legacyDirectoryBinding:'unknown';
 legacyCrashRecoveryCompatibility:'unknown';
 lockAvailability:'free'|'held'|'unknown';
 directoryIdentity:LegacyDirectoryIdentity|null;
 targetDigest:string|null;
 holder:{pid:number;state:LockOwnerState;tokenDigest:string}|null;
 reasons:string[];
 atomicExclusionAcquired:false;
 writesPerformed:false;
}
export interface LegacyLockSelection {directory:string;targetId:string;expectedDirectoryIdentity?:LegacyDirectoryIdentity}
interface Component {path:string;device:string;inode:string;birthtimeNs:string}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const missing=(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT';
function samePath(first:string,second:string){return process.platform==='win32'?first.toLowerCase()===second.toLowerCase():first===second;}
function component(path:string,stats:BigIntStats):Component{return{path,device:String(stats.dev),inode:String(stats.ino),birthtimeNs:String(stats.birthtimeNs)};}
function sameComponent(first:Component,second:Component){return samePath(first.path,second.path)&&first.device===second.device&&first.inode===second.inode&&first.birthtimeNs===second.birthtimeNs;}
function sameFile(first:BigIntStats,second:BigIntStats){return first.dev===second.dev&&first.ino===second.ino&&first.birthtimeNs===second.birthtimeNs&&first.size===second.size&&first.mtimeNs===second.mtimeNs&&first.nlink===second.nlink;}
function plainFile(stats:BigIntStats){return stats.isFile()&&!stats.isSymbolicLink()&&stats.nlink===1n&&stats.size>0n&&stats.size<=4096n;}
function inspectParents(directory:string){
 const normalized=normalize(directory),root=parse(normalized).root;let current=root;const paths=[root];for(const part of normalized.slice(root.length).split(sep).filter(Boolean)){current=join(current,part);paths.push(current);}
 const components=paths.map(path=>{const stats=lstatSync(path,{bigint:true});if(stats.isSymbolicLink()||!stats.isDirectory()||stats.ino===0n)throw Error('unsafe_directory');return component(path,stats);});
 const canonical=realpathSync.native(normalized);if(!samePath(resolve(canonical),resolve(normalized)))throw Error('directory_alias');
 return{components,canonicalPath:canonical};
}
function defaultOwnerState(pid:number):LockOwnerState{try{process.kill(pid,0);return'running';}catch(error){return!!error&&typeof error==='object'&&'code'in error&&error.code==='ESRCH'?'exited':'unknown';}}

/** Read-only filesystem facts. They cannot establish an old process's effective environment or grant a send. */
export class LegacyLockGate {
 private ownerState:(pid:number)=>LockOwnerState;
 constructor(options:{ownerState?:(pid:number)=>LockOwnerState}={}){this.ownerState=options.ownerState??defaultOwnerState;}
 inspect(selection:LegacyLockSelection):LegacyLockObservation{
  const result:LegacyLockObservation={status:'unknown',legacyDirectoryBinding:'unknown',legacyCrashRecoveryCompatibility:'unknown',lockAvailability:'unknown',directoryIdentity:null,targetDigest:null,holder:null,reasons:['legacy_runtime_directory_unverified','legacy_stale_reclaim_policy_unverified'],atomicExclusionAcquired:false,writesPerformed:false};
  if(!isAbsolute(selection.directory)||selection.directory.replaceAll('/','\\').startsWith('\\\\')||!uuid.test(selection.targetId)){result.reasons.push('explicit_local_directory_and_canonical_target_required');return result;}
  result.targetDigest=digest(selection.targetId);
  let before:ReturnType<typeof inspectParents>;
  try{before=inspectParents(selection.directory);const last=before.components.at(-1)!;result.directoryIdentity={canonicalPath:before.canonicalPath,device:last.device,inode:last.inode,birthtimeNs:last.birthtimeNs};if(selection.expectedDirectoryIdentity){const old=selection.expectedDirectoryIdentity,current=result.directoryIdentity;if(!samePath(old.canonicalPath,current.canonicalPath)||old.device!==current.device||old.inode!==current.inode||old.birthtimeNs!==current.birthtimeNs)throw Error('directory_identity_changed');}}
  catch(error){result.reasons.push(missing(error)?'directory_missing':'directory_identity_unverified');return result;}
  const file=join(selection.directory,result.targetDigest+'.lock');let first:BigIntStats|undefined;let fd:number|undefined;
  try{
   try{first=lstatSync(file,{bigint:true});}catch(error){if(!missing(error))throw error;}
   if(!first){result.lockAvailability='free';}
   else{
    if(!plainFile(first))throw Error('unsafe_lock_file');
    fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=fstatSync(fd,{bigint:true});if(!plainFile(opened)||!sameFile(first,opened))throw Error('lock_changed_before_read');
    const bytes=Buffer.alloc(4097),count=readSync(fd,bytes,0,bytes.length,0);if(count!==Number(opened.size)||count>4096)throw Error('lock_changed_during_read');
    const raw:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)));
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==2||!('pid'in raw)||!Number.isSafeInteger(raw.pid)||Number(raw.pid)<1||Number(raw.pid)>2147483647||!('token'in raw)||typeof raw.token!=='string'||!uuid.test(raw.token))throw Error('invalid_lock_record');
    let state:LockOwnerState;try{state=this.ownerState(Number(raw.pid));}catch{state='unknown';}if(!['running','exited','unknown'].includes(state))state='unknown';
    const settled=fstatSync(fd,{bigint:true}),current=lstatSync(file,{bigint:true});if(!plainFile(current)||!sameFile(opened,settled)||!sameFile(opened,current))throw Error('lock_changed_during_observation');
    result.lockAvailability='held';result.holder={pid:Number(raw.pid),state,tokenDigest:digest(raw.token)};result.status='blocked';result.reasons.push(state==='exited'?'existing_lock_owner_exited_no_reclaim':state==='unknown'?'existing_lock_owner_unknown':'existing_lock_held');
   }
   const after=inspectParents(selection.directory);if(before.components.length!==after.components.length||before.components.some((item,index)=>!sameComponent(item,after.components[index]!))||!samePath(before.canonicalPath,after.canonicalPath))throw Error('directory_changed_during_observation');
   // A concurrent acquisition must not be reported as an unchanged free snapshot.
   if(!first){try{lstatSync(file);throw Error('lock_appeared_during_observation');}catch(error){if(!missing(error))throw error;}}
  }catch{result.status='unknown';result.lockAvailability='unknown';result.holder=null;result.reasons.push('lock_or_directory_changed_or_unverifiable');}
  finally{if(fd!==undefined)closeSync(fd);}
  return result;
 }
}
