# 架构、模块与底层端口

> 原计划 0.4 的设计基线按职责迁入本文件；真实只读见 [G04](g04.md)，当前更新模块及状态见 [G05](g05.md)，初始证据保留在 [G01](g01.md)。设计目录不等于已实现能力。

## 技术架构与已确认的调用原则

CLI 优先及各入口并列接入为已确认原则；具体目录、通信库和工具版本仍需技术验证。开发顺序和运行时依赖分别按本节定义，不能把“CLI 优先”解释为所有内部调用都经过命令行程序。

### 技术栈方向

- Electron、Vue 3、TypeScript strict、Pinia、Element Plus、SQLite、pnpm workspace。
- 业务代码不依赖 Electron；桌面平台能力通过接口注入。
- 精确版本、Node/Electron SQLite 兼容性、CLI 打包方案在技术验证后锁定；不直接照搬旧 lockfile。
- 保留独立业务进程，首版不为每个功能创建单独进程。
- 界面沙箱、上下文隔离和固定 IPC；不向页面暴露文件系统、数据库或任意管道调用。

### 进程职责

| 进程 | 职责 | 生命周期 |
|---|---|---|
| Electron 主进程 | 窗口、访问控制、外部网关、请求路由和退出协调；托盘/通知/更新后续实施 | 由用户启动；驻托盘继续运行 |
| 渲染进程 | 页面、表单、局部加载及展示缓存 | 窗口存在时运行，不持有业务授权真值 |
| 独立业务进程 | 当前模拟额度、SQLite 及真实 Codex 只读接入；完整领域业务和调度留后续 | 由主进程管理，退出应用时停止 |
| Windows 管道宿主 | 原生管道 ACL、实际 SID 验证与帧传输，不持有业务规则 | 由主进程管理，stdin EOF 或退出请求时关闭 |
| CLI 客户端 | 参数解析及预校验、连接应用、JSON 输出与退出码 | 一次调用一个客户端，不启动主应用 |
| MCP 桥接 | stdio 协议、能力映射、连接应用 | 由助手启动，可等待主应用重新上线 |

业务进程是领域业务状态的唯一管理者和业务数据库唯一写入者。G02 的本机访问控制属于平台入口，唯一 AccessService 在主进程管理独立 access.json，G03 由 worker 独占 SQLite，平台授权仍不迁入其中。各入口经过统一的契约校验、权限检查和路由；窗口、更新等能力由主进程的平台处理器执行，业务能力转交业务进程的模块处理器。统一入口是一套共享规则和能力目录，不要求把全部模块实现集中到主进程或一个大类中。

界面通过 contextBridge 和受限 IPC 接入，CLI/MCP 通过本机通信接入。两类传输转换成相同的操作标识、参数与可信调用方上下文，再交给同一操作的唯一处理器；适配器可以做输入预校验，业务侧仍进行最终校验。调用者权限可以不同，业务规则、状态迁移及副作用只有一份实现。

~~~mermaid
flowchart LR
  UI[桌面界面] --> IPC[受限 IPC]
  CLI[CLI 客户端] --> GATE[本机接口网关]
  MCP[MCP 桥接] --> GATE
  IPC --> ENTRY[统一契约、校验、授权与路由]
  GATE --> ENTRY
  ENTRY --> WORKER[业务进程内的模块处理器]
  ENTRY --> PLATFORM[主进程内的平台处理器]
  WORKER --> LOW[底层端口及适配实现]
  LOW --> DB[(独立 SQLite)]
  LOW --> CODEX[Codex 接入]
  PLATFORM --> UPDATE[窗口、通知与更新适配]
~~~

### 建议目录与依赖边界

以下为目标结构。G01–G04 按需实现 apps/desktop、apps/cli 及 packages/app、contracts、modules/quota、modules/access、modules/persistence、modules/codex-readonly、infrastructure；当前统一根依赖和构建，不为每个模块机械创建独立包。

~~~text
codex-dog/
  apps/desktop/                 Electron 主进程、预加载与 Vue 界面
  apps/cli/                     CLI 与 MCP 客户端入口
  packages/modules/             按职能组织的业务模块，各自拥有公开契约
  packages/infrastructure/      Codex、SQLite、本机通信、平台适配
  packages/update/              更新服务与平台安装适配
  packages/app/                 统一入口、能力组装、跨模块编排、生命周期协调
  scripts/                      构建、文档与验证脚本
  docs/                         接口、接入、发布与开发说明
~~~

- 模块建议包含公开契约、领域规则、应用服务、所需端口及对应测试，体量小的模块不机械拆成多包。
- 底层接口负责连接、读写等技术能力；模块应用服务负责业务授权、状态迁移、幂等和事务协调；传输适配只负责协议转换与展示。
- 具体实现由应用组装入口注入，禁止循环依赖、跨模块导入内部文件或直接操作对方表。
- 共享契约保持最小，不建立承载全部业务类型和逻辑的巨型公共包。
- 模块导入与构造不进行读写、连接或启动计时器；通过显式 start/stop 生命周期执行。
- 需要一致性的发送意图、投递槽位和授权修订通过明确的事务端口协调。
- 直接业务调用使用类型化接口；事件用于通知已发生的事实，不用全局事件总线隐藏业务依赖。
- 通过导入边界检查、类型检查及模块测试持续约束，模块代码首版随整应用统一发布。

### 统一能力与唯一实现

每项公开操作由所属模块声明契约并注册一个权威处理器。应用组装入口仅汇总能力和配置路由，不复制业务逻辑。桌面 IPC、CLI、本机协议和 MCP 均映射到这份目录。

例如 tasks.pause 的处理逻辑只实现一次：校验权限与目标 → 检查状态及修订 → 暂停并持久化 → 返回结果。桌面按钮、CLI 子命令和 MCP 工具都调用该处理器，任何入口都不能自行修改任务开关或写数据库。后台调度需要执行同一业务操作时也复用对应模块服务，不能另写一套状态迁移。

| 层次 | 职责 | 不应承载的内容 |
|---|---|---|
| 底层端口与适配 | Codex 协议、SQLite、时钟、锁和平台能力 | 页面逻辑、CLI 参数语法、重复业务授权 |
| 统一业务能力 | 模块服务、业务规则、授权复核、事务和副作用 | stdout 格式、MCP 消息、页面状态 |
| 契约与统一入口 | 能力声明、最终校验、可信调用上下文、路由与错误语义 | 全部模块的具体实现 |
| 桌面、CLI、MCP 适配 | 协议转换、参数表达、结果展示及进度订阅 | 独立业务实现、直连数据库或原始 Codex 接口 |

### 按功能逐项贯通的开发顺序

1. 为选定功能定义底层端口，使用夹具验证后实现必要适配，不提前封装所有未使用接口。
2. 定义该功能的公开契约与模块业务服务，建立唯一处理器及业务验证。
3. 将能力注册到已运行的最小主应用宿主，先完成 CLI 调用、错误、授权和结果核对。
4. CLI 链路验证通过后，接入对应桌面交互和 MCP 映射，检查契约与副作用一致。
5. 沿相同顺序扩展下一项能力；先额度只读查询，再推进状态管理、续跑与重置卡等操作。

此顺序不要求完成全部 CLI 后才开始界面，也不要求先封装全部底层代码。最小 Electron 宿主、通信和业务进程可先建立以支撑 CLI；它们不等于完整业务页面。主应用已启动这一运行前提始终保留。

进度推送使用统一事件契约，由 IPC、本机通信等传输适配分别承载；界面不通过重复启动 CLI 轮询模拟推送。MCP 直接映射同一公共协议，不通过执行普通 CLI 子命令或解析人类可读输出实现业务调用。

## G04 已实现的只读来源

显式 live-readonly 由 worker 组装 CodexDesktopReadonly / CodexGoalReadonly → CodexReadonlyService → ReadonlyRegistry，统一 HostRouter 接入 CLI/IPC/MCP；默认 fixture 保留 G03 SQLite 链路。只有专用适配器可定位桌面管道或 Goal 源库，主进程/CLI 不持有其实现。

真实来源只允许三项读取；会话读取前后核对账号摘要和 Goal，输出仅身份/状态，真实结果不持久化到模拟观察库。Goal 跨源账号绑定不能证实，明确返回未证实和不确认完成；详见 [G04](g04.md)。

## 应用生命周期与故障恢复

建议关闭窗口默认驻托盘；明确的“退出并停止监控”关闭全部业务进程与本机接口。具体菜单文案在界面设计阶段确定。

启动顺序：取得单实例锁 → 初始化主进程 → 启动业务进程 → 数据库检查及恢复 → Codex 能力探测 → 开放就绪状态。外部入口可提前响应状态，但就绪前拒绝业务操作。

退出顺序：进入停止状态 → 拒绝新写操作 → 停止新调度 → 等待本地在途派发请求有界落定 → 持久化未决结果 → 关闭数据库、连接及业务进程 → 退出主应用。

退出无需等待远端所有长任务完成；已提交的 Codex 任务可继续在 Codex 中运行，本应用停止观察，下一次启动重新核对。完全退出期间不执行自动续跑和预约。

G02 已验证 worker 每 500 ms 心跳、2500 ms 超时、最多三次重启和 300/600/1200 ms 退避；ready 不重置预算，退出取消排队重启，异常主进程结束由父进程检查/EOF 清理子进程，详见 [G02](g02.md)。崩溃恢复不能重放未决发送。所有异步操作有超时、取消或退出等待策略，超时不能等同于远端未执行。

## 模块所有权与允许依赖

模块间使用消费者声明的窄接口，以下“允许依赖”指注入能力，不允许导入其他模块的具体类或内部文件。调度只提出执行候选，由任务/卡片模块进行最终业务检查和提交；诊断只读，不能反向推进调度。

| 模块 | 唯一职责与数据所有权 | 允许依赖 | 禁止事项 |
|---|---|---|---|
| M00 应用组装与生命周期 | 能力注册、进程状态、跨模块流程、安装/退出门禁 | 所有模块公开端口、进程通信 | 把全部业务规则集中到组装器 |
| M01 连接 | 实例候选、连接配置修订、能力探测与身份版本 | P01、P02、M10 配置读取 | 自动猜选多个实例、静默更换账号 |
| M02 额度 | 规范化额度快照、读取缓存、独立检查计划 | M01 会话端口、P03、P11、M10 策略 | 自行发送、把预计时间当恢复证据 |
| M03 会话与 Goal | 有界会话观察、Goal 身份一致性、只读投影 | M01、P04、P05 | 读取 objective、修改 Codex 源库 |
| M04 托管与投递 | tasks、revisions、attempts、slots、单次发送和归档写入 | M02/M03 只读端口、P06、P09、P10、P11、P17、P18、M09 授权复核 | 连接层自动重试、未决编辑/移除、脱离事务改计数 |
| M05 调度 | 到期计划、候选排序、监控推进及非抢占策略 | M02/M04/M07 公共服务、P11、M10 策略 | 直接写任务/槽位/预约表，复制发送规则 |
| M06 模板 | templates、默认模板和模板修订 | P09、P18 | 模板修改回写已创建任务 |
| M07 重置卡 | 卡片快照、resetAppointments、消费幂等与核对 | M01、P07、P08、P09、P11、P17、P18、M09 授权复核 | 更换卡或幂等键重试不确定消费 |
| M08 历史与诊断 | events、历史投影、范围导出、自检结果 | 各模块只读端口、P09 只读快照、P17 | 用诊断更新引擎缓存、修改授权与计数 |
| M09 访问控制 | 客户端授权记录、凭据引用、操作准入与撤销 | P15、P18、访问授权存储端口、本机身份信息（G02 主进程 JSON，领域库仍归 worker） | 信任自报 clientName/scopes、自授权限 |
| M10 设置 | 分区配置、外观白名单与修订 | P09、P18 | 绕过模块服务用设置接口直接开启任务或消费卡 |
| M11 桌面平台 | 固定窗口/目录操作、通知输出、说明阅读 | P12、P14、M10 只读配置 | 任意 Shell、任意目录执行或外部 URL 透传 |
| M12 更新 | GitHub 检查、下载状态、目标版本、安装申请 | P13、P11、M10 策略、M00 生命周期端口 | 直接改任务/库、下载后偷换版本、强制绕过门禁 |

M08 拥有事件存储，M04/M07 的关键事务通过受限事件写入端口在同一数据库事务中追加事件；不采用“提交后再尽力发事件”作为关键审计保证。跨模块事务由 P09 的具名提交操作实现，不向模块暴露通用 SQL 或其他表。

M04 可写归档快照，M08 仅建立归档查询投影；M08 不被任务执行反向调用。M00 对外路由后由所属处理器执行，M04/M07 仅依赖注入的授权端口，M09 不导入任务或卡片实现，避免循环依赖。

## 底层端口与失败语义

端口调用统一支持 deadline 与取消信号；取消只能阻止尚未发生的副作用。所有适配器 start/close 显式执行，连接重建不能私自改变目标；下列方法名是文档签名，尚非可导入代码。

| 端口 | 方法及输入 → 输出 | 适配职责与失败边界 |
|---|---|---|
| P01 DiscoveryPort | discover(config) → candidates；resolveSelection(candidateId, callerSelection) → selection | 有界枚举管道/索引尾部/CLI 路径；多候选返回选择需求，不把索引最后一行当可靠授权来源 |
| P02 ProviderConnectionPort | open(selection) → sessionRef；probe(sessionRef) → capabilitySet/identityVersion；close(sessionRef) | 校验工具 Schema 和身份；实例或账号变化失效旧 revision，未探测能力不能宣称可用 |
| P03 UsageReadPort | readUsage(sessionRef) → normalizedQuotaObservation | 来自桌面实时额度；保留缺失字段；失败不更新为零，不修改任务调度 |
| P04 ThreadReadPort | list(sessionRef, filter/page) → boundedPage；read(threadRef, bounds) → observation | 校验返回目标；内部默认最多 10 轮、每项 2000 字符用于有界证据，不把正文透传给客户端 |
| P05 GoalReadPort | read(threadRef) → known(currentGoal/null) 或 unknown(reason) | 只读 goals_1.sqlite 指定目标的 goal_id/status；读取前后 Goal 变化返回冲突；未知不当无行 |
| P06 MessageDispatchPort | dispatch(sessionRef, threadRef, payload, intentRef, finalGuard) → submissionOutcome | 连接重建先重新核验，实际写入前同步执行 finalGuard；确定未写入与写入后未知分别返回，永不自动重发 |
| P07 ResetReadPort | readCredits(sessionRef) → accountBoundCreditsObservation | App Server 明细读取独立来源；完整卡 ID 只留内部，来源身份须与授权目标一致 |
| P08 ResetConsumePort | consume(creditRef, durableIdempotencyKey) → reset/nothingToReset/noCredit/alreadyRedeemed 或 uncertain | 传指定 creditId，原键持久化；响应缺失或无法解释按未决，不另选卡或换键 |
| P09 PersistencePort | open/close；repository.read；readSnapshot(query)；具名 transaction(commitName, input) → result | 仓储按模块收窄；具名提交覆盖意图+槽位+计数+事件、任务修订、归档、预约领取、操作幂等记录；不持数据库写事务等待网络 |
| P10 TargetLeasePort | acquire(threadRef, ownerRef) → lease；assertOwned(lease)；release(lease) | 原子独占目标；崩溃残留只在证实持有者退出后处理，不通过结束进程抢锁；旧版兼容失败保守阻断 |
| P11 ClockPort | nowUtc()、monotonicNow()、localZone()、schedule/cancel | 绝对时间用于持久化，单调时间用于进程内超时；休眠恢复重读真实状态，卡预约不补用 |
| P12 NotificationPort | show(fixedType, safePayload) → shown/unsupported/failed | 按任务通知策略输出，失败不回滚已提交业务，不包含敏感正文 |
| P13 UpdateBackendPort | check(channel) → releaseCandidate；download(candidate) → verifiedArtifact；install(artifact, shutdownPermit) | 只读配置的 GitHub 仓库，绑定版本及哈希；安装需生命周期许可；传输错误不影响监控 |
| P14 DesktopPlatformPort | showWindow()、openKnownDataDirectory()、requestQuit(reason) | 仅固定操作，外部参数不转成任意文件路径、程序或 Shell |
| P15 CredentialStorePort | create/verify/revoke(clientRef) → credentialRef/status | G02 使用当前 SID 的受保护文件保存客户端秘密，服务端只存摘要，授权修订可撤销；未采用 DPAPI |
| P16 LocalTransportPort | server.start/stop；client.connect；request/subscribe | 校验当前用户、协议与帧大小；CLI/MCP 不启动主应用；断连不等于操作取消或未执行 |
| P17 EventPort | appendInTransaction(event, txContext)；publishCommitted(event)；subscribe(cursor) | 关键事件与业务同提交；进程推送可丢失后补查，不作为唯一持久事实 |
| P18 IdentityPort | newResourceId()、newRequestId()、newMarker() | 随机唯一标识不携带账号信息；同次重试复用业务幂等键，不因生成新 requestId 重做副作用 |

DispatchReceipt 不建立另一套未经核对的来源：M04 使用 P04 读取本应用持有 marker 的证据，区分提交响应、唯一回执匹配和对应轮次终态。第三方读取失败不会将 attempt 判成未发送。

P10 已先登记 api-contract 文件协议，再以旧 src/store.ts 原始 FileJournal 与新 TargetLeaseAdapter 在隔离目录验证 SHA-256(threadId).lock、wx、pid/token 的双向及同时竞争。新适配器不自动回收遗留锁，避免旧 unlock 的读后删除竞争；自定义真实目录仍须明确核对，不以窗口存在性代替互斥。本次不共享运行库或真实锁目录、不建立实际运行时项目依赖，详见 [G03](g03.md)。
