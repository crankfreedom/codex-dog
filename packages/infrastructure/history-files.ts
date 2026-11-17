import { mkdir,lstat,realpath,open,link,unlink,stat } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHmac,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { CursorPayload,ExportFiles,ExportSink } from '../modules/history/service.ts';
import { Stage3Error } from '../modules/persistence/stage3-ports.ts';
import type { ExportOperation } from '../modules/persistence/stage3-ports.ts';
const payloadSchema=z.object({version:z.literal(1),boundary:z.number().int().nonnegative(),after:z.number().int().nonnegative(),filterHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(v=>v.after<=v.boundary);
export class HistoryCursorCodec {
  private key:string;constructor(key:string){this.key=key;}
  encode(payload:CursorPayload){const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return body+'.'+createHmac('sha256',this.key).update(body).digest('hex');}
  decode(value:string):CursorPayload{try{const [body,mac,...rest]=value.split('.');if(!body||!mac||rest.length||!/^[a-f0-9]{64}$/.test(mac))throw new Error();const expected=createHmac('sha256',this.key).update(body).digest();if(!timingSafeEqual(expected,Buffer.from(mac,'hex')))throw new Error();return payloadSchema.parse(JSON.parse(Buffer.from(body,'base64url').toString('utf8')));}catch{throw new Stage3Error('INVALID_ARGUMENT','历史游标无效或已损坏');}}
}
export class LocalHistoryFiles implements ExportFiles {
  private directory:string;private root:string;
  constructor(profile:string){this.root=resolve(profile);this.directory=join(this.root,'exports');}
  private async check(){const entry=await lstat(this.directory);if(!entry.isDirectory()||entry.isSymbolicLink()||await realpath(this.directory)!==join(await realpath(this.root),'exports'))throw new Stage3Error('STORAGE_FAILURE','导出目录不是本应用固定目录');}
  private id(value:string){if(!z.string().uuid().safeParse(value).success)throw new Stage3Error('INVALID_ARGUMENT','导出操作标识无效');return value;}
  async start(){await mkdir(this.directory,{recursive:true});await this.check();}
  async recover(operations:ExportOperation[]){await this.check();for(const operation of operations){
    const temporary=join(this.directory,'.'+this.id(operation.id)+'.tmp');
    const info=await stat(temporary).catch(()=>undefined);
    if(info&&operation.state!=='succeeded'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.jsonl$/.test(operation.targetName)){
      const destination=join(this.directory,operation.targetName);const final=await stat(destination).catch(()=>undefined);
      if(final&&final.dev===info.dev&&final.ino===info.ino)await unlink(destination);
    }
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }}
  async open(id:string,output?:string):Promise<ExportSink>{
    await this.check();id=this.id(id);if(output&&!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.jsonl$/.test(output))throw new Stage3Error('INVALID_ARGUMENT','只接受安全 JSONL 文件名');
    const temporary=join(this.directory,'.'+id+'.tmp'),fileName=output??id+'.jsonl',destination=join(this.directory,fileName);
    const handle=await open(temporary,'wx',0o600);const identity=await handle.stat();let closed=false,published=false;
    const close=async()=>{if(!closed){closed=true;await handle.close();}};
    return {append:async text=>{await handle.writeFile(text);},publish:async()=>{await this.check();await handle.sync();await close();try{await link(temporary,destination);published=true;}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Stage3Error('EXPORT_TARGET_EXISTS','导出目标已存在，未覆盖');throw error;}return fileName;},complete:async()=>{await this.check();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});},discard:async()=>{await close();await this.check();if(published){const current=await stat(destination).catch(()=>undefined);if(current&&current.dev===identity.dev&&current.ino===identity.ino)await unlink(destination);}await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}};
  }
}
