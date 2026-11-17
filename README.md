# Codex Dog

Codex 任务托管与自动化管理工具，中文昵称「守码犬」。Dog 系列按助手分别建立产品，当前专注 Codex。

## 当前可用范围

G01–G04 已完成：Electron 主应用、独立业务进程、统一业务入口、独立 CLI EXE、IPC/MCP、本机配对授权与进程恢复。
当前共 83 项能力、API 3 / SQLite Schema 11：增加任务/模板、队列/时段、统一投递及核对、指定卡预约、归档/时间线、通知、事件订阅和更新页面。默认 read；新增正文、任务、发送和卡权限分别申请，不自动扩权。阶段 4–6 的本轮总验收仍在推进。
全新 profile 默认 fixture；真实 live-readonly 须显式选择，来源保存下次启动生效。真实账号/Goal 绑定、无正文唯一回执与旧锁目录门禁未齐全，真实发送阻断；卡来源须显式指定本机 codex.exe，真实消费另需开启来源并逐笔授权。真实额度/会话/Goal 观察仍只留内存。
G03 仅隔离锁验证，G04 仅真实只读观察；未发送消息或消费重置卡。G05 两版 NSIS 与真实 GitHub 更新已通过。G06 已新增发行配置、签名入口、只构建 Actions 和 Preview；远端 CI/Preview 的构建及实装已跑通，真实签名与正式发行未放行。

## 开发环境启动

在工作区根目录使用 PowerShell：

~~~powershell
pnpm --dir codex-dog install
pnpm --dir codex-dog install:electron
pnpm --dir codex-dog build
pnpm --dir codex-dog start
~~~

开发构建要求 Node.js 26+、pnpm 11.20；首次 Electron 下载需要网络。Windows 管道使用系统 PowerShell 5.1/.NET Framework，运行策略须允许宿主脚本；应用不会更改系统策略。
默认 profile=g02（保留已有配对）、fixture=available；已构建时 start 不会重新编译，dev 为构建后启动，并非热更新。

## 真实只读模式

~~~powershell
pnpm --dir codex-dog start --source=live-readonly --profile=g04-local --codex-caller-thread=EXISTING_THREAD_UUID
~~~

调用会话可由 CODEX_THREAD_ID 明确提供；普通终端须填写本机现有 UUID。多管道须显式选择，完整参数及配对后查询见 [G04 手册](docs/g04.md)。Goal 跨源账号绑定尚未证实，读取结果不作为自动化授权或完成证明。

## 命令行与 MCP

保持主应用运行，构建 CLI 并在另一个终端申请配对：

~~~powershell
pnpm --dir codex-dog pack:cli
.\codex-dog\release\g06\codex-dog.exe access request --client cli --json
~~~

在桌面核对六位配对码并批准后调用：

~~~powershell
.\codex-dog\release\g06\codex-dog.exe quota get --client cli --json
.\codex-dog\release\g06\codex-dog.exe capabilities list --client cli --json
.\codex-dog\release\g06\codex-dog.exe mcp serve --client mcp
~~~

MCP 的 mcp 客户端须另外调用 access_request 并配对；完整管理授权与配置见 [G02 手册](docs/g02.md)。
设置与诊断示例：`settings get --section appearance`、`diagnostics run`、`events query --input FILE`；离线可用 `help get --topic settings` 或 `help search --query 导出`，不会返回旧业务缓存，详见 [阶段 3 手册](docs/stage3.md)。
独立 CLI 内置 Node 运行时，不要求机器预装 Node；release/g06/codex-dog.exe 是未签名验证产物，不是桌面安装器。
当前 API major=3，旧 API 1/2 EXE 均须重新构建，已有授权和数据库保留。关闭窗口继续驻托盘；明确退出后返回 APP_NOT_RUNNING，不自动启动应用。

## 验证

G05 仅用模拟数据：pack:g05 生成两版独立测试安装包，test:g05 验证本机 NSIS，test:g05 --github 验证实际 GitHub 下载；使用方式、权限和证据见 [G05 手册](docs/g05.md)。不会因为构建而上传或发布。

G06 默认 `pnpm --dir codex-dog release:build` 仅生成隔离 Preview，`test:g06` 验证安装；`check:release` 检查工作流及发行门禁。无签名凭据时正式构建直接拒绝，Actions 没有 stable 发布入口，见 [G06 手册](docs/g06.md)。

~~~powershell
pnpm --dir codex-dog build
pnpm --dir codex-dog test
pnpm --dir codex-dog check:boundaries
pnpm --dir codex-dog check:docs
pnpm --dir codex-dog pack:cli
pnpm --dir codex-dog check:release
pnpm --dir codex-dog test:g03
pnpm --dir codex-dog test:g02
pnpm --dir codex-dog test:stage2
# 本机真实只读（明确提供 CODEX_THREAD_ID；不会在 runner 执行）：
pnpm --dir codex-dog test:stage2 --live
pnpm --dir codex-dog test:stage3
pnpm --dir codex-dog test:stage3 --live
pnpm --dir codex-dog test:stage4
~~~

## 文档导航

- [阶段 4 任务自动化](docs/stage4.md) 与 [阶段 5 指定卡](docs/stage5.md)：当前实现、模拟证据与真实门禁。
- [阶段 6 发行验收](docs/stage6.md)、[逐项覆盖](docs/coverage.md)、[备份恢复](docs/recovery.md)：安装/升级、证据状态及故障处置。
- [阶段 3 设置与诊断](docs/stage3.md)：本轮范围、使用、权限、历史导出及验证证据。
- [阶段 2 只读桌面](docs/stage2.md)：使用、来源配置、托盘、安装版与模拟/真实/runner 证据分界。
- [计划总览](PROJECT_PLAN.md)：范围、决策、状态与文档入口，不再承载全部技术细节。
- [G06 发行准备](docs/g06.md)：运行时/PowerShell/ACL 别名修复；本机 90 项通过，远端 86 通过/4 旧源码 skip，CI 回归与 Preview 实装通过，完整 G06 未放行。
- [G05 使用及实测记录](docs/g05.md)：独立更新模块、CLI 文件占用与恢复；本机 NSIS 11 组及真实 GitHub 8 组通过，保留 80 项单元测试证据；两个公开预发布均非 latest，不是正式 stable。
- [G04 使用及实测记录](docs/g04.md)：真实只读启动、额度/会话/Goal、异常边界与证据；67 项测试和 10 组真实检查通过。
- [G03 阶段记录](docs/g03.md)：SQLite、事务、WAL 备份和旧版锁；当前版本 12 组 G03 与 20 组 G02 回归通过。
- [G02 配对手册与阶段记录](docs/g02.md)：九项能力、配对/撤销、进程恢复及权限边界。
- [G01 历史记录](docs/g01.md)：初始模拟链路与原版本证据。
- [需求基线](docs/requirements.md)、[架构与底层端口](docs/architecture.md)、[公共契约](docs/contracts.md)。
- [CLI/MCP 设计目录](docs/cli.md)：82 项未来能力与实际已实现能力明确区分。
- [路线与门禁](docs/roadmap.md)、[验收目录](docs/acceptance.md)、[GitHub 更新方案](docs/updates.md)。
- 项目档案位于 ../.ai/projects/codex-dog/；实施先读工作区 AGENTS.md 和本项目 constraints.md。
