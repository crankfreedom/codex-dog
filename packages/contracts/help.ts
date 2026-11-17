import { helpGet,helpSearch } from './stage3.ts';
export const helpTopics=[
  {id:'overview',title:'只读桌面入门',text:'先启动 Codex Dog。关闭窗口继续驻托盘；明确退出停止端点和本实例子进程。CLI/MCP 不自动拉起应用。全新 profile 默认模拟。'},
  {id:'sources',title:'显式选择数据来源',text:'在连接与来源选择 fixture 或 live-readonly。保存仅下次启动生效。真实模式必须指定已有调用会话 UUID，多实例明确选择工具管道；断连不会自动换源。'},
  {id:'pairing',title:'客户端配对与撤销',text:'access request 默认只申请 read。桌面核对名称及六位配对码后批准。settings.manage、access.manage、app.manage 分别勾选，不能自授；撤销后后续调用拒绝。'},
  {id:'quota',title:'额度与只读刷新',text:'quota get 查询当前观察；quota refresh 显式刷新。观察三十秒过期，缺失、离线或未知不能当额度正常。额度自动刷新默认关闭，可在 monitoring 设置独立间隔，绝不调度任务。'},
  {id:'threads',title:'会话和 Goal 只读',text:'先明确连接，再分页读取会话身份和状态；选择目标读取详情和 Goal 元数据，不读取聊天正文或 Goal objective。unknown 与确认无 Goal 不同，跨源账号绑定未证实，不确认任务完成。'},
  {id:'settings',title:'设置、外观与临时预览',text:'settings get/update 仅支持 monitoring 和 appearance，分区独立修订，保存须 settings.manage、expectedRevision 和幂等键。预览不保存，离页或窗口隐藏后恢复已保存外观。'},
  {id:'diagnostics',title:'诊断结果的含义',text:'diagnostics run 只读当前额度快照、连接、存储和明确目标。passed、blocked、unknown、not_checked 分开；未选择目标不假装检查成功，不刷新额度、不推进任务。'},
  {id:'history',title:'历史查询和安全导出',text:'历史只记录本应用实际运行/设置事实，不是聊天历史。events query 使用固定边界和绑定过滤条件的游标。events export 写固定 exports 目录的 JSONL，不覆盖已有文件；operations get/list/cancel 普通客户端限本人；可信桌面及 app.manage 可管理本用户全部导出。'},
  {id:'limits',title:'当前能力边界',text:'当前为 Windows x64 未签名 Preview。没有真实发送、任务自动化、卡消费、正式签名或 stable 发行。真实结果和模拟证据分别记录；help get/search 为包内静态说明，离线结果不是宿主能力或业务状态。'},
] as const;
export function readStaticHelp(operation:string,raw:unknown){
  if(operation==='help.get'){const input=helpGet.parse(raw);return {topic:helpTopics.find(x=>x.id===input.topic),source:'package-static',hostStateIncluded:false};}
  const input=helpSearch.parse(raw),query=input.query.toLocaleLowerCase();return {items:helpTopics.filter(x=>(x.title+' '+x.text+' '+x.id).toLocaleLowerCase().includes(query)).slice(0,input.limit),source:'package-static',hostStateIncluded:false};
}
