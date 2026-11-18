# 真实发送门禁：只读核验与剩余条件

## 已实现的检查

- `diagnostics.run` 新增可选 `includeDeliveryGates:true`，仍为 read 权限，同一业务处理器供 CLI、MCP 和桌面使用；不新增空能力，83 项、API 3、业务 Schema 11 不变。
- 桌面“只读诊断”勾选“检查真实发送门禁”，可填写明确目标；真实来源下此路径不调用 `read_thread`、`threads.get` 或 Goal API，不刷新额度。`tasks.inspect` 在真实来源也使用同一门禁报告，不推进调度。
- 账号仅用已有额度读取的内存摘要；过期、时间回退、断连、缺身份和账号变化不可作为有效观察。内部摘要不进入公开报告。
- 新 `CodexTargetMetadata` 以只读连接、query_only、事务和 SQLite authorizer 列白名单读取明确 Codex home：threads 的 id/creator_account_id，thread_goals 的 thread_id/goal_id/status，thread_turns 的 thread_id/turn_id/status/first_user_item_id/rollout_ordinal。不查询 preview、first_user_message、item_json、error_json 或 objective；要求普通表和普通字段，不接受 view/生成账号字段。
- 目录祖先、链接、文件身份和连续两次投影均检查；缺库、结构不兼容、目录变化或采样变化保持 unknown。元数据是持久事实，不能证明当前桌面实时空闲、审批状态或执行账号。
- 来源配置可显式保存 `codexHome` 和 `legacyLockDirectory` 本机绝对目录，下次启动生效；保存受 app.manage、修订和幂等保护。fixture 去除真实选择，来源配置整体超过 4 MiB 拒绝保存且保留原文件。
- `LegacyLockGate` 只读观察，不创建、取得或删除锁；空目录和死 PID 不放行。原子互斥与运行中旧工具目录/回收策略仍单列，详见[旧锁核验](legacy-lock-gate.md)。
- `assessUniqueReceipt` 只接受可信内部端口提供的原意图、原 marker、同来源/端点/账号/目标、完整持久精确查询和唯一对应轮次；提交响应、瞬时通知、调用方上下文、零命中、重复记录、分页未尽及客户端删正文均不能替代。零命中仍为 unknown，不释放或补发。当前只接入 fixture 持久回执，真实来源继续 unavailable，不能上传自称可信的证明放行。

## 本机真实只读证据

- 2026-11-18 开发版通过统一 CLI/IPC/MCP/页面读取指定当前目标元数据；原生工具仅 `get_usage_limits` 一次。账号观察、会话创建账号匹配、Goal-thread 关联和持久轮次元数据已实际观察。
- 报告 `artifacts/delivery-gates/development-real-readonly.json` 为只读流程通过，门禁本身明确 blocked，`realSendingEnabled=false`。未检查真实旧锁目录，没有创建任务、发送意图或预约，真实发送/消费均为零。
- CLI/MCP 关闭窗口后可查询，明确退出后离线，本实例宿主清理通过；未保存原始响应、账号/Goal 标识、聊天正文或 objective，仅保留目标摘要与固定诊断码。
- 同目录的 simulated-adapter 报告使用隔离 SQLite/命名管道，不能充当真实绑定、真实回执或真实旧锁证据。模块测试和安装/runner 结果分别登记，失败及 skip 保留。

## 上游协议仍缺的证明

- 已安装 CLI 的 `turn/start` Schema 支持可选 `clientUserMessageId`，本地 history 有 `first_user_item_id`；这是可能的关联基础，不证明桌面发送工具接受并持久保存原 marker，也不证明原调用唯一对应目标 turn。当前桌面发送成功只返回 threadId，不采用“最新 turn”或时间邻近猜测。
- `thread/turns/list itemsView=notLoaded` 能去掉 items，但 Turn.error.message 等自由文本仍可能存在；`thread/read includeTurns=false` 仍有必需 preview；Goal API 仍有必需 objective。因此本轮没有调用这些接口来补门禁。
- 还需要同一已选桌面/host 对目标及 Goal 当前执行账号的无正文证明，并绑定桌面实际 Codex home；当前账号和 creator_account_id 相同仅证明创建元数据一致。
- 还需要源端投影的实时 idle/approval 元数据，以及原发送标识到唯一 turn 的完整持久查询语义，覆盖提交响应丢失、断连、崩溃和重启。增加人工 verified 开关、换独立 App Server 或扫描正文均不能替代。

## 需要用户补充的旧工具信息

- 是否仍使用旧工具托管；实际入口路径、版本/构建和启动方式，以及有效 `CODEX_RESUME_LOCK_DIR`。未覆盖时确认其实际 APPDATA；相对覆盖还需旧进程工作目录。不需要认证、任务库或聊天内容。
- 旧桌面源码的“取得失败→unlock→再取得”会删除已退出持有者的锁；已用旧源码在全新临时目录复现。需实际版本已修复该策略的证据，或可靠的旧托管停用排他条件，才能进一步讨论真实派发；仅给一个空目录不足以放行。
- 上游证明属于协议条件，不要求用户提供密钥或放宽内容读取。后续条件齐备才另列具体真实发送对象、动作、次数和影响请求授权；本轮用户禁止真实发送，保持关闭。
- 签名、真实卡消费和公开发布继续分别暂缓/待批准；本文件不将这些未完成验收算作完成，也不结束 Goal。
