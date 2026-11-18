# 阶段 6：安装、升级与发行准备

## 当前状态

- REQ-20261117-05，2026-11-18：不依赖签名的工程、安装/升级和远端 CI/Preview 已完成本轮验证；完整 G06 与 Goal 不标记完成。
- 复用 UpdateService、NSIS、GitHub Actions 和物理安装门禁；83 项能力、API 3 / SQLite Schema 11，正式 SVG/PNG/七尺寸 ICO 已接入桌面、托盘和安装器。
- 更新页接入固定候选、进度、操作核对与独立安装确认；自动策略只读检查，不自动下载或安装。Preview 无官方更新清单。
- 用户决定先不配置签名、暂不进行真实卡消费；相关正例保留待办。真实消息门禁和公开发行未放行。

## 最终候选与安装入口

| 项目 | 本机候选 |
|---|---|
| 版本 / 构建标识 | 0.6.0-beta.10 / 94ce9f45，未签名 Preview |
| 安装器 | release/g06/preview/0.6.0-beta.10/94ce9f45/Codex-Dog-Preview-0.6.0-beta.10-Setup.exe |
| 字节数 | 142789934 |
| SHA-512（base64） | K8ic0ZdYxINtEKGcNDBt7ogw7RzpSGW4R9d3xv38OQkeShM669CKLl6a0gVorwc+mmIUiJrZWZIDwHwZjYW33A== |
| 已安装主程序 | artifacts/g06/installed/94ce9f45/CodexDogPreview.exe |
| 配套 CLI / MCP | 同目录 resources/cli/codex-dog.exe；内置 Node，MCP 使用 mcp serve |
| 默认数据 | %LOCALAPPDATA%/codex-dog/profiles/g06-preview-94ce9f45，fixture |

以上路径相对项目根目录；可审阅完整清单为 artifacts/stage6/final-manifest.json，发行说明见 [候选说明](release-notes.md)。本机与 runner 独立打包，不假定安装包哈希相同。中间 beta.5–.9 的已登记历史结论保留，不替代最终 beta.10。

## 验证结果与证据

| 环境 | 结果 | 证据 |
|---|---|---|
| 本机模块与检查 | 167/167 pass，0 skip；构建、边界、文档、发行检查通过 | artifacts/stage4/final-unit-tests.tap |
| 本机 beta.10 NSIS | 4 组通过，主应用/worker/SEA CLI 同版本，未签名真实拒绝负例通过 | artifacts/g06/preview-report.json |
| 本机安装版阶段 2/3/4–5 | 9 / 8 / 10 组通过，页面错误为空；关闭驻托盘、明确退出清理、离线不拉起 | artifacts/stage2、stage3、stage4/installed.json |
| 新增真实卡只读（开发宿主） | 用户分别批准两次请求：首份报告保存失败、不计通过；额外一次 known/live、3 张可用卡，未开启消费 | artifacts/stage5/real-readonly-once.json、first-read-report-failure.json |
| 单卡验收脚本模拟（安装版） | 成功/响应丢失各一次，至多领取/消费一次，未知保留、不重试，真实消费零 | artifacts/stage5/fixture-consume.json、fixture-consume-loss.json |
| Windows 原生通知 | 实际 show=2、failed=0，固定文本 | stage4 安装报告；模拟业务事件，非真实额度恢复 |
| 本机实际任务周期 | 两个十秒周期自行完成模拟投递、原回执与 Goal 归档，未调用 runNow；配置不立即发送、关闭生效 | artifacts/stage4/scheduler-timer.json，仅本机 |
| 中文空格独立 CLI | 安装版 SEA EXE 在中文空格路径、空 PATH 下查询中文离线帮助及业务离线码通过，不创建 profile | artifacts/stage6/unicode-cli.json |
| 新业务升级 / 卸载 / 重装 | beta.5 Schema 10→beta.10 Schema 11，未决原意图/键/次数/held 保留，无重放；未签名卸载保留 profile，重装后原结果核对 | artifacts/stage6/upgrade-report.json，5 组 |
| 历史本应用升级 | beta.4 Schema 3→11，外观设置保留，不伪造旧业务数据 | 同升级报告中的独立隔离 profile |
| 远端 CI | [44224371601](https://github.com/crankfreedom/codex-dog/actions/runs/44224371601) success，G03/G02 12/20 组及阶段 2/3/4–5 9/8/10 组 | artifacts/stage6/remote-ci-44224371601 |
| 远端 Preview | [44224408068](https://github.com/crankfreedom/codex-dog/actions/runs/44224408068) success，beta.10；实际安装 4+9+8+10 组 | artifacts/stage6/remote-preview-44224408068/summary.json |

远端两类运行的模块计数均为 167：163 pass、4 skip、0 fail。四项跳过因 runner 无旧项目源码；本机对应隔离测试通过，真实旧锁目录仍未核对。Preview 按模式跳过签名环境审批检查，不表示该门禁通过。远端 JSON 通过认证 ZIP 范围读取、长度及 CRC32 核对；未完整下载远端安装器到本机验哈希或再安装。beta.9 首轮本机 NSIS 无法打开输出文件（磁盘空间足够、之后独占访问可用），保留部分文件且未作为候选；后续构建成功。远端报告读取的 blob 连接超时仅属观察失败，同一 artifact 改用 curl 范围读取后核对成功，没有重建 workflow。早期失败、修复和剩余未验项保存在 artifacts/stage6/failures-and-pending.json。

## 数据与生命周期安全

- 更新准备停止新派发、等待本地在途落定并一致备份；物理安装前再次核验哈希/授权/签名，准备失败恢复观察。
- 升级试验先由旧实际安装版业务创建意图、原键及模拟回执，再在离线隔离库注入响应结算丢失；这是故障注入，不冒充真实网络丢包。
- Schema 11 仅以本应用持久模拟回执证明 fixture；无证据为 unknown，不按当前来源猜历史，不自动重放。
- 未决锁跨退出保留；只在对应终态、原持有者退出且 token/pid 匹配时受控释放，不删除未知锁。
- 实际系统休眠/时区切换未执行；模块时段与模拟电源事件证据单列，不扩大为真实机器测试。

## 仍未完成的验收

- 可信签名暂不配置：发布者、有效链、时间戳、签名升级及签名卸载器正例均待办，不用自签代替。完整 G06 未过。
- 真实发送：账号/目标/Goal 绑定、无正文唯一回执和真实旧锁证据仍缺；当前保持阻断，授权不能代替门禁。
- 新增真实卡只读已取得有效报告，消费及原键核对按用户明确选择暂缓；未开启真实消费或创建预约。后续仍须具体授权，不人为耗尽额度。
- 所有报告真实发送/卡消费为零；所有构建 publish=never，没有创建标签、stable 或新公开 Release。公开发布只在清单与证据可审阅后另行批准。

接入见 [CLI/MCP](cli.md)，备份及故障恢复见 [恢复手册](recovery.md)，逐项功能与验收见 [覆盖表](coverage.md)。项目档案按 learner → logger 更新，并运行根工作区 node .ai/check-bounds.mjs；不将未验条件改成全部完成。
