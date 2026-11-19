# 公共契约、授权与事务

## 阶段 4 实施增量（REQ-20261117-05，进行中）

- 新增 content.read/tasks.manage/messages.send/cards.manage/cards.consume 独立申请项；旧授权保持原范围，不能因升级自动扩权。
- 模板和任务管理先落地，能力目录只注册已经具备处理器的操作；投递、调度和卡片接入随后贯通，不以空接口占位。
- Schema 11 在同一 worker/SQLite 内增加具备全局修订 CAS 的业务真值；增量迁移覆盖任务/投递/卡片/通知/锁证据及后台操作，幂等结果与脱敏事件同事务提交。JSON 快照只在本机库保存必要提示词，不在日志/普通结果中返回正文。
- tasks.create 默认暂停、mode=observe；templateRef 复制指定修订正文。模板默认变化不回写任务。任务更新必须先暂停，保存后仍暂停，累计次数保留。
- templates.get/tasks.get/archives.get 的 includeContent 额外复核 content.read；列表和修订元数据始终脱敏。复制已有模板正文也需要 content.read。
- 自动模式 enable 必须明确 allowAutomaticSend、connectionRevision、expectedLatestTurnId、expectedGoalId，并复核 messages.send；真实绑定未验证时返回 TARGET_BINDING_UNVERIFIED，模拟不作为真实门禁证据。
- 新增操作均使用能力目录声明的严格 Schema、持久幂等键及修订冲突；业务记录满后拒绝新增，不删除未决真值。
- 当前实现与全部验收仍在推进；尚未执行真实发送/卡消费或公开发行。
- 独立卡片来源由 connections.configure 的可选 cardExecutable 显式保存；只接受本机 codex.exe 绝对路径，留空不启动。allowCardConsumption 默认不启用，保存下次启动生效；它不授予 cards.consume，也不替代逐笔指定卡预约确认。
- 投递端口成功最多 submitted、turnId=null；实际 Codex 当前缺少无正文唯一回执，真实业务门禁仍阻断。独立模拟来源有完整可核对回执/轮次/Goal 场景，不能当成真实证据。
- 新增能力均声明输出 Schema、超时、幂等、条件权限；tasks.inspect 只读当前快照和指定目标，不刷新额度或推进任务。新分页游标绑定操作/过滤和固定边界。
- events.subscribe 返回最多 200 条和始终可恢复的 nextCursor；CLI --follow 等待每批 stdout 后再读取，五秒慢输出断开，不创建无限宿主队列。
- updates.configure 保存固定发行通道的自动只读检查策略（默认关闭）；自动下载固定 false，安装仍显式确认。发行身份的 stable/beta 不通过配置偷偷互换。
- operations.get/list 汇总授权范围内的导出、调度和更新；取消仅对尚未开始的本地动作，已开始调度/安装等返回 OPERATION_IRREVERSIBLE，不撤回已发生副作用。

> 原计划 0.4 的设计基线按职责迁入本文件；具体实现状态以 [G04 实施记录](g04.md) 为准。设计目录不等于已实现能力。

## 本机调用与公共契约

### G04 只读实施契约（REQ-20261116-08）

- 真实接入仅显式 --source=live-readonly；默认 fixture 保留。允许桌面工具仅 get_usage_limits/list_threads/read_thread，禁止其他工具或任意方法透传。
- 新增 connections.discover/get、quota.refresh、threads.list/get、goals.get 六项 read 能力；任务写入、发送及重置卡接口不注册。
- threads.list 输入 connectionId、limit（1–50，默认 20）、cursor（可选）、archived（默认 false）；固定本机 Codex history；threads.get/goals.get 输入 connectionId 与 threadId。
- connectionId 由当前 worker 随机生成并绑定选定管道；调用者会话由 --codex-caller-thread 或 CODEX_THREAD_ID 明确指定，不从索引末行猜选。多管道无选择拒绝。
- 真实额度不复用模拟 SQLite 观察；quota.get 为当前内存观察，quota.refresh 只做读取。来源、观察时刻、过期及未知语义明确，不将预计重置时间当可用证明。
- 仅返回会话身份/状态/最新轮次状态与 Goal 身份/状态；不返回聊天正文、摘要、原始账号、错误正文或 Goal objective，不持久化真实读取正文。
- Goal 使用 readOnly + query_only，指定 thread_id 查询 goal_id/status；缺库/结构不符/未知状态均 unknown，已确认无行才为 known/current=null；读取前后变化冲突。
- 额度提供的账号只在内存摘要绑定，每批读取前后复核；切换账号、目标或连接身份保守拒绝，不沿用旧授权。Goal 文件不含经探测证实的账号绑定时不宣称跨源账号已核验。
- API 升为 major=3：实时来源新增 live、未知/过期响应形态与新发现能力；旧 API 2 的严格客户端无法解析实时来源，必须重建配套 CLI。数据库 Schema 仍为 2，技术授权数据保留。
- 异常返回固定脱敏错误；真实成功证据与注入异常/模拟证据分开记录。未发送消息、未消费重置卡不以“测试成功”代替实际调用审计。

### 连接与生命周期

- Windows 首选命名管道，未来 macOS 通过传输接口接入 Unix Domain Socket。
- G02 已验证原生管道 ACL、实际 SID 校验、独立客户端配对及撤销，通道按实例认证加密；存储机制与威胁边界见 [G02](g02.md)。
- 只连接已运行的主应用，不直读数据库，不自行连接 Codex，不启动独立业务后台。
- 主应用尚未启动、业务进程未就绪、崩溃恢复中、更新中及退出中分别返回明确状态。
- 多客户端共享应用内受控读取和限额，不能把外部高频查询变成高频底层额度查询。
- 缓存返回需标注来源、读取时间和过期状态；客户端不能把断连当作操作未执行。
- 主应用退出后，CLI 返回 APP_NOT_RUNNING；MCP 业务调用返回同一错误，桥接可留存并在后续调用重新发现连接。

### CLI 草案

安装后提供稳定的 codex-dog.exe 入口；下列是最终设计示例；当前可执行 19 项能力（G04 的 15 项加 G05 的四项更新操作），实际边界见 [G04](g04.md) / [G05](g05.md)，配对规则见 [G02](g02.md)，其余尚不可执行。

~~~powershell
codex-dog.exe app status --json
codex-dog.exe capabilities list --json
codex-dog.exe capabilities describe tasks.create --json
codex-dog.exe quota get --json
codex-dog.exe quota refresh --json
codex-dog.exe tasks list --json
codex-dog.exe tasks create --input task.json --json
codex-dog.exe tasks pause --id TASK_ID --json
codex-dog.exe tasks reconcile --id TASK_ID --json
codex-dog.exe reset-cards list --json
codex-dog.exe updates check --json
codex-dog.exe mcp serve
~~~

- 复杂参数支持 UTF-8 JSON 文件及标准输入，明确覆盖 Windows 空格路径、中文和参数转义。
- stdout 只输出约定结果或 MCP 消息，日志写 stderr；退出码和稳定错误码写入接口文档。
- 长操作返回 operationId，通过后续查询获取进度；订阅如需提供应定义独立的 NDJSON 格式。
- 安装包包含 Electron 与 Node SEA CLI 运行时，无需额外安装 Node.js；G05 独立测试 NSIS 与在线更新的验证状态见阶段记录，未覆盖其他系统及架构。
- 普通业务命令在主应用离线时不可用；静态 help、version 和离线接口说明可以独立读取，不能借此返回业务数据。

### MCP 与统一能力目录

助手配置 stdio 命令 codex-dog.exe mcp serve。此命令只启动 MCP 协议入口；MCP 与普通 CLI 子命令是并列适配器，均连接已运行的主应用，不通过子进程互相调用。桥接不重写业务逻辑，与桌面、CLI 共用公开能力目录。

每项能力声明名称、说明、输入输出 Schema、权限、读写性质、超时、错误码、幂等规则、接口版本及调用示例。CLI、MCP 和文档从声明生成或校验；能力覆盖测试检查全部产品功能都有对应接口。

能力标识与 Schema 是唯一契约来源；CLI 参数名和 MCP 工具名是映射结果，不作为业务内核反向依赖的来源。界面使用类型化客户端调用同一能力，不拼接 Shell 命令或解析 CLI 输出。不同调用者可有不同权限，语义一致性验证在相同授权与初始状态下进行。

对话框类操作提供机器可调用的等价参数，例如导出指定目标文件，而非强制弹出保存对话框。固定路径和本机平台操作仍需受控，不能变成任意文件或 Shell 执行接口。

### 返回、错误和版本

~~~json
{
  "ok": true,
  "data": {},
  "meta": {
    "apiVersion": "3",
    "requestId": "...",
    "observedAt": "...",
    "source": "live",
    "stale": false
  }
}
~~~

失败返回 ok=false 及稳定 error.code/message；错误与退出码按[15.6 设计基线](contracts.md)确定。参数表达错误、权限不足、状态冲突、服务不可用和副作用未决不能合并成一种错误。

上例为未来领域 Observation 的设计形态；当前响应 source 为 fixture/local/live，额度时间/过期信息位于 data，平台响应元数据不含 observedAt/stale，完整严格 Schema 见 packages/contracts/protocol.ts。

应用版本、公共 API 版本和数据库版本分开管理。当前 API major=3，实时来源无法由 API 2 严格客户端解析，须配套升级；不兼容 G01 共享 token 协议，不降级认证。客户端连接时校验协议兼容范围；不兼容时停止调用并提供升级提示。机器时间采用明确时区的标准格式，界面再转换成本地展示；时段与预约保留具体时区语义。

### 权限与操作语义

- 最终权限组覆盖只读、任务管理、消息发送、重置卡消费及应用管理。当前实现 read/access.manage/app.manage：初次申请默认 read，桌面明确批准；更新下载/安装须单独批准 app.manage，其余业务权限未实施。
- G06 增加固定发行通道及签名门禁，不新增公共操作或改动 API 3；签名拒绝返回 UPDATE_SIGNATURE_INVALID、CLI 退出码 5，具体发行范围见 [G06](g06.md)。
- 客户端名称只作展示，不能作为可信身份；凭据、传输身份与权限配置相互绑定。
- 用户可以一次配置持久授权，在授权范围内自动化调用；业务接口仍验证具体目标、修订、提示词、次数上限和指定卡片。
- 客户端具备某种权限，不代表可以跳过任务授权或自动消费任意卡片；预检也不代替执行时复核。
- 输入校验、授权判断与实际派发之间的并发变化必须处理，不能只在入口检查一次。
- 请求接受、发送提交、回执匹配、轮次结束和整个任务完成是不同状态。
- 支持幂等的操作持久化幂等键；底层未提供原子幂等保证时，不承诺恰好执行一次。
- 超时、重连和崩溃后的未决写操作只核对，不自动补发；请求 ID 仅用于关联，不能单独作为防重复机制。

## 续跑、调度与数据约束

- 只有最新相关轮次的明确服务端额度错误才可进入额度等待；未知、旧错误、普通异常、主动中断和审批不能单独触发。
- 预计额度恢复时间只用于展示，恢复后仍需服务端真实复查；额度周期与任务周期独立。
- 续跑前复核账号指纹、目标、轮次、Goal、授权修订、次数、时段和有效期。
- 发送意图与槽位同事务提交后再执行；结果不确定持久化并转入核对状态。
- 暂停、到期、后台重启和 Goal 异常不提前释放未决投递槽位；按对应轮次终态或确定派发前取消释放。
- 未结束 Goal 的单轮完成不视为整体完成；Goal 身份变化不沿用旧授权。
- 暂停只停止后续投递，不能撤回已提交消息或中断 Codex 正在运行的轮次。
- 只读刷新、自检和历史查询不推进调度、不占槽、不增加次数；界面应区分只读刷新和可能推进调度的操作。
- 重置卡仅使用用户明确指定并授权的卡；保留原幂等键核对不确定结果；退出、休眠错过预约默认标已错过，不自动补用。
- G03 当前库为 %LOCALAPPDATA%/codex-dog/profiles/<profile>/codex-dog.sqlite，由 worker 独占；沿用当前 SID 保护目录，替代阶段 0 未落地的 %APPDATA% 建议；技术授权与 Electron 缓存留同 profile 的各自文件/目录，不读取或迁移旧运行库。
- 不读取 auth.json，不保存认证令牌；普通日志不记录聊天正文、完整账号标识、提示词正文或完整卡 ID。提示词等必要业务数据按授权保存在本机库中。
- SQLite 使用明确事务及递增迁移，拒绝未知高版本；一致性备份必须包含 WAL 语义，不能在运行中随意复制主文件冒充完整备份。
- 外部客户端不提供任意 SQL；历史分页和导出使用有界查询、一致性快照及取消清理。
- 旧版与新版即便使用独立数据库，也不能同时托管同一目标；先验证跨应用目标锁兼容性，无法确认互斥时阻止并行托管。
- Codex 私有协议及本地 Goal 结构需做能力探测；独立 App Server 的 notLoaded 不能冒充桌面实时状态。

## 数据与参数契约

所有公开输入拒绝未知字段，不接受客户端自报权限或内部账号指纹。名称、枚举、空值与来源在契约中显式表达，不能用空数组或零值替代读取失败。内部可使用毫秒时间戳，公开绝对时间使用带时区的 RFC 3339 字符串并规范化为 UTC；禁止猜测无时区时间。

| 类型 | 必要字段或约束 | 使用边界 |
|---|---|---|
| Request | apiVersion、requestId、operation、params；可带 idempotencyKey | requestId 用于跟踪，不能代替幂等键；身份由已认证连接注入 |
| CallerContext | clientId、entry、grantedScopes、授权版本、截止时间及取消信号 | 由宿主生成；CLI/IPC/MCP 不能自行提供 grantedScopes |
| ConnectionRef | connectionId、revision | 实例切换或身份变化提升 revision，使旧选择及授权失效 |
| ThreadRef | connectionId、threadId | 两者必须组合使用，拒绝连接或返回会话身份不匹配 |
| Observation | value、observedAt、source、stale、connectionRevision | source 区分 live/cache/local/fixture，fixture 不进入生产真实性证明 |
| QuotaView | available=true/false/null、reason、windows、observedAt | 窗口值可为 null；缺必要窗口按未知处理，预计时间不证明恢复 |
| ThreadView | threadRef、title、status、activeFlags、latestTurn、goal、observedAt | latestTurn 只保留状态和有界错误；不返回原始聊天正文 |
| GoalView | availability=known/unknown、current=null 或 goalId/status | known 且 current=null 才表示确认无 Goal；缺库、未知结构不能返回 null 冒充无 Goal |
| TaskView | id、threadRef、enabled、phase、revision、resumeCount、maxResumes、policy、reason、未决摘要 | 内容默认脱敏；配置修订与任务运行状态分别表示，计数不能因编辑重置 |
| TaskInput | threadRef、prompt、enabled、maxResumes、mode、priority、expiresAt、dailyWindow、authorization | prompt 非空且最多 10000 个 UTF-16 代码单元；maxResumes 默认 3，范围 1–20；mode=auto/observe；enabled 默认 false，显式 true 必须满足完整授权 |
| TaskPolicy | priority=high/normal/low；expiresAt=null 或绝对时间；dailyWindow=全天或 HH:mm 起止 | 默认普通、无截止、全天；每日时段跟随本机时区，开始含结束不含，支持跨午夜，非全天起止不能相同 |
| TaskAuthorization | 配置修订、目标、允许自动发送、累计上限、授权时刻 | 创建与开启时绑定当前身份及 Goal；仅客户端权限不足以代表此业务授权 |
| DispatchAttempt | attemptId、taskId 可空、threadRef、marker、revision、state、slot、operationId | 单次发送与托管复用；slot=held/released；未决不能删除或重建绕过 |
| ResetCardView | cardKey、title、status、expiresAt、idSuffix | cardKey 是绑定来源、账号和卡 ID 的不透明引用；换账号或来源后旧选择失效。完整 creditId、账号指纹和服务端原始响应不进入公开结果；既有预约仍保留原引用/原卡/原消费键用于核对 |
| ResetAppointmentInput | cardKey、scheduledAt、timeZone、明确消费授权 | scheduledAt 为未来绝对时间，timeZone 为有效 IANA 区名；已过期或当前不可用卡拒绝创建 |
| Page | items、nextCursor、boundary | 默认 50 条、上限 200；cursor 为不透明值并绑定条件，事件/归档按稳定边界读取 |
| OperationView | operationId、state、kind、resultRef、error、updatedAt | state=accepted/running/succeeded/failed/uncertain/cancelled；本地命令成功不等于远端业务目标完成 |
| SettingsPatch | section、expectedRevision、patch | section=monitoring/connection/queue/notifications/appearance/updates；按分区修订，禁止全量覆盖其他表单 |

沿用旧项目的有效边界：额度间隔默认 600 秒、范围 10–3600；任务周期默认 15 秒、范围 10–300；队列默认关闭、并发上限范围 1–20；任务优先级不抢占。

外观保留旧能力范围：标题字号 24–40、分区 16–30、正文 12–24、辅助 11–18、导航 13–20，行高 1.4–2.2；字体、密度、对比度、10 种纯色、10 种渐变与阅读预设均通过同一设置契约校验。预览仅改变当前界面，保存才持久化，离页撤销未保存预览。

## 授权、事务与操作状态

#### 授权模型

- 当前用户身份先由本机连接校验。新外部客户端初次请求通过 access.request 建立待授权记录；由桌面当前用户或已具备 access.manage 的客户端明确批准，禁止自行授予权限。
- 默认只申请 read；按需增加 content.read、tasks.manage、messages.send、cards.manage、cards.consume、settings.manage、app.manage、access.manage。settings.manage 不包含更新渠道变更和安装，后者使用 app.manage。
- content.read 控制本应用保存的任务提示词和模板正文，默认结果隐藏这些字段；不授予读取原始聊天或认证文件的能力。
- tasks.manage 允许管理任务；开启自动发送还需 messages.send，并绑定 TaskAuthorization。cards.manage 可管理预约，执行真实消费还需 cards.consume 且明确授权指定卡。
- 持久授权存活期间可自动执行已授权范围，暂停、撤销、改修订、换目标/身份和到期会使相关执行资格失效；授权版本必须在真正派发前复核。
- CLI/MCP/桌面分别携带可信来源，权限可以不同；同授权、同初始状态下调用同一处理器得到一致业务结果。
- 凭据在客户端配置中使用受保护的配置引用，命令行不传明文 token；公开 Schema 不包含任意 scopes 字段。Windows 同用户保护不等于防御控制了该用户全部权限的恶意程序。

#### 具名事务与未决恢复

| 流程 | 提交边界 | 失败处理 |
|---|---|---|
| TX01 任务创建/修订 | 任务、修订授权、配置版本、关键事件及操作幂等结果同提交 | expectedRevision 不符拒绝；模板正文复制；修订后保持暂停，计数不重置 |
| TX02 投递准备 | 目标锁已取得后，最终核验结果、attempt、held 槽、累计计数及意图事件同提交 | 任一失败全部回滚；网络写入在提交之后，所有入口共用此路径 |
| TX03 派发与结算 | 网络前复核授权版本/连接版本；响应及回执更新另起短事务 | 确定本地未写入可记录取消并回退对应预占；任何写入后未知保留 intent/held，不盲目重发 |
| TX04 完成归档 | 已证实完成或允许移除时，归档快照、事件及任务状态同提交 | 有未决 attempt 拒绝移除；读取对应轮次终态才释放槽位 |
| TX05 卡预约与领取 | 指定卡、授权、唯一消费键及预约同存；到期原子领取一次再执行 | 账户或卡变化停止；消费未知保留原键；错过标 missed，不能用创建新预约绕过 uncertain |
| TX06 历史导出 | 固定只读快照，分批写临时输出，成功改名 | 取消或失败不留下冒充成功的结果；不把全部历史装入周期快照 |

所有业务变更及导出、授权、安装等有副作用操作携带 idempotencyKey，作用域为 clientId+operation+key，持久关联规范化参数摘要及结果。同键同参数返回原 operation/result；同键不同参数报 IDEMPOTENCY_CONFLICT。首次配对使用宿主分配的临时 clientId 关联请求，不把标签当权限身份。初始基线保留幂等记录至少 30 天，未决操作与消费键在核对结束前不能清理；过期键不能用于宣称远端从未执行。只读刷新产生的观察缓存与脱敏诊断日志不视为业务变更，不要求调用方提供幂等键。

Task 的 enabled、phase 和 reason 分开表达：phase 沿用 observing/waiting_quota/sending/verifying/completed/suspended/send_uncertain；完成状态依赖 Goal 与当前轮次证据，卡片“已续跑”不等于 Goal 已完成。attempt 再记录 prepared/dispatching/submitted/receipt_matched/turn_finished/uncertain/cancelled_before_write，slot 是否释放独立判断。

threads.send 仅为显式单次发送，要求目标空闲、无审批/未结束 Goal、无本应用托管及未决投递，提供 expectedLatestTurnId、connectionRevision、正文和明确单次授权；同样取得目标锁、槽位、意图和回执。它不套用“必须先额度耗尽”的自动续跑触发条件，也不能用于绕过托管暂停、次数上限或队列。目标受托管时返回 TARGET_MANAGED，使用 tasks 的授权流程处理。

操作取消只取消尚未落地的本地动作；已提交消息不能撤回，卡消费不能反向执行。app.quit/updates.install 返回 accepted 与 operationId 后进行退出协调，断连不作为完成证明，下次启动通过持久记录核对；权限撤销不能撤回已被 Codex 接收的内容。

## CLI 公共规则与错误码

命令前缀统一为 codex-dog.exe，按“资源 子命令”组织；下节表格列出前缀后的部分。全局参数为 --json、--profile、--timeout-ms（默认 30000，上限 120000）。--input <UTF-8 JSON 文件> 与 --input - 二选一，后者只从 stdin 读取一个 JSON 对象；资源 ID 等简单字段可使用具名选项，禁止同一字段同时在文件和命令行出现。

所有变更操作使用 --idempotency-key，并由服务端持久核对；复杂变更参数通过 --input 提交。--wait 仅等待已接受操作直到客户端截止时间，不改变业务执行计划；下载等长操作默认先返回 operationId。客户端超时后使用原键或 operations.get 核对，不生成新键自动重做。

--help、--version 及包内静态说明允许离线读取，返回的是客户端包信息；app version 查询已运行主应用版本，capabilities list 查询宿主实际能力。业务离线一律 APP_NOT_RUNNING，不返回本地旧库假装实时。CLI 默认可读文本，--json 保证 stdout 只有一个结果对象；MCP 模式 stdout 只能包含协议消息。事件流是独立 events subscribe 模式，--json 时采用逐行 JSON，不与普通一次性输出混用。

| 退出码 | 稳定错误码 | 语义及重试 |
|---|---|---|
| 0 | 无 | 请求成功或明确 accepted；须检查 OperationView，不能据此宣称远端任务完成 |
| 2 | INVALID_ARGUMENT、INPUT_TOO_LARGE、INVALID_CURSOR | 输入或边界错误，不发送无效业务请求；修正参数后调用 |
| 3 | AUTH_REQUIRED、PERMISSION_DENIED、AUTH_REVOKED | 尚未配对、权限不足或已撤销；不能自动自授权限 |
| 4 | REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、CONNECTION_IDENTITY_CHANGED、TARGET_IDENTITY_MISMATCH、GOAL_IDENTITY_CHANGED、TARGET_MANAGED、TARGET_BUSY、UNRESOLVED_ATTEMPT、APP_NOT_READY、APP_STOPPING、UPDATE_IN_PROGRESS | 状态冲突或暂不可操作；读取新状态后重新决定，不盲目重复原写入 |
| 5 | APP_NOT_RUNNING、PROVIDER_UNAVAILABLE、CAPABILITY_UNSUPPORTED、PROTOCOL_INCOMPATIBLE、PROVIDER_SELECTION_REQUIRED、PROVIDER_SCHEMA_UNSUPPORTED、PROVIDER_IDENTITY_UNAVAILABLE、TARGET_LOCK_UNVERIFIED、READ_TIMEOUT、UPDATE_SOURCE_UNAVAILABLE | 应用或来源不可用；只读可退避重试，写操作仅在证明未接受时重试 |
| 6 | OPERATION_UNCERTAIN | 请求可能已经产生副作用；返回可知的 operationId/attemptId，仅核对原操作 |
| 7 | STORAGE_FAILURE、INTERNAL_ERROR | 存储或内部故障；给出脱敏关联 ID，若已进入外部派发则优先分类为 OPERATION_UNCERTAIN |
| 8 | CANCELLED_BEFORE_EFFECT | 已证实在副作用发生前取消；已发送消息或消费不能返回此结果 |

历史 G01 API major=1、G02/G03 major=2；当前 G04 API major=3；operation 名称稳定，新增可选字段保持兼容，删除/重解释字段或枚举须升级 major。服务端以 1 MiB 请求、4 MiB 单响应为初始上限，超限要求分页或流式导出，帧处理与真实 Codex 适配的内部上限分别验证。默认不输出错误堆栈、凭据和原始工具响应。

## 阶段 2 增补：只读桌面与来源配置

本节优先于历史阶段的 19 项实现统计。新增四项能力，API major 3 与业务 Schema 2 不变；未实现设计项仍不可调用。

- `connections.configuration`：read，空参数，返回启动时 `active`、已保存 `saved`、`revision`、`restartRequired`、`override`。
- `connections.configure`：app.manage，`{expectedRevision, source: 'fixture'|'live-readonly', callerThreadId, pipe}`；callerThreadId 为 UUID 或空串，pipe 为本机 Codex 工具管道或空串；真实模式必须提供 callerThreadId。保存下次启动选择，当前进程不重连、不切换；显式启动参数优先，override 表示存在启动覆盖。须幂等键，以客户端、操作及键隔离，持久保存返回值；同键异参拒绝，修订冲突拒绝。配置文件损坏/高版本拒绝启动，保存失败不改内存。
- `desktop.show`：read，空参数，仅显示本应用现有窗口，不执行 Shell、不拉起新应用。
- `app.quit`：app.manage，`{expectedInstanceId, confirm:true}` 及幂等键，实例不符返回 REVISION_CONFLICT；应答后安排明确退出。同实例重复键不重复安排，异参拒绝；退出后离线，旧实例请求不能退出新实例。

来源配置仅含选择参数，不含认证、聊天或额度观察。保存位于当前 SID 保护目录，与配对授权分开；保存前最终复核权限。配置和退出不触发真实业务。托盘关闭窗口仅隐藏，完全退出关闭端点、worker 和安全管道宿主。保存的 caller 优先于环境回退，只有未指定时才使用 CODEX_THREAD_ID；显式启动参数仍优先。

新增操作沿用统一授权、离线/停止及存储错误。配置的主要错误为 INVALID_ARGUMENT、REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、CLIENT_LIMIT、STORAGE_FAILURE；本机请求默认 30 秒客户端超时。退出应答为 accepted，不代表端点已关闭；400 ms 后派发前再次复核 app.manage，若撤销则取消。调用方可用 app.status/离线核对，不因读取失败自动拉起应用。来源配置幂等记录最多 2048 条、当前不自动清理；达到上限拒绝，不丢弃旧键。

## 阶段 3 实施契约（REQ-20261117-04）

- settings.get/update 仅支持 appearance/monitoring；quota.policy.get/update 与 appearance.get/update 为同一分区服务的别名，不另建存储或规则。分区独立正修订，写入须 settings.manage、expectedRevision 与持久幂等键；未知字段/分区拒绝。settings.manage 不授予来源选择、退出或更新权限，已有授权不自动扩权。
- 外观字段范围沿用上方设计，主题/字体/密度/对比度为固定白名单；appearance.presets 提供完整预设。appearance.preview/cancelPreview 仅当前可见主窗口，settings.manage，预览 ID/所有者绑定；临时预览不写数据库，离页和窗口隐藏撤销，保存才持久化。
- monitoring：autoRefresh 默认 false，quotaIntervalSeconds 默认 600、10–3600；只影响当前显式来源的只读额度刷新，不运行调度，不修改次数/槽位或自动切换来源。
- diagnostics.run：read，可带明确 ThreadRef；仅读取当前额度快照、连接、业务存储和调用方授权，目标未选为 not_checked，缺证据 unknown，额度耗尽 blocked；返回逐项与总体状态和观察时刻，不自动刷新额度。
- events.query：read，from/to/type/reason/limit/cursor；单页最多 200，首次固化上界，游标绑定条件和上界，历史不收录聊天/账号/真实额度/Goal 原文。没有正式任务时不开放任务归档或任务时间线的伪实现。
- events.export：read，沿用查询条件、最多 20000 条、output 仅安全 JSONL 文件名；写入固定 exports 目录。返回当前客户端拥有的 OperationView；operations.get/list/cancel 仅管理本轮已实现的导出操作：外部普通客户端限本人，可信桌面及显式 app.manage 可管理本用户全部导出，不能透传其他模块内部状态。导出在固定边界读取、逐批检查取消/授权；取消、退出、重启未完成导出或失败均清理本操作临时文件，不产生成功文件，不覆盖已有目标。
- desktop.status/read 与 desktop.openDataDirectory/app.manage 为固定平台操作，无任意路径或命令。help.get/search 是包内静态说明例外，可在应用离线、未配对时读取；不返回宿主状态或业务缓存。
- 数据库递增迁移保存设置/脱敏事件/导出操作，仍由 worker 唯一写入；既有 fixture_* 模拟事务与真实只读观察分开。配置和导出操作幂等记录有界，达到上限拒绝，不丢弃未决真值。
- 新能力仅完成真实实现后注册；API major 3 保持，新增 settings.manage 权限为可选授权，旧客户端须使用配套能力目录，不把未来设计当已实现。

## 真实发送门禁诊断增补（REQ-20261118-01）

- diagnostics.run 的 includeDeliveryGates 为可选 boolean，默认 false，权限仍 read；返回可选 deliveryGates，包含 status、逐项 checks、source、observedAt、readOnly=true、realSendingEnabled=false。真实路径采用固定元数据列投影，跳过原会话/Goal API；不刷新额度。
- tasks.inspect 在真实来源返回同一可选 deliveryGates；providerChecked=false 表示没有调用原实时会话读取。创建账号匹配和持久化轮次不改写业务授权，不解除真实发送阻断。
- connections.configure/来源 DTO 新增可选 codexHome、legacyLockDirectory，最多 500 字符的本机绝对目录；空值沿用原缺省，不允许 UNC/设备路径。app.manage、修订、幂等和下次启动语义不变，fixture 清除真实参数。--codex-home 显式覆盖纳入 active/override。
- FileSourceStore 单条配置请求 body 上限调整为 4096 字符，文件 4 MiB 上限同时用于加载和保存；保存超限不替换原文件。业务数据库无需迁移。
- 门禁事实不含原账号摘要、marker、锁 token、聊天正文或 Goal objective；不接受客户端上传证明，也不增加人工 verified 放行。完整含义和外部条件见[真实发送门禁](real-delivery-gates.md)。

桌面投递参数准备补充（REQ-20261119-01）：启用自动任务和显式发送页面先经同一 diagnostics.run(includeDeliveryGates=true) 读取来源门禁；当前只允许明确 fixture 来源继续读取模拟会话。真实、未知或不兼容报告在 threads.get 之前停止，不向真实来源发送，也不以页面输入代替业务授权。底层 tasks.enable/threads.send 仍保留独立最终校验；CLI/MCP 契约、权限及能力数量不变。
