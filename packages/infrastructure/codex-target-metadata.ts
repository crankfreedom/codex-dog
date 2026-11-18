import {DatabaseSync,constants} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,join,normalize,parse,resolve,sep} from 'node:path';

export interface TargetMetadata {
 availability:'known'|'unknown';reason:string;found:boolean;creatorAccountBinding:string|null;
 goal:{availability:'known'|'unknown';current:{id:string;status:string}|null};
 latestTurn:{id:string;status:string;firstUserItemId:string|null}|null;
}
const unknown=(reason:string):TargetMetadata=>({availability:'unknown',reason,found:false,creatorAccountBinding:null,goal:{availability:'unknown',current:null},latestTurn:null});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const goalStates=new Set(['active','paused','blocked','usage_limited','budget_limited','complete']);
const turnStates=new Set(['inProgress','completed','failed','interrupted']);
function directoryIdentity(directory:string){
 if(!isAbsolute(directory)||directory.replaceAll('/','\\').startsWith('\\\\'))throw Error();
 const normalized=normalize(directory),root=parse(normalized).root;let current=root;const values=[];
 for(const part of [null,...normalized.slice(root.length).split(sep).filter(Boolean)]){if(part)current=join(current,part);const value=lstatSync(current,{bigint:true});if(!value.isDirectory()||value.isSymbolicLink()||value.ino===0n)throw Error();values.push([String(value.dev),String(value.ino),String(value.birthtimeNs)]);}
 const real=realpathSync.native(directory),equal=process.platform==='win32'?real.toLowerCase()===resolve(directory).toLowerCase():real===resolve(directory);if(!equal)throw Error();return JSON.stringify(values);
}
function fileIdentity(path:string){const value=lstatSync(path,{bigint:true});if(!value.isFile()||value.isSymbolicLink()||value.nlink!==1n||value.ino===0n)throw Error();return[String(value.dev),String(value.ino),String(value.birthtimeNs)].join(':');}
function columns(db:DatabaseSync,table:string,required:string[]){
 const kind=db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(table);if(kind?.type!=='table')throw Error();
 const actual=db.prepare('SELECT name,hidden FROM pragma_table_xinfo(?)').all(table);if(!required.every(name=>actual.some(row=>row.name===name&&row.hidden===0)))throw Error();
 if(typeof db.setAuthorizer!=='function')throw Error();
 db.setAuthorizer((action,first,second)=>action===constants.SQLITE_SELECT||action===constants.SQLITE_READ&&first===table&&typeof second==='string'&&required.includes(second)?constants.SQLITE_OK:constants.SQLITE_DENY);
}

/** Fixed metadata projections only: no preview, first_user_message, item_json, error_json or objective. */
export class CodexTargetMetadata {
 private directory:string;private pinnedDirectory?:string;
 constructor(directory:string){this.directory=directory;}
 private readFile<T>(name:string,read:(db:DatabaseSync)=>T):T{
  const path=join(this.directory,name),before=fileIdentity(path);const db=new DatabaseSync(path,{readOnly:true});
  try{db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');const value=read(db);if(fileIdentity(path)!==before)throw Error();return value;}finally{db.close();}
 }
 private sample(threadId:string):TargetMetadata{
  const thread=this.readFile('state_5.sqlite',db=>{columns(db,'threads',['id','creator_account_id']);return db.prepare('SELECT id,creator_account_id FROM threads WHERE id=? LIMIT 2').all(threadId);});
  if(!thread.length)return{...unknown('TARGET_METADATA_NOT_FOUND'),availability:'known'};
  if(thread.length!==1||thread[0]!.id!==threadId)throw Error();const owner=thread[0]!.creator_account_id;
  if(owner!==null&&(typeof owner!=='string'||!owner||owner.length>512))throw Error();
  let goal:TargetMetadata['goal']={availability:'unknown',current:null};
  try{goal=this.readFile('goals_1.sqlite',db=>{columns(db,'thread_goals',['thread_id','goal_id','status']);const rows=db.prepare('SELECT goal_id,status FROM thread_goals WHERE thread_id=? LIMIT 2').all(threadId);if(!rows.length)return{availability:'known' as const,current:null};if(rows.length!==1||typeof rows[0]!.goal_id!=='string'||!rows[0]!.goal_id||rows[0]!.goal_id.length>512||typeof rows[0]!.status!=='string'||!goalStates.has(rows[0]!.status))throw Error();return{availability:'known' as const,current:{id:rows[0]!.goal_id,status:rows[0]!.status}};});}catch{/* Missing or unsupported Goal metadata never means no Goal. */}
  let latestTurn:TargetMetadata['latestTurn']=null;
  const turns=this.readFile('thread_history_1.sqlite',db=>{columns(db,'thread_turns',['thread_id','turn_id','status','first_user_item_id','rollout_ordinal']);return db.prepare('SELECT turn_id,status,first_user_item_id FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC,turn_id DESC LIMIT 1').all(threadId);});
  if(turns.length){const row=turns[0]!;if(typeof row.turn_id!=='string'||!row.turn_id||row.turn_id.length>512||typeof row.status!=='string'||!turnStates.has(row.status)||row.first_user_item_id!==null&&(typeof row.first_user_item_id!=='string'||row.first_user_item_id.length>512))throw Error();latestTurn={id:row.turn_id,status:row.status,firstUserItemId:row.first_user_item_id as string|null};}
  return{availability:'known',reason:'LOCAL_METADATA_ONLY',found:true,creatorAccountBinding:typeof owner==='string'?createHash('sha256').update(owner).digest('hex'):null,goal,latestTurn};
 }
 read(threadId:string):TargetMetadata{
  if(!uuid.test(threadId))return unknown('INVALID_CANONICAL_TARGET');
  try{const before=directoryIdentity(this.directory);if(this.pinnedDirectory&&before!==this.pinnedDirectory)return unknown('METADATA_DIRECTORY_CHANGED');this.pinnedDirectory??=before;const first=this.sample(threadId),second=this.sample(threadId);if(JSON.stringify(first)!==JSON.stringify(second)||directoryIdentity(this.directory)!==before)return unknown('METADATA_CHANGED_DURING_READ');return second;}catch{return unknown('TARGET_METADATA_UNAVAILABLE');}
 }
}
