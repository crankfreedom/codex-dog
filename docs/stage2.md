# 阶段 2：日常只读桌面

## 范围与状态

- 需求：REQ-20261117-03，2026-11-17（Asia/Shanghai）。本轮交付只读桌面，不扩展任务自动化。
- 复用 G01–G05 的统一入口、配对、只读服务、SQLite 与进程监督；G06 签名和正式发行继续独立待办。
- 开发版本仍为 0.6.0-g06；最终本机安装验收包为 0.6.0-beta.3 Preview，未签名、未发布。
- Vue 3.5.45、Pinia 4.1.0、Element Plus 2.14.8；沿用 esbuild，SFC 在构建时预编译，不放宽页面 CSP。
- 当前 23 项公开能力，API major 3 / 业务 Schema 2 不变；新增四项的契约见 [公共契约](contracts.md)。
- 本轮验收完成：本机开发/安装版模拟和显式真实只读通过；远端 CI/Preview 同一实现通过。后续文档收尾不改变业务实现，不进入真实副作用功能。

## 使用方式

1. 默认打开「额度总览」，模拟数据明确标识；额度窗口展示剩余/已用、来源、连接、读取时刻、过期与异常。
2. 「客户端授权」核对 CLI/MCP 的名称和六位配对码后批准；read 默认，access.manage 和 app.manage 必须单独勾选。可随时撤销。
3. 「连接与来源」显式选择下次启动使用模拟或真实只读，真实模式填写已有调用会话 UUID。多个 Codex 实例时必须填写明确本机工具管道。
4. 保存后当前进程保持原来源。使用「退出并停止监控」后重新启动，应用才读取已保存选择；显式启动参数优先。
5. 关闭窗口（含 Alt+F4）隐藏到托盘。托盘提供「打开 Codex Dog」和「退出并停止监控」；再次启动同一 profile 也会显示原窗口。
6. 窗口中的退出按钮有确认。完全退出停止端点、worker、安全管道宿主；CLI/MCP 返回 APP_NOT_RUNNING，不自动启动应用。

真实额度采用现有只读快照，30 秒后过期。页面每秒查询共享快照，不每秒访问真实来源；「刷新真实额度」才重新读取。过期、未知、断连和进程失败均不展示正常额度，不按预计重置时间推断恢复。

安装版不需要预装 Node。默认 profile 由发行配置给出；CLI 使用安装目录 resources/cli/codex-dog.exe，并指定同一 profile。当前本机验证安装目录与实际包路径见 artifacts/g06/package.json；安装器创建开始菜单快捷方式，不创建桌面快捷方式。

源码启动、参数覆盖和 CLI 示例：

~~~powershell
pnpm --dir codex-dog build
pnpm --dir codex-dog start
# 显式参数只覆盖当前启动，不修改已保存选择：
pnpm --dir codex-dog start --source=live-readonly --profile=readonly-local --codex-caller-thread=EXISTING_THREAD_UUID
.\codex-dog\release\g06\codex-dog.exe connections configuration --profile readonly-local --json
.\codex-dog\release\g06\codex-dog.exe desktop show --profile readonly-local --json
~~~

普通终端没有 CODEX_THREAD_ID 时必须显式提供 UUID；不从索引或聊天正文猜选。多实例指定 --codex-pipe，格式与 [G04 手册](g04.md) 相同；CODEX_HOME/--codex-home 仍只是现有 Goal 只读根路径参数。

## 模块和生命周期

- SourceConfiguration 负责选择的修订、串行保存、幂等与保存前权限复核；FileSourceStore 只负责当前 SID 保护目录的 source.json 原子写入。
- source.json 不含凭据、额度或聊天；缺失默认模拟，损坏/未来版本拒绝启动，保存失败不更新内存。真实观察仍只留 worker 内存。
- HostRouter 组装来源配置、固定桌面操作和既有业务处理器；CLI/MCP 的命令和 Schema 仍来自同一 definitions。页面不执行 CLI、不访问业务库或真实管道。
- 主进程拥有窗口与托盘，worker 拥有业务只读连接和 SQLite。构造无新增 I/O；配置显式 start/close；退出拒绝新调用并等待配置保存，再清理平台资源。
- 真实底层请求上限 15 秒，业务监督启动/请求上限 45 秒；修复首轮本机 5 秒读取超时。实际网络失败依旧返回错误，不无限等待或自动切换来源。
- 导入检查加入 Vue SFC 和 renderer 构建依赖，防止页面打包业务实现、基础设施或执行 CLI。

## 验证证据

证据文件保存在本机忽略的 artifacts/，不作为仓库文件链接。远端报告须独立确认 githubActionsRun 与具体运行编号。

| 环境 | 验证内容 | 状态 / 证据 |
|---|---|---|
| 本机模块 | 类型、契约、权限/撤销、来源修订/持久幂等/失败、过期展示、现有业务回归 | 96 项通过，无 skip；边界、文档、发行策略检查通过 |
| 本机开发版模拟 | 三种额度、配对/撤销、CLI 配置幂等、隐藏/重开、明确退出、三入口及离线 | 9 组通过，artifacts/stage2/development-fixture.json |
| 本机开发版真实 | 显式持久选择、真实额度/必要连接、CLI/IPC/MCP 一致、退出离线 | 7 组通过，artifacts/stage2/development-live.json |
| 本机安装 | 实际 per-user NSIS、版本/来源/无更新清单、未签名负例与退出 | 4 组通过，artifacts/g06/preview-report.json |
| 本机安装版模拟 | 与开发版相同流程，独立 SEA CLI 在 PATH 为空时运行 | 9 组通过，artifacts/stage2/installed-fixture.json |
| 本机安装版真实 | 保存选择后重启，真实额度/连接及三入口共用服务，退出离线 | 7 组通过，artifacts/stage2/installed-live.json |
| 本机既有回归 | G03 实际 worker 数据事务/备份/恢复；G02 ACL/授权/有限恢复 | 分别 12 / 20 组通过 |
| 远端 CI | 96 项：92 通过 / 4 旧源码互操作明确 skip；G03/G02 12/20 组、阶段 2 模拟 9 组 | [44035580045](https://github.com/crankfreedom/codex-dog/actions/runs/44035580045) 成功，已下载核对报告 |
| 远端 Preview | 0.6.0-beta.3 实际构建安装、G06 4 组、阶段 2 安装版模拟 9 组 | [44035630029](https://github.com/crankfreedom/codex-dog/actions/runs/44035630029) 成功；runner 不接入真实来源 |

真实模式的「过期」UI 检查通过推进页面时钟完成，底层时间未快进；服务真实 30 秒语义由假时钟模块测试覆盖，不能称作真实断网正例。不可达管道来自显式失败夹具，不计作真实额度证据。页面错误和控制台错误均为空；真实审计仅 get_usage_limits，无发送和卡消费。

原生 computer-use 检查使用先前本机构建包的窗口：Alt+F4 后窗口不可操作、二次启动后恢复可访问树。截图失败且点击几何信息不可用，未取得通知区域菜单的直接点击证据；本轮隐藏/重开/明确退出的核心证据来自实际 Electron/NSIS 自动化。原生工具实例最终按精确路径清理，不当作正常退出证据。

额外 G04 全量真实回归尝试已通过真实额度、刷新与会话分页，后续会话读取遇到 READ_TIMEOUT；不将这次扩展尝试标为全量 G04 重验通过。该项不在本轮额度及必要连接状态验收范围，历史 G04 证据仍单独保留。

远端两项均验证实现提交 93d0120；后续仅更新验收文档。CI 的四项 skip 因独立仓库没有旧源码，不能计为旧版互操作成功。远端 CI 报告中 githubActionsRun=true、githubRunId=44035580045，页面/控制台错误为空。本机报告为 false，真实来源只在本机验证。

最终本机包 artifacts/g06/package.json：runId=dee10edd，安装包 142475765 字节，已实际安装并完成模拟/真实只读验收。安装于 artifacts/g06/installed/dee10edd/，开始菜单条目指向该安装；退出后保持离线。安装包为本机产物，不冒充远端下载重装证据。

## 限制与后续

- 当前 Windows x64 未签名 Preview；真实签名、正式图标、可信更新与正式发行不属于本轮，不创建 stable 或新 Release。
- 额度刷新为显式操作；驻托盘保持本机业务入口，但没有新增真实调度或自动化引擎。
- 来源变更下次启动生效；当前已选实例断连不会默换。未知和错误需要用户核对来源、调用会话及连接后明确重试。
- Goal 跨源账号绑定仍未证实，不确认任务完成；不读取认证、Goal objective 或聊天正文，不迁移旧数据。
- 模板、队列、时段、任务发送、重置卡不在本轮；后续只读设置/诊断可另行排期，不能自动进入副作用功能或正式发行。
