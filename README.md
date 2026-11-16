# Codex Dog

Codex 任务托管与自动化管理工具，中文昵称「守码犬」。Dog 系列按助手分别建立产品，当前专注 Codex。

## 当前可用范围

G01–G04 已完成：Electron 主应用、独立业务进程、统一业务入口、独立 CLI EXE、IPC/MCP、本机配对授权与进程恢复。
当前共 15 项能力：基础读取、配对授权，以及真实连接发现、额度刷新、会话和 Goal 读取；默认申请 read，桌面明确批准。
默认额度 source=fixture；显式 live-readonly 接入真实 Codex，只读额度、会话和 Goal。SQLite 仍仅保存模拟观察及事务；最小窗口支持配对和状态展示，没有完整界面或托盘。
G03 仅隔离锁验证，G04 仅真实只读观察；未发送消息或消费重置卡。G05/G06 安装更新和发行尚未放行。

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
.\codex-dog\release\g04\codex-dog.exe access request --client cli --json
~~~

在桌面核对六位配对码并批准后调用：

~~~powershell
.\codex-dog\release\g04\codex-dog.exe quota get --client cli --json
.\codex-dog\release\g04\codex-dog.exe capabilities list --client cli --json
.\codex-dog\release\g04\codex-dog.exe mcp serve --client mcp
~~~

MCP 的 mcp 客户端须另外调用 access_request 并配对；完整管理授权与配置见 [G02 手册](docs/g02.md)。
独立 CLI 内置 Node 运行时，不要求机器预装 Node；release/g04/codex-dog.exe 是未签名验证产物，不是桌面安装器。
当前 API major=3，旧 API 1/2 EXE 均须重新构建，已有授权和数据库保留。应用关闭后返回 APP_NOT_RUNNING，不自动启动应用。

## 验证

~~~powershell
pnpm --dir codex-dog build
pnpm --dir codex-dog test
pnpm --dir codex-dog check:boundaries
pnpm --dir codex-dog check:docs
pnpm --dir codex-dog pack:cli
pnpm --dir codex-dog test:g04
pnpm --dir codex-dog test:g03
pnpm --dir codex-dog test:g02
~~~

## 文档导航

- [计划总览](PROJECT_PLAN.md)：范围、决策、状态与文档入口，不再承载全部技术细节。
- [G04 使用及实测记录](docs/g04.md)：真实只读启动、额度/会话/Goal、异常边界与证据；67 项测试和 10 组真实检查通过。
- [G03 阶段记录](docs/g03.md)：SQLite、事务、WAL 备份和旧版锁；当前版本 12 组 G03 与 20 组 G02 回归通过。
- [G02 配对手册与阶段记录](docs/g02.md)：九项能力、配对/撤销、进程恢复及权限边界。
- [G01 历史记录](docs/g01.md)：初始模拟链路与原版本证据。
- [需求基线](docs/requirements.md)、[架构与底层端口](docs/architecture.md)、[公共契约](docs/contracts.md)。
- [CLI/MCP 设计目录](docs/cli.md)：82 项未来能力与实际已实现能力明确区分。
- [路线与门禁](docs/roadmap.md)、[验收目录](docs/acceptance.md)、[GitHub 更新方案](docs/updates.md)。
- 项目档案位于 ../.ai/projects/codex-dog/；实施先读工作区 AGENTS.md 和本项目 constraints.md。
