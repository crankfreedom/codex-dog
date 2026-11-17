# 阶段 3：只读设置与诊断

## 范围和验收基线

- 需求：REQ-20261117-04，2026-11-17；用户确认本轮为完整阶段 3 只读桌面。
- 在阶段 2 基础上补齐会话/Goal 只读页面、本应用设置和外观、诊断、历史查询/导出、离线说明。
- CLI/IPC/MCP 共用唯一业务实现；先契约与业务/CLI 验证，再接页面，不注册空实现。
- 不实现真实任务、模板、队列、时段、发送、卡消费、真实签名或正式发行，不迁移旧产品数据。
- 任务归档/任务时间线依赖尚未实现的正式任务，不伪造为空列表或把 G03 夹具当生产数据；本轮历史为本应用实际运行/设置事实。
- 设置仅覆盖实际实现的 appearance 和 monitoring；连接继续复用阶段 2 来源配置，更新继续走既有专用服务。

## 必须完成的验收

- 设置分区保存、范围/白名单校验、持久幂等与修订冲突、撤销拒绝、重启保留；外观与监控不互相覆盖。
- 外观具备字号/行高/字体/密度/对比度、十种纯色/十种渐变、阅读预设；预览不保存，离页/关闭隐藏撤销，无可见窗口拒绝预览。
- 额度自动只读刷新可显式设置、默认关闭；独立生命周期，不启动任务调度，异常/过期仍保守展示。
- 会话分页和目标详情/Goal 通过现有只读服务；模拟具备确定性数据，真实结果不持久化、不读认证/聊天正文/Goal objective。
- 诊断区分通过、阻断、未知、未检查，覆盖本机进程/存储/权限及当前只读来源；不自动刷新额度或推进调度。
- 历史是有依据的实际脱敏事实；稳定边界分页、条件绑定游标、固定快照导出、取消和撤销清理临时文件、固定导出目录、不覆盖已有文件。
- 帮助可离线使用，CLI/MCP/页面共用包内说明，实际能力和未来计划分开。
- 本机模块/入口/页面/安装版模拟及必要真实只读验证；本轮远端 CI/Preview 实跑，失败和 skip 单独记录。
- 阶段 2 授权、托盘/重开、明确退出清理及离线不拉起回归；完成文档、学习、日志和体量硬校验。

## 实施和证据

本轮验收完成。以下本机与 runner 证据分开保存；只有本机显式真实模式连接了真实来源。

| 环境 | 当前证据 | 状态 |
|---|---|---|
| 本机模块/契约 | artifacts/stage3/unit-tests.tap：110 项，无 skip；含迁移回滚、损坏设置、分区/幂等、游标、取消/恢复及权限复核 | 通过 |
| 本机开发版模拟 | artifacts/stage3/development-fixture.json，8 组，页面/控制台错误为空 | 通过 |
| 本机开发版真实 | artifacts/stage3/development-live.json，7 组，真实会话/Goal/诊断及三入口；有一次重启首读 READ_TIMEOUT，界面未知、无来源回退 | 通过当前只读范围，异常另记 |
| 既有回归 | G03 12 组（现 Schema 3）、G02 20 组、阶段 2 模拟 9 组 | 通过 |
| 本机 Preview 安装版 | 0.6.0-beta.4 / 3b39f80f：NSIS 4 组、阶段 2 模拟 9 组、阶段 3 模拟 8 组/真实 7 组；installed-*.json | 通过 |
| 远端 CI | [44046638966](https://github.com/crankfreedom/codex-dog/actions/runs/44046638966)：110 项中 106 通过/4 旧源码 skip，边界/文档/发行检查、G03/G02 12/20 组、阶段 2/3 模拟 9/8 组 | 通过；旧源码四项明确 skip |
| 远端 Preview | [44046738472](https://github.com/crankfreedom/codex-dog/actions/runs/44046738472)：实际 NSIS 构建/安装 4 组、阶段 2/3 模拟 9/8 组；不接真实来源 | 通过 |

本机最终安装包为 `release/g06/preview/0.6.0-beta.4/3b39f80f/Codex-Dog-Preview-0.6.0-beta.4-Setup.exe`，142563846 字节；独立重算 SHA-512 与 package.json 一致。已安装入口为 `artifacts/g06/installed/3b39f80f/CodexDogPreview.exe`，亦可通过本轮 Preview 开始菜单快捷方式启动。固定数据目录操作另验：read 拒绝、任意 path 参数拒绝、可信桌面调用系统打开成功、退出后端点和本实例进程清理。

失败记录保留于 `artifacts/stage3/known-failures.json`：早期设置加载覆盖输入已修复并复验；开发版真实重启首读 READ_TIMEOUT 作为未知展示；安装版真实首次 threads.list 超时，同来源新 profile 显式复验通过，未自动回退。最终安装版真实观察读取到 active Goal，但 completionConfirmed=false、账号绑定未证实。

CI/Preview 针对同一实现提交运行；本轮收尾提交仅更新三个验收文档，并单独等待其 CI。远端报告与运行 ID 在 `artifacts/stage3/remote-ci`、`remote-preview` 核对；Preview 仅按 HTTP Range 提取小报告并验证 ZIP CRC32，未完整下载远端安装包或在本机重装 runner 包。原生托盘菜单的通知区域直接点击没有新增自动化证据；实际窗口 close、驻留查询、重开、明确退出与离线均通过统一入口回归。

## 日常使用

侧栏新增「会话与 Goal」「只读诊断」「本应用历史」「设置与外观」「使用说明」。

- 会话页通过当前连接分页查询，归档过滤独立。目标详情只含身份、状态、最新轮次和 Goal 元数据；未知、无当前 Goal 和跨源账号绑定未证实分别展示，不确认整个任务完成。
- 设置页支持标题/分区/正文/辅助/导航字号、行高、四种字体、密度/对比度、十种纯色和十种渐变，以及默认/阅读/紧凑预设。临时预览不保存；离页、隐藏窗口或撤销预览所有者权限后恢复已保存值。
- 监控设置只控制额度只读刷新，默认关闭。开启后按独立间隔读取当前显式来源；30 秒观察有效期不变，间隔较长时仍显示过期，不假装额度正常。不会运行任务调度或补跑副作用。
- 诊断不刷新额度，分开显示通过/阻断/未知/未检查。未选目标则会话与 Goal 未检查；Goal 账号绑定和真实自动化始终保留当前能力限制。
- 历史是本应用 runtime/settings/export 的实际脱敏事实，不是聊天历史。查询固定上界，游标绑定过滤条件；导出只写本 profile 的 exports，不覆盖已有文件。
- 普通外部客户端只管理本人的导出；可信桌面及明确 app.manage 可核对/取消本机全部导出。关闭页面不取消导出，明确退出取消尚未完成的导出。
- 包内说明可离线搜索，CLI/MCP 使用同一静态说明实现；它不返回宿主能力、连接或历史缓存。

## CLI/MCP 接入

先使用配套 CLI，在同一 profile 申请 read；需要修改本应用设置时单独申请 settings.manage，在桌面勾选后批准。既有授权不自动扩权；需要增权时使用新的 `--client` 名称重新申请（当前不支持原地扩权）。settings.manage 不授予 app.manage 或 access.manage。

~~~powershell
codex-dog.exe access request --input pairing.json --profile PROFILE --client manager --json
codex-dog.exe settings get --section appearance --profile PROFILE --client manager --json
codex-dog.exe quota policy get --profile PROFILE --client manager --json
codex-dog.exe diagnostics run --profile PROFILE --client manager --json
codex-dog.exe settings update --input settings.json --idempotency-key settings-001 --profile PROFILE --client manager --json
codex-dog.exe events query --input history.json --profile PROFILE --client manager --json
codex-dog.exe events export --input export.json --idempotency-key export-001 --profile PROFILE --client manager --json
codex-dog.exe operations get --id OPERATION_UUID --profile PROFILE --client manager --json
codex-dog.exe operations cancel --id OPERATION_UUID --idempotency-key cancel-001 --profile PROFILE --client manager --json
codex-dog.exe help get --topic settings --json
codex-dog.exe help search --query 导出 --json
~~~

pairing.json 示例：`{"clientLabel":"manager","requestedScopes":["read","settings.manage"]}`。
settings.json 示例：`{"section":"appearance","expectedRevision":1,"patch":{"bodySize":16}}`，revision 必须先读取，不照抄示例。
history.json 示例：`{"type":"settings.updated","limit":20}`；export.json 示例：`{"type":"settings.updated","output":"settings-history.jsonl"}`。
MCP 对应 settings_get/update、quota_policy_get/update、diagnostics_run、events_query/export、operations_get/list/cancel、help_get/search；变更的 idempotencyKey 放在工具参数，服务端转换为请求元数据。

## 依赖、持久化与失败语义

- 设置与历史业务在独立 worker，主进程仅组装固定平台操作、窗口预览与唯一技术授权；页面不启动 CLI，不直接访问 SQLite、真实工具管道或 Goal 源库。
- Schema 2→3 使用事务新增 app_settings、app_setting_operations、app_events、app_history_meta、app_exports、app_export_cancellations；失败全部回滚，已有模拟观察/事务保留，损坏设置不被默认值覆盖，未知高版本仍拒绝。
- 分区更新先最终校验和权限复核，再同事务保存值、修订、幂等结果及设置事件；读取返回副本。设置幂等记录最多 2048 条，达到上限拒绝；不清理未决真值。
- 同策略重放不重置监控周期；同键异参拒绝，旧修订不覆盖新设置。预览是窗口作用域的临时状态，关闭/重启不作为已保存配置恢复。
- 历史分页不持长 SQLite 事务；事件不可变、固定 sequence 上界保障后续写入不挤入旧分页。日期规范化为 UTC，游标带签名且绑定条件，不接受任意 SQL。
- 导出最多 20000 条，每批复核取消/当前授权，固定目录检查拒绝 junction/symlink 逃逸。文件排他硬链接发布，临时链接保留至操作真值提交；中断恢复只清理本操作有身份依据的文件。
- 导出接受/运行/成功/失败/取消可独立核对；同键返回同一操作。操作记录最多 1000 条、取消键最多 2048 条，满后拒绝，不覆盖或静默删除。
- 退出先阻止新派发及后续权限续验，再取消周期和未完成导出，清理文件/SQLite/worker/管道；客户端离线不拉起。异步复核失败不当作已经授权。
- 模拟会话适配器复用相同 CodexReadonlyService，明确 source=fixture；fixture_* 仍仅内部事务夹具，真实观察不写入这些表或公开历史。

## 限制和后续

本轮不等于全部产品计划完成。正式任务归档、任务时间线、通知输出、模板/队列/时段、发送和卡消费仍属于后续业务，不为这些能力生成空接口。Goal 跨源账号绑定未证实、completionConfirmed=false 继续保留；不读取认证、聊天或 Goal objective。

真实来源可能超时。首次连接失败仍启动可用的本机设置/诊断界面，额度明确未知；只有显式刷新或已开启的只读周期才重试同一来源，不切换来源。当前 Windows x64 未签名 Preview，没有 stable、新 Release 或真实签名；本机与 runner 证据不能互换。
