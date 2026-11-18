import { helpGet,helpSearch } from './stage3.ts';
export const helpTopics=[
  {id:'overview',title:'只读桌面入门',text:'先启动 Codex Dog。关闭窗口继续驻托盘；明确退出停止端点和本实例子进程。CLI/MCP 不自动拉起应用。全新 profile 默认模拟。'},
  {id:'sources',title:'显式选择数据来源',text:'在连接与来源选择 fixture 或 live-readonly。保存仅下次启动生效。真实模式必须指定已有调用会话 UUID，多实例明确选择工具管道；断连不会自动换源。'},
  {id:'pairing',title:'客户端配对与撤销',text:'access request 默认只申请 read。桌面核对名称及六位配对码后批准。settings.manage、access.manage、app.manage 分别勾选，不能自授；撤销后后续调用拒绝。'},
  {id:'quota',title:'额度与只读刷新',text:'quota get 查询当前观察；quota refresh 显式刷新。观察三十秒过期，缺失、离线或未知不能当额度正常。额度自动刷新默认关闭，可在 monitoring 设置独立间隔，绝不调度任务。'},
  {id:'threads',title:'会话和 Goal 只读',text:'先明确连接，再分页读取会话身份和状态；选择目标读取详情和 Goal 元数据，不读取聊天正文或 Goal objective。unknown 与确认无 Goal 不同，跨源账号绑定未证实，不确认任务完成。'},
  {id:'settings',title:'设置、外观与临时预览',text:'settings get/update 仅支持 monitoring 和 appearance，分区独立修订，保存须 settings.manage、expectedRevision 和幂等键。预览不保存，离页或窗口隐藏后恢复已保存外观。'},
  {id:'diagnostics',title:'诊断结果的含义',text:'diagnostics run 只读当前额度快照、连接、存储和明确目标。passed、blocked、unknown、not_checked 分开；未选择目标不假装检查成功，不刷新额度、不推进任务。可选 includeDeliveryGates=true 或桌面勾选检查真实发送门禁，使用无正文元数据；单项通过不授予发送，创建账号相同不等于执行绑定。'},
  {id:'history',title:'历史查询和安全导出',text:'历史只记录本应用实际运行/设置事实，不是聊天历史。events query 使用固定边界和绑定过滤条件的游标。events export 写固定 exports 目录的 JSONL，不覆盖已有文件；operations get/list/cancel 普通客户端限本人；可信桌面及 app.manage 可管理本用户全部导出。'},
  {id:'tasks',title:'任务与模板',text:'任务默认暂停且仅观察。自动模式必须单独批准目标、Goal、轮次、修订、次数和时段；模板变化不追改任务。提示词和模板正文读取须 content.read。暂停编辑后保持暂停、累计次数保留；未决投递阻断编辑、移除和重建。'},
  {id:'delivery',title:'调度与投递核对',text:'任务周期和额度只读周期独立。scheduler run-now 可能推进已授权任务；单次发送与托管共用意图、目标互斥、槽位和核对。提交、唯一回执、对应轮次结束、Goal 完成分别记录。结果不确定保留原意图，不自动补发。当前真实绑定及无正文回执未证实，真实发送阻断。'},
  {id:'cards',title:'指定重置卡预约',text:'在来源页明确本机 codex.exe 才启动真实卡片读取；消费来源开关和 cards.consume/逐笔指定卡授权独立。预约只用原卡原键，响应未知只核对；错过不补用，不换卡绕过。核对可能完成原消费，必须明确确认。模拟卡不影响真实额度。'},
  {id:'notifications',title:'通知与允许时段',text:'通知默认关闭。调度与投递页可配置通知开关和跨午夜允许时段；只输出脱敏固定文本，持久游标去重，错过不补发，平台失败不回滚业务。'},
  {id:'updates',title:'安装更新与恢复',text:'Preview 不连接官方更新。签名发行只检查固定仓库和通道，下载与安装逐次确认，安装前保存未决和一致备份；重启核对版本才完成。更新配置可开启自动只读检查，不自动下载或安装。可信签名未配置时正式构建拒绝，不用自签替代。'},
  {id:'limits',title:'当前能力边界',text:'当前为 Windows x64 未签名 Preview，83 项能力、API 3 / Schema 11。任务/投递/卡片已有隔离模拟实现与验收，真实副作用、可信签名和 stable 发行未通过。真实与模拟证据分别记录；help get/search 是包内静态说明，不代表宿主当前能力或状态。'},
] as const;
export function readStaticHelp(operation:string,raw:unknown){
  if(operation==='help.get'){const input=helpGet.parse(raw);return {topic:helpTopics.find(x=>x.id===input.topic),source:'package-static',hostStateIncluded:false};}
  const input=helpSearch.parse(raw),query=input.query.toLocaleLowerCase();return {items:helpTopics.filter(x=>(x.title+' '+x.text+' '+x.id).toLocaleLowerCase().includes(query)).slice(0,input.limit),source:'package-static',hostStateIncluded:false};
}
