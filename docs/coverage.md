# 最终功能与验收覆盖表

## 口径和证据分界

- 需求：REQ-20261117-05；本表对应阶段 4–6 的当前实现快照，不表示本轮总验收完成。
- 当前能力目录为 83 项、API major 3、SQLite Schema 11。C01–C82 均有对应处理器，另有读取已保存来源的 connections.configuration；数量不是验收结论。
- 「已实现」指存在公开契约及唯一处理器；「模块模拟」指隔离端口、数据库或进程模拟测试；「开发模拟」指本机开发版 CLI/IPC/MCP/页面的实际运行记录。
- 阶段 2/3、G01–G05 的历史通过只支持其当时范围。本轮最终代码的全量回归、实际安装/升级和远端 CI/Preview 尚在验证，不能用历史记录补作本轮通过。
- 本机模块记录为 `artifacts/stage4/unit-tests.tap`；开发模拟记录为 `artifacts/stage4/development.json`。报告中 realMessageSends=0、realResetConsumptions=0，模拟写入次数另列。
- 当前开发模拟已经贯通最新额度错误 → 自动投递 → 唯一回执 → 对应轮次/Goal 完成 → 归档；这不是账号/Goal 绑定、真实回执或真实锁门禁的证据。
- 真实消息因账号/Goal 绑定、无正文唯一回执和真实旧锁目录未核对而阻断。指定卡 App Server 适配器已有实际 Schema 和隔离进程测试，尚未执行真实读取或消费。
- 可信签名、签名后的升级/卸载器正例以及公开发行仍待相应条件和明确授权。所有未验证、部分覆盖和 skip 必须保留在最终阶段记录中。

## 需求功能基线

| 功能 | 对应设计操作 | 实现位置与当前证据 | 尚须验收 |
|---|---|---|---|
| 实例发现、显式来源、重连 | C10–C12 | CodexReadonlyService、SourceConfiguration；阶段 2/3 历史与本轮来源测试 | 本轮安装版及真实新配置复验 |
| 额度快照与剩余额度 | C13–C14 | QuotaService、CodexReadonlyService；只读历史证据、模块异常测试 | 当前最终安装及 runner 回归 |
| 独立额度/任务检查计划 | C15–C16、C38–C40 | QuotaMonitor、SchedulerService；模块模拟、开发模拟 | 当前最终安装及 runner 周期验证 |
| 会话分页与有界状态 | C17–C18 | ReadonlyRegistry；阶段 2/3 真实只读证据 | 当前最终安装回归 |
| Goal 元数据 | C19 | CodexGoalReadonly；已读指定字段、未知保守失败 | 真实跨源账号绑定仍未知 |
| 空闲会话单次发送 | C20、C33–C35 | DeliveryService；模块模拟、独立 SEA CLI 开发模拟 | 真实消息适配和门禁未放行 |
| 任务创建、读取与启停 | C21–C26 | TaskService、TasksPage；模块模拟、CLI/IPC/MCP 开发模拟 | 本轮安装与远端复验 |
| 暂停编辑和修订授权 | C24–C25、C29–C30 | TaskService；暂停后编辑、计数保留、旧修订拒绝 | 全入口完整失败矩阵 |
| 队列、优先级和槽位 | C28、C36–C37 | SchedulerService、DeliveryService；非抢占/占槽模块模拟 | 真实投递前的兼容锁核对 |
| 仅观察、时段、有效期 | C23–C25、C29、C38–C40 | automation/policy、SchedulerService；跨午夜、到期和休眠处理 | 当前最终安装及本机时区复验 |
| 投递、回执与结果核对 | C20、C31、C33–C35 | 持久意图、held 槽、原 marker；响应丢失模块模拟和开发模拟 | 真实无正文唯一回执缺证据 |
| 完成识别、自动和人工归档 | C27、C53–C54 | TaskService、SchedulerService、DeliveryService；开发模拟完整 Goal 链 | 真实完成绑定与当前安装复验 |
| 模板及默认模板 | C41–C46 | TemplateService；正文快照不追改、content.read 复核 | 全入口复制/删除/默认项复验 |
| 指定卡片明细 | C47–C48 | CardService、FixtureCards、AppServerCards；模拟和实际 Schema | 真实只读尚未执行 |
| 指定卡预约、取消、消费和核对 | C49–C52 | CardService；原子领取、持久原键、错过不补用模块/开发模拟 | 真实消费对象和次数须另获授权 |
| 只读诊断和阻断原因 | C32、C58 | DiagnosticsService、任务只读检查；不推进调度 | 当前最终三入口复验 |
| 历史、归档、时间线和导出 | C53–C57、C81 | HistoryService、任务投影；固定边界和有界订阅测试 | 新业务完整分页/导出安装复验 |
| 通知、托盘和窗口 | C66–C70、C82 | NotificationService、固定平台操作；通知时段/游标模块测试，托盘历史及开发模拟 | 通知平台实际展示、安装版复验 |
| 分区设置、外观和数据入口 | C59–C65、C70 | SettingsService、AppearancePreview；阶段 3 历史证据 | 当前最终安装/runner 回归 |
| 离线帮助和能力发现 | C04–C05、C08–C09 | 包内帮助与同一能力目录 | 最终文档/Schema 一致性检查 |
| 应用版本、状态和退出 | C01–C03 | HostRouter、WorkerSupervisor；开发模拟驻托盘/退出/离线 | 当前最终安装和异常退出复验 |
| 在线更新和发行准备 | C71–C75 | 既有 UpdateService、NSIS、Actions 与 UpdatesPage；历史 G05 和本轮页面模拟 | 新业务升级保留、可信签名、当前包及 runner |
| 客户端授权和长操作 | C06–C07、C76–C80 | AccessService、导出/调度/更新操作投影；撤销和原键测试 | 当前最终入口与断连核对 |

## C01–C82 逐项操作映射

所有注册操作经同一目录提供 CLI 和 MCP，桌面经受限 IPC 调用唯一处理器。以下按操作映射，不以设计签名的历史文字替代当前严格 Schema；复杂参数以 `--input` 提交，适用的单 ID 查询可用 `--id`。

| 能力 | 设计编号 | 实现归属 | 当前证据状态 |
|---|---|---|---|
| app.status | C01 | HostRouter / WorkerSupervisor | 已实现；历史及开发模拟，最终安装回归待验 |
| app.version | C02 | HostRouter / 当前版本契约 | 已实现；最终版本/API/Schema 对照待验 |
| app.quit | C03 | HostRouter / DesktopPort | 已实现；开发模拟退出及离线，当前安装待验 |
| capabilities.list | C04 | definitions / HostRouter | 已实现；目录测试，最终完整性核对待验 |
| capabilities.describe | C05 | definitions / describe | 已实现；输入输出和权限目录，最终逐项核对待验 |
| operations.get | C06 | 操作所有权投影 / HistoryService | 已实现；导出历史与调度开发模拟，最终统一核对待验 |
| operations.cancel | C07 | 所属操作的取消处理器 | 已实现；只撤回尚未落地动作，完整类型矩阵待验 |
| help.get | C08 | 包内静态帮助 | 已实现；离线历史与 CLI 测试，最终内容待核对 |
| help.search | C09 | 包内静态帮助 | 已实现；离线历史与页面，最终内容待核对 |
| connections.discover | C10 | ReadonlyRegistry | 已实现；真实只读历史、异常夹具 |
| connections.get | C11 | ReadonlyRegistry | 已实现；真实只读历史、开发模拟 |
| connections.configure | C12 | SourceConfiguration | 已实现；显式保存下次启动、不自动切源，真实新卡来源待验 |
| quota.get | C13 | QuotaService / CodexReadonlyService | 已实现；只读历史、模块与开发模拟 |
| quota.refresh | C14 | CodexReadonlyService | 已实现；真实只读历史，不推进调度 |
| quota.policy.get | C15 | SettingsService / QuotaMonitor | 已实现；阶段 3 历史，最终回归待验 |
| quota.policy.update | C16 | SettingsService / QuotaMonitor | 已实现；阶段 3 历史，最终回归待验 |
| threads.list | C17 | CodexReadonlyService | 已实现；真实只读历史与开发模拟 |
| threads.get | C18 | CodexReadonlyService | 已实现；有界无正文读取，真实只读历史 |
| goals.get | C19 | CodexGoalReadonly / ReadonlyRegistry | 已实现；目标元数据只读，真实账号绑定未证实 |
| threads.send | C20 | DeliveryService | 已实现；单次模拟开发链；真实消息阻断 |
| tasks.list | C21 | TaskService | 已实现；模块、开发模拟；当前安装待验 |
| tasks.get | C22 | TaskService | 已实现；正文权限、模块与开发模拟 |
| tasks.create | C23 | TaskService | 已实现；默认暂停、快照和开发模拟 |
| tasks.update | C24 | TaskService | 已实现；暂停编辑/未决阻断模块与开发模拟 |
| tasks.enable | C25 | TaskService | 已实现；修订和绑定模块模拟，真实自动授权阻断 |
| tasks.pause | C26 | TaskService | 已实现；写入前暂停与开发模拟 |
| tasks.remove | C27 | TaskService | 已实现；暂停且无未决才归档，模块模拟 |
| tasks.reorder | C28 | SchedulerService | 已实现；同级队列修订，完整入口矩阵待验 |
| tasks.policy.get | C29 | TaskService | 已实现；源码/契约，逐项入口复验待验 |
| tasks.revisions.list | C30 | TaskService | 已实现；修订元数据，无历史正文透出 |
| tasks.reconcile | C31 | DeliveryService | 已实现；只核对原意图，模块模拟 |
| tasks.inspect | C32 | SchedulerService 只读检查 | 已实现；不刷新额度/推进调度，最终检查矩阵待验 |
| attempts.list | C33 | DeliveryService | 已实现；脱敏、固定边界分页，最终大页数复验待验 |
| attempts.get | C34 | DeliveryService | 已实现；提交/回执/轮次/槽位分别读取 |
| attempts.reconcile | C35 | DeliveryService | 已实现；原意图核对开发模拟，真实回执缺证据 |
| queue.get | C36 | SchedulerService | 已实现；占槽与候选读取，模块/页面模拟 |
| queue.configure | C37 | SchedulerService | 已实现；独立修订、降上限不抢占，模块模拟 |
| scheduler.settings.get | C38 | SchedulerService | 已实现；独立任务周期，默认关闭 |
| scheduler.settings.update | C39 | SchedulerService | 已实现；显式配置不立即派发，最终定时复验待验 |
| scheduler.runNow | C40 | SchedulerService / DeliveryService | 已实现；实际宿主自动任务开发模拟，操作可核对 |
| templates.list | C41 | TemplateService | 已实现；摘要分页，开发模拟 |
| templates.get | C42 | TemplateService | 已实现；content.read，模块/页面模拟 |
| templates.create | C43 | TemplateService | 已实现；原文或指定修订复制，模块/开发模拟 |
| templates.update | C44 | TemplateService | 已实现；不追改任务，模块与三入口开发模拟 |
| templates.delete | C45 | TemplateService | 已实现；保留既有任务快照，完整入口复验待验 |
| templates.setDefault | C46 | TemplateService | 已实现；默认项不追改既有任务，模块模拟 |
| resetCards.list | C47 | CardService | 已实现；明确来源/未知/过期，模拟；真实未执行 |
| resetCards.refresh | C48 | CardService / AppServerCards | 已实现；指定 CLI 适配器隔离测试；真实未执行 |
| resetAppointments.list | C49 | CardService | 已实现；脱敏、固定边界分页，开发模拟 |
| resetAppointments.create | C50 | CardService | 已实现；指定卡、原键、原子约束，模块/开发模拟 |
| resetAppointments.cancel | C51 | CardService | 已实现；pending 限定，模块/桌面开发模拟 |
| resetAppointments.reconcile | C52 | CardService / AppServerCards | 已实现；原卡原键和可能完成确认，模块模拟；真实未执行 |
| archives.list | C53 | TaskService | 已实现；固定边界归档投影，开发模拟完成链 |
| archives.get | C54 | TaskService | 已实现；正文权限和归档快照，模块/开发模拟 |
| events.query | C55 | HistoryService | 已实现；固定上界及 taskId 条件，历史/模块证据 |
| events.export | C56 | HistoryService | 已实现；固定目录、取消和一致快照，历史/模块证据 |
| timelines.get | C57 | TaskService | 已实现；有据事件和固定边界，最终分页复验待验 |
| diagnostics.run | C58 | DiagnosticsService / HostRouter | 已实现；真实只读历史，本轮任务联动待最终复验 |
| settings.get | C59 | SettingsService | 已实现；外观/监控分区，专用策略另有接口 |
| settings.update | C60 | SettingsService | 已实现；外观/监控唯一处理器，其他策略经专用能力 |
| appearance.get | C61 | SettingsService / AppearancePreview | 已实现；阶段 3 历史证据 |
| appearance.update | C62 | SettingsService | 已实现；分区修订、持久幂等，历史证据 |
| appearance.presets | C63 | SettingsService | 已实现；二十主题与预设，历史证据 |
| appearance.preview | C64 | AppearancePreview | 已实现；可见窗口/所有者限定，历史证据 |
| appearance.cancelPreview | C65 | AppearancePreview | 已实现；离页/隐藏撤销，历史证据 |
| notifications.settings.get | C66 | NotificationService | 已实现；默认关闭、独立修订，模块/页面模拟 |
| notifications.settings.update | C67 | NotificationService | 已实现；时段/去重测试，平台展示待验 |
| desktop.status | C68 | DesktopPort | 已实现；窗口/托盘历史与开发模拟 |
| desktop.show | C69 | DesktopPort | 已实现；只显示现有窗口、离线不拉起 |
| desktop.openDataDirectory | C70 | 固定 DesktopPort | 已实现；当前 profile 固定路径，历史验证 |
| updates.status | C71 | UpdateService | 已实现；持久状态/候选，历史 G05 和新页面 |
| updates.check | C72 | UpdateService | 已实现；固定源/通道检查，历史及模块证据 |
| updates.download | C73 | UpdateService | 已实现；固定候选/哈希，历史及模块证据；本轮新包待验 |
| updates.install | C74 | UpdateService / 生命周期 | 已实现；独立确认、备份/清理/验签门禁，当前业务升级待验 |
| updates.configure | C75 | UpdateService 策略 | 已实现；固定发行通道、只读周期、自动下载固定关闭，最终验证待验 |
| access.request | C76 | AccessService | 已实现；新增副作用权限独立申请、不自动扩权 |
| access.list | C77 | AccessService | 已实现；授权管理历史/开发模拟 |
| access.grant | C78 | AccessService | 已实现；明确勾选、码/修订和委派限制 |
| access.revoke | C79 | AccessService | 已实现；唯一授权源与最终边界复核，模块/开发模拟 |
| operations.list | C80 | 所属模块操作投影 | 已实现；本人/管理视图，完整类型复验待验 |
| events.subscribe | C81 | HistoryService / CLI 跟随适配 | 已实现；有界批次/恢复游标、慢输出隔离测试，安装/远端待验 |
| desktop.openConsole | C82 | 固定 DesktopPort | 已实现；仅本窗口诊断控制台，最终三入口复验待验 |

## A01–A40 验收场景映射

表中「直接证据」只表示所列测试/报告实际覆盖的子场景。未经当前最终代码的本机、安装或 runner 实跑，不填整项通过。

| 场景 | 验收编号 | 直接证据或实现 | 当前状态与缺口 |
|---|---|---|---|
| 构造和显式生命周期 | A01 | core、stage3、app-server-cards 模块测试；新增服务构造只持依赖 | 部分覆盖；新模块完整导入/构造矩阵待最终验证 |
| 依赖和唯一入口 | A02 | check-boundaries、能力目录、CLI/renderer 打包依赖检查 | 已有结构检查；最终代码的全量边界结果待登记 |
| 离线不拉起 | A03 | 阶段 2/3 历史、stage4 开发模拟、subscription 离线测试 | 开发模拟有直接证据；本轮安装版待验 |
| 驻托盘和未就绪 | A04 | supervisor 测试、stage4 开发模拟驻托盘查询 | 部分覆盖；本轮实际安装及异常恢复待验 |
| 三入口一致 | A05 | stage4 模板/任务 CLI/IPC/MCP 同处理器和原键记录 | 部分覆盖；全部新操作及副作用失败矩阵待验 |
| CLI 编码、输入和帧边界 | A06 | transport、core、subscription 测试及独立 SEA CLI | 已有直接测试；最终打包 CLI 中文路径回归待验 |
| 独立权限、配对和撤销 | A07 | access、access-store、channel、automation 测试；stage4 读者拒绝/撤销 | 模块与开发模拟；当前安装版新增权限复验待验 |
| 持久幂等与重连 | A08 | automation、delivery、cards、update 测试，stage4 原键重放 | 模块/开发模拟直接覆盖；真实远端结果未验 |
| 修订冲突和暂停编辑 | A09 | stage3、automation 测试及 stage4 暂停修订 | 模块/开发模拟直接覆盖；完整入口并发矩阵待验 |
| 实例、身份和 Schema 变化 | A10 | readonly、app-server-cards 异常测试和显式来源 | 实际只读历史与隔离异常；真实新增卡来源未验 |
| 额度未知、预计时间和恢复 | A11 | readonly 缺窗口/过期测试，delivery 最终额度检查 | 模块证据；本轮实际宿主异常矩阵待验 |
| 只读查询与主动推进区分 | A12 | diagnostics、stage3 测试；stage4 显式 runNow 自动任务 | 部分覆盖；所有新查询不改业务真值的快照对照待验 |
| Goal 只读和未知 | A13 | readonly 临时 SQLite 测试、真实只读历史 | 只读范围已有证据；跨源账号绑定仍未证实 |
| 最新轮次触发和正常单轮 | A14 | delivery 旧错误去重、message-dispatch 错误识别；实际宿主模拟链 | 部分覆盖；审批/中断/普通错误完整实际宿主矩阵待验 |
| 任务具体授权与累计上限 | A15 | automation 授权/修订、delivery 配置与次数核验 | 模块模拟；真实自动授权仍阻断 |
| 原子意图、计数、事件和争槽 | A16 | automation 事务故障、delivery 并发、sqlite 原子性测试 | 模块模拟直接覆盖；最终全部故障点及实际安装待验 |
| 写入前暂停、撤销和账号变化 | A17 | delivery 边界暂停、message-dispatch 最终核验、app-server-cards guard | 隔离模块/进程证据；真实 socket 门禁未验 |
| 写入后未知和崩溃恢复 | A18 | delivery 原 marker/held 保留，message-dispatch 响应丢失 | 模块直接覆盖；实际业务进程崩溃及安装版待验 |
| 提交、回执、轮次和最终完成 | A19 | delivery 状态测试；stage4 实际宿主模拟至 Goal 完成/归档 | 开发模拟直接覆盖；真实唯一回执和绑定未证实 |
| 未决禁止编辑、移除或重建 | A20 | delivery / automation 阻断测试 | 模块直接覆盖；三入口完整绕行矩阵待验 |
| 非抢占队列和仅观察 | A21 | delivery 队列/仅观察测试，SchedulerService 排序 | 部分覆盖；降上限、高优先级到达和同级移动组合待验 |
| 跨午夜、到期、时区和休眠 | A22 | delivery 本机时段边界、休眠失效处理 | 部分覆盖；真实系统时区变化/安装版休眠尚待验 |
| 单次发送不得绕过托管 | A23 | DeliveryService 准入；stage4 合格空闲目标开发模拟 | 部分覆盖；全部拒绝组合的实际宿主证据待验 |
| 旧版锁兼容与未知持有者 | A24 | target-lease 原旧源码隔离互操作与竞争测试 | 仅隔离协议证据；真实锁目录门禁未过 |
| 指定卡唯一预约和原子领取 | A25 | cards 并发领取、账号变化、另一张已有预约阻断测试 | 模块/开发模拟直接覆盖；真实卡未验 |
| 响应丢失原卡原键核对 | A26 | cards、app-server-cards 原键和四结果测试 | 隔离模拟直接覆盖；真实消费与核对待授权 |
| 错过、短休眠和不可撤回 | A27 | cards 取消、错过、短休眠跨预约测试 | 模块直接覆盖；实际退出/休眠安装版待验 |
| 模板不追改、修订暂停、分区独立 | A28 | automation、stage3 模块测试和 stage4 三入口模板快照 | 模块/开发模拟直接覆盖；所有模板操作入口待验 |
| 固定边界、过滤和取消导出 | A29 | stage3、subscription 游标/慢客户端/撤销测试 | 历史与新增模块证据；新业务大分页/导出安装复验待验 |
| 高版本、迁移、WAL 备份 | A30 | sqlite、stage3 事务迁移与 VACUUM INTO 测试 | 基础直接覆盖；Schema 11 新业务保留和恢复尚待本轮验证 |
| API major 与长操作断连 | A31 | protocol/transport、持久调度和更新操作查询 | 部分覆盖；当前两版安装及长操作断连矩阵待验 |
| 更新通道和源失败 | A32 | update、release-policy 测试；G05 历史 GitHub 实测 | 历史/模块证据；当前最终安装包与新增策略待验 |
| 发行清单和产物不偷换 | A33 | 固定发布配置、check-release、G05 哈希/版本历史 | 部分覆盖；本轮最终安装包/清单/runner 待验 |
| 可信签名及异常拒绝 | A34 | release-policy 无签名拒绝负例、固定发布者/时间戳门禁 | 正例未验；可信签名条件未配置，完整 G06 未过 |
| 安装前在途和进程占用 | A35 | update 故障点、G05 两版实装历史、prepareUpdate 协调 | 当前新业务/新包的实际安装矩阵待验 |
| 升级保留未决消息和卡消费 | A36 | 未决持久状态、统一更新备份和启动核对实现 | 新业务两版实装、迁移失败与不重放证据待验 |
| ACL、超限帧和慢订阅 | A37 | transport、windows-powershell、subscription 的边界和慢输出测试 | 模块直接覆盖；本轮安装版和 runner 回归待验 |
| 托盘、恢复提醒和预览撤销 | A38 | stage4 驻托盘；notifications 时段/持久游标；阶段 3 预览历史 | 部分覆盖；通知原生展示和安装版复验待验 |
| 功能、能力和文档覆盖 | A39 | 本表、definitions、Schema 与 check-docs | 83 项已映射；最终一致性及全部入口结果仍待核对 |
| 证据分类和未授权副作用审计 | A40 | stage4 real/fixture 独立计数；阶段 4/5 的真实阻断记录 | 当前真实副作用为零；本轮全部报告、runner 和发行目录最终审计待验 |

## 最终登记规则

- 新本机、安装和 runner 结果分别追加到对应阶段记录；报告缺失、失败或 skip 不能转换为「通过」。
- 用户批准真实测试前，应先列具体账号/目标或指定卡、动作、次数、影响和门禁结果；本表不构成授权。
- 公开发行必须在可审阅安装包、版本/哈希清单和验证完成后单独确认；当前不标记 stable 或公开 Release 完成。
- 当前人工备份与恢复步骤见 [备份与故障恢复](recovery.md)，不提供虚构的公开 SQL、备份或任意路径接口。
