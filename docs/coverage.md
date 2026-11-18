# 最终功能与验收覆盖表

## 口径和证据分界

- 需求：REQ-20261117-05 / REQ-20261118-01；本表对应阶段 4–6 的当前实现快照，不表示本轮总验收完成。
- 当前能力目录为 83 项、API major 3、SQLite Schema 11。C01–C82 均有对应处理器，另有读取已保存来源的 connections.configuration；数量不是验收结论。
- 「已实现」指存在公开契约及唯一处理器；「模块模拟」指隔离端口、数据库或进程模拟测试；「开发模拟」指本机开发版 CLI/IPC/MCP/页面的实际运行记录。
- 阶段 2/3、G01–G05 的历史通过只支持其当时范围。当前最终代码已完成本机/runner 回归及实际安装/升级，证据见阶段 6；真实副作用与可信签名仍未验。
- 当前本机模块记录为 `artifacts/delivery-gates/unit-tests.tap`，原 167 项记录留作历史；开发模拟记录为 `artifacts/stage4/development.json`。报告中 realMessageSends=0、realResetConsumptions=0，模拟写入次数另列。
- 当前开发模拟已经贯通最新额度错误 → 自动投递 → 唯一回执 → 对应轮次/Goal 完成 → 归档；这不是账号/Goal 绑定、真实回执或真实锁门禁的证据。
- 真实消息因当前执行账号/Goal 绑定和源端无正文完整持久唯一回执缺证据而阻断；旧工具目前由用户确认没有托管，未计旧版实际兼容正例。指定卡 App Server 适配器已有实际 Schema 和隔离进程测试，真实只读已有一次有效报告，真实消费按用户选择暂缓。
- 可信签名、签名后的升级/卸载器正例以及公开发行仍待相应条件和明确授权。所有未验证、部分覆盖和 skip 必须保留在最终阶段记录中。

## 本轮直接证据索引

- 本机：167 项模块全通过、无 skip；beta.10 安装 4+9+8+10 组，升级/卸载/重装 5 组；独立定时器与原生通知另列。
- runner：CI 44224371601、Preview 44224408068 success；模块 163 pass、4 旧源码测试 skip；阶段 4/5 安装 10 组。
- 当前产物、逐报告路径/哈希、修复与未验项见 [阶段 6](stage6.md) 及本机 final-manifest.json。真实发送/卡消费为零。

## 需求功能基线

| 功能 | 对应设计操作 | 实现位置与当前证据 | 尚须验收 |
|---|---|---|---|
| 实例发现、显式来源、重连 | C10–C12 | CodexReadonlyService、SourceConfiguration；阶段 2/3 历史与本轮来源测试 | 本机/runner 显式来源配置已复验；新卡真实只读已取得一次有效报告；真实消费暂缓 |
| 额度快照与剩余额度 | C13–C14 | QuotaService、CodexReadonlyService；只读历史证据、模块异常测试 | 当前最终安装及 runner 通过 |
| 独立额度/任务检查计划 | C15–C16、C38–C40 | QuotaMonitor、SchedulerService；模块模拟、开发模拟 | 额度周期安装回归；任务周期另有实际十秒定时器记录 |
| 会话分页与有界状态 | C17–C18 | ReadonlyRegistry；阶段 2/3 真实只读证据 | 当前最终安装模拟通过 |
| Goal 元数据 | C19 | CodexGoalReadonly；已读指定字段、未知保守失败 | 已实现；Goal 元数据只读，真实跨源账号绑定未证实 |
| 空闲会话单次发送 | C20、C33–C35 | DeliveryService；模块模拟、独立 SEA CLI 开发模拟 | 真实消息适配和门禁未放行 |
| 任务创建、读取与启停 | C21–C26 | TaskService、TasksPage；模块模拟、CLI/IPC/MCP 开发模拟 | 最终本机/runner 三入口安装模拟通过 |
| 暂停编辑和修订授权 | C24–C25、C29–C30 | TaskService；暂停后编辑、计数保留、旧修订拒绝 | 模块失败边界与最终代表性三入口通过，真实副作用未验 |
| 队列、优先级和槽位 | C28、C36–C37 | SchedulerService、DeliveryService；非抢占/占槽模块模拟 | 真实投递前的兼容锁核对 |
| 仅观察、时段、有效期 | C23–C25、C29、C38–C40 | automation/policy、SchedulerService；跨午夜、到期和休眠处理 | 最终安装模拟电源事件通过；真实系统时区切换未做 |
| 投递、回执与结果核对 | C20、C31、C33–C35 | 持久意图、held 槽、原 marker；响应丢失模块模拟和开发模拟 | 真实无正文唯一回执缺证据 |
| 完成识别、自动和人工归档 | C27、C53–C54 | TaskService、SchedulerService、DeliveryService；开发模拟完整 Goal 链 | 最终安装模拟完成链通过；真实绑定未证实 |
| 模板及默认模板 | C41–C46 | TemplateService；正文快照不追改、content.read 复核 | 最终 CLI/IPC/MCP 复制/删除/默认项通过 |
| 指定卡片明细 | C47–C48 | CardService、FixtureCards、AppServerCards；模拟和实际 Schema | 真实只读已有一次有效报告；真实消费暂缓 |
| 指定卡预约、取消、消费和核对 | C49–C52 | CardService；原子领取、持久原键、错过不补用模块/开发模拟 | 真实消费对象和次数须另获授权 |
| 只读诊断和阻断原因 | C32、C58 | DiagnosticsService、任务只读检查；不推进调度 | 最终三入口与模块状态快照通过 |
| 历史、归档、时间线和导出 | C53–C57、C81 | HistoryService、任务投影；固定边界和有界订阅测试 | 固定边界模块与最终安装导出/取消/崩溃清理通过 |
| 通知、托盘和窗口 | C66–C70、C82 | NotificationService、固定平台操作；通知时段/游标模块测试，托盘历史及开发模拟 | 本机原生 show=2 固定文本，最终本机/runner 托盘通过 |
| 分区设置、外观和数据入口 | C59–C65、C70 | SettingsService、AppearancePreview；阶段 3 历史证据 | 当前最终本机/runner 安装模拟通过 |
| 离线帮助和能力发现 | C04–C05、C08–C09 | 包内帮助与同一能力目录 | 最终目录/输出 Schema/文档检查通过 |
| 应用版本、状态和退出 | C01–C03 | HostRouter、WorkerSupervisor；开发模拟驻托盘/退出/离线 | 当前最终安装及 worker 崩溃恢复通过 |
| 在线更新和发行准备 | C71–C75 | 既有 UpdateService、NSIS、Actions 与 UpdatesPage；历史 G05 和本轮页面模拟 | 新业务升级/卸载/重装、本机包与 runner 已验；可信签名待办 |
| 客户端授权和长操作 | C06–C07、C76–C80 | AccessService、导出/调度/更新操作投影；撤销和原键测试 | 最终安装撤销/操作核对与模块断连恢复通过 |

## C01–C82 逐项操作映射

所有注册操作经同一目录提供 CLI 和 MCP，桌面经受限 IPC 调用唯一处理器。以下按操作映射，不以设计签名的历史文字替代当前严格 Schema；复杂参数以 `--input` 提交，适用的单 ID 查询可用 `--id`。

| 能力 | 设计编号 | 实现归属 | 当前证据状态 |
|---|---|---|---|
| app.status | C01 | HostRouter / WorkerSupervisor | 已实现；当前 G02/G03 及本机/runner G06 安装复验，版本/API/Schema/目录一致 |
| app.version | C02 | HostRouter / 当前版本契约 | 已实现；当前 G02/G03 及本机/runner G06 安装复验，版本/API/Schema/目录一致 |
| app.quit | C03 | HostRouter / DesktopPort | 已实现；当前 G02/G03 及本机/runner G06 安装复验，版本/API/Schema/目录一致 |
| capabilities.list | C04 | definitions / HostRouter | 已实现；当前 G02/G03 及本机/runner G06 安装复验，版本/API/Schema/目录一致 |
| capabilities.describe | C05 | definitions / describe | 已实现；当前 G02/G03 及本机/runner G06 安装复验，版本/API/Schema/目录一致 |
| operations.get | C06 | 操作所有权投影 / HistoryService | 已实现；导出/调度/更新所属模块投影，模块所有权与重启测试、实际调度操作核对 |
| operations.cancel | C07 | 所属操作的取消处理器 | 已实现；导出取消/撤销实装，完成调度不可撤回实装，更新取消模块测试 |
| help.get | C08 | 包内静态帮助 | 已实现；最终安装版离线帮助与页面搜索通过，不读取业务或创建 profile |
| help.search | C09 | 包内静态帮助 | 已实现；最终安装版离线帮助与页面搜索通过，不读取业务或创建 profile |
| connections.discover | C10 | ReadonlyRegistry | 已实现；真实只读历史与当前本机/runner 安装模拟通过，未知与断连不回退 |
| connections.get | C11 | ReadonlyRegistry | 已实现；真实只读历史与当前本机/runner 安装模拟通过，未知与断连不回退 |
| connections.configure | C12 | SourceConfiguration | 已实现；显式保存下次启动、不自动切源；codexHome/旧锁目录只读选择、卡路径和持久上限已验，新增真实卡只读一份有效报告 |
| quota.get | C13 | QuotaService / CodexReadonlyService | 已实现；真实只读历史与当前本机/runner 安装模拟通过，未知与断连不回退 |
| quota.refresh | C14 | CodexReadonlyService | 已实现；真实只读历史与当前本机/runner 安装模拟通过，未知与断连不回退 |
| quota.policy.get | C15 | SettingsService / QuotaMonitor | 已实现；最终安装版与 runner 独立只读额度周期复验 |
| quota.policy.update | C16 | SettingsService / QuotaMonitor | 已实现；最终安装版与 runner 独立只读额度周期复验 |
| threads.list | C17 | CodexReadonlyService | 已实现；真实只读历史与当前本机/runner 安装模拟通过，未知与断连不回退 |
| threads.get | C18 | CodexReadonlyService | 已实现；真实只读历史与当前本机/runner 安装模拟通过，未知与断连不回退 |
| goals.get | C19 | CodexGoalReadonly / ReadonlyRegistry | 已实现；Goal 元数据只读，真实跨源账号绑定未证实 |
| threads.send | C20 | DeliveryService | 已实现；最终 CLI/IPC/MCP 原键模拟投递及回执核对，真实消息门禁阻断 |
| tasks.list | C21 | TaskService | 已实现；模块事务/权限/暂停编辑与最终本机/runner 三入口安装模拟 |
| tasks.get | C22 | TaskService | 已实现；模块事务/权限/暂停编辑与最终本机/runner 三入口安装模拟 |
| tasks.create | C23 | TaskService | 已实现；模块事务/权限/暂停编辑与最终本机/runner 三入口安装模拟 |
| tasks.update | C24 | TaskService | 已实现；模块事务/权限/暂停编辑与最终本机/runner 三入口安装模拟 |
| tasks.enable | C25 | TaskService | 已实现；精确修订/轮次/Goal 授权模块和安装模拟，真实自动授权阻断 |
| tasks.pause | C26 | TaskService | 已实现；模块事务/权限/暂停编辑与最终本机/runner 三入口安装模拟 |
| tasks.remove | C27 | TaskService | 已实现；模块修订/分页/非抢占与最终 CLI/IPC/MCP 策略、修订、移动、归档实跑 |
| tasks.reorder | C28 | SchedulerService | 已实现；模块修订/分页/非抢占与最终 CLI/IPC/MCP 策略、修订、移动、归档实跑 |
| tasks.policy.get | C29 | TaskService | 已实现；模块修订/分页/非抢占与最终 CLI/IPC/MCP 策略、修订、移动、归档实跑 |
| tasks.revisions.list | C30 | TaskService | 已实现；模块修订/分页/非抢占与最终 CLI/IPC/MCP 策略、修订、移动、归档实跑 |
| tasks.reconcile | C31 | DeliveryService | 已实现；实际 worker 模拟恢复、原意图核对与安装升级后不补发 |
| tasks.inspect | C32 | SchedulerService 只读检查 | 已实现；模块完整快照证明不刷新/不改业务，模拟 CLI/页面实跑；真实路径复用固定元数据门禁，不调用会话接口 |
| attempts.list | C33 | DeliveryService | 已实现；提交/回执/轮次/槽位脱敏投影，共享签名游标与固定上界，最终安装读取 |
| attempts.get | C34 | DeliveryService | 已实现；提交/回执/轮次/槽位脱敏投影，共享签名游标与固定上界，最终安装读取 |
| attempts.reconcile | C35 | DeliveryService | 已实现；原意图核对与故障恢复安装模拟，真实无正文唯一回执缺证据 |
| queue.get | C36 | SchedulerService | 已实现；三入口实际配置/读取，模块优先级/同级移动/降上限不抢占 |
| queue.configure | C37 | SchedulerService | 已实现；三入口实际配置/读取，模块优先级/同级移动/降上限不抢占 |
| scheduler.settings.get | C38 | SchedulerService | 已实现；独立周期默认关闭、保存不立即派发；本机 beta.10 实际十秒定时器验证 |
| scheduler.settings.update | C39 | SchedulerService | 已实现；独立周期默认关闭、保存不立即派发；本机 beta.10 实际十秒定时器验证 |
| scheduler.runNow | C40 | SchedulerService / DeliveryService | 已实现；本机/runner 自动任务模拟、持久操作核对，重启失败不重放 |
| templates.list | C41 | TemplateService | 已实现；最终 CLI/IPC/MCP 复制/默认/删除/正文授权与快照不追改，原键复核 |
| templates.get | C42 | TemplateService | 已实现；最终 CLI/IPC/MCP 复制/默认/删除/正文授权与快照不追改，原键复核 |
| templates.create | C43 | TemplateService | 已实现；最终 CLI/IPC/MCP 复制/默认/删除/正文授权与快照不追改，原键复核 |
| templates.update | C44 | TemplateService | 已实现；最终 CLI/IPC/MCP 复制/默认/删除/正文授权与快照不追改，原键复核 |
| templates.delete | C45 | TemplateService | 已实现；最终 CLI/IPC/MCP 复制/默认/删除/正文授权与快照不追改，原键复核 |
| templates.setDefault | C46 | TemplateService | 已实现；最终 CLI/IPC/MCP 复制/默认/删除/正文授权与快照不追改，原键复核 |
| resetCards.list | C47 | CardService | 已实现；实际 Schema 与隔离进程协议、账号变化/超时/未知测试；真实只读已取得一次有效报告；真实消费暂缓 |
| resetCards.refresh | C48 | CardService / AppServerCards | 已实现；实际 Schema 与隔离进程协议、账号变化/超时/未知测试；真实只读已取得一次有效报告；真实消费暂缓 |
| resetAppointments.list | C49 | CardService | 已实现；本机/runner 指定模拟卡领取/取消、短休眠错过、跨卡未决与重启恢复 |
| resetAppointments.create | C50 | CardService | 已实现；本机/runner 指定模拟卡领取/取消、短休眠错过、跨卡未决与重启恢复 |
| resetAppointments.cancel | C51 | CardService | 已实现；本机/runner 指定模拟卡领取/取消、短休眠错过、跨卡未决与重启恢复 |
| resetAppointments.reconcile | C52 | CardService / AppServerCards | 已实现；原卡原键明确核对、响应丢失及升级/卸载/重装模拟通过；真实未执行 |
| archives.list | C53 | TaskService | 已实现；模块固定归档边界、实际三入口归档及自动 Goal 完成链 |
| archives.get | C54 | TaskService | 已实现；模块固定归档边界、实际三入口归档及自动 Goal 完成链 |
| events.query | C55 | HistoryService | 已实现；当前安装版/runner 固定边界查询、JSONL 导出、撤销/崩溃清理 |
| events.export | C56 | HistoryService | 已实现；当前安装版/runner 固定边界查询、JSONL 导出、撤销/崩溃清理 |
| timelines.get | C57 | TaskService | 已实现；实际三入口时间线，模块资源绑定与固定签名边界分页 |
| diagnostics.run | C58 | DiagnosticsService / HostRouter | 已实现；beta.13 安装/runner 门禁六组，CLI/IPC/MCP/页面一致；本机真实只读六组，门禁 blocked |
| settings.get | C59 | SettingsService | 已实现；当前本机/runner 阶段 3 安装回归，分区修订与预览撤销保持 |
| settings.update | C60 | SettingsService | 已实现；当前本机/runner 阶段 3 安装回归，分区修订与预览撤销保持 |
| appearance.get | C61 | SettingsService / AppearancePreview | 已实现；当前本机/runner 阶段 3 安装回归，分区修订与预览撤销保持 |
| appearance.update | C62 | SettingsService | 已实现；当前本机/runner 阶段 3 安装回归，分区修订与预览撤销保持 |
| appearance.presets | C63 | SettingsService | 已实现；当前本机/runner 阶段 3 安装回归，分区修订与预览撤销保持 |
| appearance.preview | C64 | AppearancePreview | 已实现；当前本机/runner 阶段 3 安装回归，分区修订与预览撤销保持 |
| appearance.cancelPreview | C65 | AppearancePreview | 已实现；当前本机/runner 阶段 3 安装回归，分区修订与预览撤销保持 |
| notifications.settings.get | C66 | NotificationService | 已实现；三入口独立策略、模块时段/持久去重，本机原生 show=2 固定文本 |
| notifications.settings.update | C67 | NotificationService | 已实现；三入口独立策略、模块时段/持久去重，本机原生 show=2 固定文本 |
| desktop.status | C68 | DesktopPort | 已实现；最终本机/runner 关窗驻托盘、重开原窗口、明确退出清理 |
| desktop.show | C69 | DesktopPort | 已实现；最终本机/runner 关窗驻托盘、重开原窗口、明确退出清理 |
| desktop.openDataDirectory | C70 | 固定 DesktopPort | 已实现；固定当前 profile 路径、无任意路径透传，既有固定平台操作验证 |
| updates.status | C71 | UpdateService | 已实现；更新模块/策略与当前安装页面通过；Preview 明确不支持官方更新 |
| updates.check | C72 | UpdateService | 已实现；更新模块/策略与当前安装页面通过；Preview 明确不支持官方更新 |
| updates.download | C73 | UpdateService | 已实现；固定候选/哈希与失败模块测试、G05 真实下载历史；无新公开 Release 下载正例 |
| updates.install | C74 | UpdateService / 生命周期 | 已实现；当前新业务两版 NSIS 升级/卸载/重装保留未决；可信签名在线安装正例未验 |
| updates.configure | C75 | UpdateService 策略 | 已实现；固定通道、自动只读检查、禁止自动下载，模块与页面实际验证 |
| access.request | C76 | AccessService | 已实现；最终安装版/runner 独立新增权限与撤销，最终写入边界再核验；旧授权不扩权 |
| access.list | C77 | AccessService | 已实现；最终安装版/runner 独立新增权限与撤销，最终写入边界再核验；旧授权不扩权 |
| access.grant | C78 | AccessService | 已实现；最终安装版/runner 独立新增权限与撤销，最终写入边界再核验；旧授权不扩权 |
| access.revoke | C79 | AccessService | 已实现；最终安装版/runner 独立新增权限与撤销，最终写入边界再核验；旧授权不扩权 |
| operations.list | C80 | 所属模块操作投影 | 已实现；导出/调度/更新所属模块投影，模块所有权与重启测试、实际调度操作核对 |
| events.subscribe | C81 | HistoryService / CLI 跟随适配 | 已实现；有界批次/恢复游标/过滤/撤销/慢 stdout 隔离测试，统一契约映射；非实时无限队列 |
| desktop.openConsole | C82 | 固定 DesktopPort | 已实现；固定本窗口控制台路由、桌面受限 IPC，无任意 Shell；结构边界检查 |

## A01–A40 验收场景映射

表中「直接证据」只表示所列测试/报告实际覆盖的子场景。未经当前最终代码的本机、安装或 runner 实跑，不填整项通过。

| 场景 | 验收编号 | 直接证据或实现 | 当前状态与缺口 |
|---|---|---|---|
| 构造和显式生命周期 | A01 | core、stage3、app-server-cards 模块测试；新增服务构造只持依赖 | 新增业务构造无 IO 直接测试；既有模块及两个实际适配器构造测试保留 |
| 依赖和唯一入口 | A02 | check-boundaries、能力目录、CLI/renderer 打包依赖检查 | 最终构建与 check-boundaries 通过，CLI/UI 打包依赖和目录唯一映射通过 |
| 离线不拉起 | A03 | 阶段 2/3 历史、stage4 开发模拟、subscription 离线测试 | 最终本机/runner 安装 CLI/MCP 离线不创建 profile、不拉起 |
| 驻托盘和未就绪 | A04 | supervisor 测试、stage4 开发模拟驻托盘查询 | 最终实装驻托盘/查询/重开通过；worker 崩溃恢复与未就绪模块回归 |
| 三入口一致 | A05 | stage4 模板/任务 CLI/IPC/MCP 同处理器和原键记录 | 最终三入口代表性结果/错误/原键副作用一致；全能力同目录与唯一处理器结构检查 |
| CLI 编码、输入和帧边界 | A06 | transport、core、subscription 测试及独立 SEA CLI | 最终 SEA CLI 中文空格路径/空 PATH/中文查询/离线码通过；输入帧边界模块回归 |
| 独立权限、配对和撤销 | A07 | access、access-store、channel、automation 测试；stage4 读者拒绝/撤销 | 最终安装配对/正文权限/独立新增权限及撤销通过，派发最终边界另测 |
| 持久幂等与重连 | A08 | automation、delivery、cards、update 测试，stage4 原键重放 | 持久幂等、并发原键、重启与原结果核对模块/实际 worker 通过；真实副作用未验 |
| 修订冲突和暂停编辑 | A09 | stage3、automation 测试及 stage4 暂停修订 | 暂停编辑、独立修订冲突与旧修订拒绝模块/安装三入口通过 |
| 实例、身份和 Schema 变化 | A10 | readonly、app-server-cards 异常测试和显式来源 | 真实只读历史与当前隔离账号/Schema 异常通过；真实卡只读已验；真实消费暂缓 |
| 额度未知、预计时间和恢复 | A11 | readonly 缺窗口/过期测试，delivery 最终额度检查 | 模块未知/过期/最终额度复核及最终页面 blocked/unknown 通过；不按时间推断恢复 |
| 只读查询与主动推进区分 | A12 | diagnostics、stage3 测试；stage4 显式 runNow 自动任务 | 只读诊断完整状态快照对照通过；实际 runNow 与实际十秒自动周期分别验证 |
| Goal 只读和未知 | A13 | readonly 临时 SQLite 测试、真实只读历史 | Goal 指定字段只读证据保留；真实跨源账号绑定未证实，阻断真实自动化 |
| 最新轮次触发和正常单轮 | A14 | delivery 旧错误去重、message-dispatch 错误识别；实际宿主模拟链 | 最新明确额度错误与旧错误去重模块、实际宿主模拟 Goal 链通过；真实触发未验 |
| 任务具体授权与累计上限 | A15 | automation 授权/修订、delivery 配置与次数核验 | 具体授权/修订/上限模块与安装模拟通过；真实自动授权仍阻断 |
| 原子意图、计数、事件和争槽 | A16 | automation 事务故障、delivery 并发、sqlite 原子性测试 | 事务故障、并发同目标与槽位模块通过，实际安装保留 held/累计次数 |
| 写入前暂停、撤销和账号变化 | A17 | delivery 边界暂停、message-dispatch 最终核验、app-server-cards guard | 写入前暂停/撤销/账号/额度错误/休眠世代及两个适配器 finalGuard 隔离测试通过 |
| 写入后未知和崩溃恢复 | A18 | delivery 原 marker/held 保留，message-dispatch 响应丢失 | 实际 worker 模拟写后丢响应、退出重启保留，原意图不重放通过；非真实丢包 |
| 提交、回执、轮次和最终完成 | A19 | delivery 状态测试；stage4 实际宿主模拟至 Goal 完成/归档 | 模拟提交/唯一回执/轮次/Goal 完成归档通过；真实回执与账号绑定未证实 |
| 未决禁止编辑、移除或重建 | A20 | delivery / automation 阻断测试 | 模块未决编辑/移除/换键/重建拒绝；实际安装新键绕行拒绝 |
| 非抢占队列和仅观察 | A21 | delivery 队列/仅观察测试，SchedulerService 排序 | 非抢占、仅观察、优先级、同级移动及降上限保留 held 模块与实际队列操作通过 |
| 跨午夜、到期、时区和休眠 | A22 | delivery 本机时段边界、休眠失效处理 | 本机跨午夜/到期与模拟电源事件通过；真实系统休眠/时区切换未执行 |
| 单次发送不得绕过托管 | A23 | DeliveryService 准入；stage4 合格空闲目标开发模拟 | 统一 DeliveryService 及模块准入、最终三入口模拟单次发送/原键不重放通过 |
| 旧版锁兼容与未知持有者 | A24 | target-lease 原旧源码隔离互操作与竞争测试 | 本机原旧源码隔离互操作通过；runner 原四项及新增旧 unlock 复现共五项缺源码 skip；用户确认旧工具没有托管，不计真实并行兼容正例 |
| 指定卡唯一预约和原子领取 | A25 | cards 并发领取、账号变化、另一张已有预约阻断测试 | 模块并发原子领取/已有预约跨卡阻断及最终安装模拟通过；真实只读已验；真实消费暂缓 |
| 响应丢失原卡原键核对 | A26 | cards、app-server-cards 原键和四结果测试 | 实际 worker/隔离协议响应丢失、原卡原键核对和四结果通过；真实消费按用户选择暂缓 |
| 错过、短休眠和不可撤回 | A27 | cards 取消、错过、短休眠跨预约测试 | 模块取消/撤销/短休眠错过、实际模拟电源事件及退出重启通过；真实休眠未做 |
| 模板不追改、修订暂停、分区独立 | A28 | automation、stage3 模块测试和 stage4 三入口模板快照 | 最终三入口模板复制/默认/删除/不追改、暂停编辑和独立分区通过 |
| 固定边界、过滤和取消导出 | A29 | stage3、subscription 游标/慢客户端/撤销测试 | 固定任务/归档/修订/事件边界、过滤/慢订阅模块与最终安装导出/取消/崩溃清理通过 |
| 高版本、迁移、WAL 备份 | A30 | sqlite、stage3 事务迁移与 VACUUM INTO 测试 | Schema 10→11 未决迁移、Schema 3→11 设置迁移和一致备份实际安装通过；未知高版本/损坏模块测试 |
| API major 与长操作断连 | A31 | protocol/transport、持久调度和更新操作查询 | API/Schema 三进程一致、原操作核对及断连/中断恢复模块与实装通过 |
| 更新通道和源失败 | A32 | update、release-policy 测试；G05 历史 GitHub 实测 | 更新模块固定通道、断网/下载/准备失败与当前 Preview 拒绝通过；G05 真实更新历史保留 |
| 发行清单和产物不偷换 | A33 | 固定发布配置、check-release、G05 哈希/版本历史 | 最终本机安装器独立 SHA-512、冻结 bundle 等价和清单；runner 报告 CRC 通过，远端包未完整下载到本机验哈希 |
| 可信签名及异常拒绝 | A34 | release-policy 无签名拒绝负例、固定发布者/时间戳门禁 | 未签名真实拒绝负例通过；可信签名/发布者/时间戳正例未验，用户先不配置 |
| 安装前在途和进程占用 | A35 | update 故障点、G05 两版实装历史、prepareUpdate 协调 | 更新在途/占用/备份/最终授权失败模块及当前两版实际安装通过；签名安装正例未验 |
| 升级保留未决消息和卡消费 | A36 | 未决持久状态、统一更新备份和启动核对实现 | 两版 NSIS 升级、未签名卸载保留未决、重装核对原记录，模拟写入无增加 |
| ACL、超限帧和慢订阅 | A37 | transport、windows-powershell、subscription 的边界和慢输出测试 | ACL/帧/慢输出模块及当前本机/runner 管道安装回归通过 |
| 托盘、恢复提醒和预览撤销 | A38 | stage4 驻托盘；notifications 时段/持久游标；阶段 3 预览历史 | 本机/runner 驻托盘与预览撤销通过；本机原生 show=2 固定文本；通知事件来自模拟业务 |
| 功能、能力和文档覆盖 | A39 | 本表、definitions、Schema 与 check-docs | 83 项、全部 C01–C82 与 A01–A40 已逐项映射；构建/边界/文档/发行检查通过 |
| 证据分类和未授权副作用审计 | A40 | stage4 real/fixture 独立计数；阶段 4/5 的真实阻断记录 | 本机/runner/真实只读历史/故障注入分别记录；真实副作用为零，无公开新 Release，失败/skip/签名未验保留 |

## 最终登记规则

- 新本机、安装和 runner 结果分别追加到对应阶段记录；报告缺失、失败或 skip 不能转换为「通过」。
- 用户批准真实测试前，应先列具体账号/目标或指定卡、动作、次数、影响和门禁结果；本表不构成授权。
- 公开发行必须在可审阅安装包、版本/哈希清单和验证完成后单独确认；当前不标记 stable 或公开 Release 完成。
- 当前人工备份与恢复步骤见 [备份与故障恢复](recovery.md)，不提供虚构的公开 SQL、备份或任意路径接口。

## 发送门禁补充证据（2026-11-18）

- C12/C19/C20/C32/C35/C58 与 A13/A19/A24 的新增证据见[真实门禁](real-delivery-gates.md)和[旧锁核验](legacy-lock-gate.md)。只读真实目标创建账号匹配/Goal 关联/持久轮次已观察，当前执行账号绑定、源端唯一回执和旧版实际恢复策略仍未通过。
- 固定列投影、未知来源/过期、同名 view/生成字段、损坏/链接/并发替换、旧桌面死 PID 回收、原标识唯一回执及入口一致性分别测试。模拟来源即使 API 模式为 live-readonly 也标为 simulated-adapter，不充当真实门禁。
- 当前真实发送/卡消费仍为零；签名和公开发行状态不变。新增门禁没有增加公开能力数、权限或数据库 Schema。

- beta.13 最终本机 191 pass/0 skip，runner 186 pass/5 skip；NSIS 4、阶段 2/3/4–5 的 9/9/10、门禁 6 及升级 5 组。本机真实只读门禁流程六组通过且真实发送仍关闭，旧工具不托管的用户条件另记，最终清单见阶段 6。
