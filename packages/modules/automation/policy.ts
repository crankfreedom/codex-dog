import type {Task} from './ports.ts';
export function inWindow(config:Task['config'],now:number){
 if(config.expiresAt&&Date.parse(config.expiresAt)<=now)return false;
 const window=config.dailyWindow;if(window.allDay)return true;
 const date=new Date(now),minute=date.getHours()*60+date.getMinutes(),parse=(x:string)=>Number(x.slice(0,2))*60+Number(x.slice(3));
 const start=parse(window.start),end=parse(window.end);return start<end?minute>=start&&minute<end:minute>=start||minute<end;
}
