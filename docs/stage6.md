# 阶段 6：安装、升级与发行准备

## 当前状态

- REQ-20261117-05 / REQ-20261118-01 / REQ-20261119-01，2026-11-19：不依赖签名的产品实现、当前本机安装/升级与远端 CI/Preview 已通过所列验证；完整 G06 与 Goal 未完成。
- 复用 UpdateService、NSIS、GitHub Actions 和发行门禁；83 项能力、API 3 / SQLite Schema 11，正式 SVG/PNG/七尺寸 ICO 已接入。
- 用户先不配置签名、暂缓真实卡消费；明确禁止本轮真实发送及公开发布。旧 codex-resume 由用户确认没有托管，不再要求提供旧运行目录。
- 真实发送门禁事实及上游所缺协议见[门禁记录](real-delivery-gates.md)，不以模拟或静态证据放行。

## 最终候选与安装入口

| 项目 | 本机候选 |
|---|---|
| 版本 / 构建标识 | 0.6.0-beta.14 / 9a013460，未签名 Preview |
| 安装器 | release/g06/preview/0.6.0-beta.14/9a013460/Codex-Dog-Preview-0.6.0-beta.14-Setup.exe |
| 字节数 | 142800090 |
| SHA-512（base64） | OZS/xt/G5+g7KG1t9bvtjuAjY4OVPEC8qYbdyT4NEF/b+B2MHSjBE78/8+6dRpwoYDbU3x9hp1nHLF+BTeUT8g== |
| 已安装主程序 | artifacts/g06/installed/9a013460/CodexDogPreview.exe |
| 配套 CLI / MCP | 同目录 resources/cli/codex-dog.exe；内置 Node，MCP 使用 mcp serve |
| 默认数据 | %LOCALAPPDATA%/codex-dog/profiles/g06-preview-9a013460，fixture |

以上为项目相对路径；清单 artifacts/stage6/final-manifest.json 验证安装器大小/SHA-512、安装 CLI 和冻结资源的一致性。升级验证会切换 Preview 的测试安装目录，最后重新实装并检查上述入口。当前候选说明见[发行说明](release-notes.md)。

## 当前本机验证

| 范围 | 结果与分类 | 证据 |
|---|---|---|
| 模块、事务、故障与入口边界 | 195 pass、0 skip；构建/边界/文档/发行检查通过 | artifacts/delivery-gates/unit-tests-guard.tap |
| NSIS 与版本一致性 | 4 组通过；主应用/worker/SEA CLI 同版本，实际 Authenticode 拒绝无签名负例 | artifacts/g06/preview-report.json |
| 安装版阶段 2/3/4–5 | 9 / 9 / 10 组通过；模拟任务/卡片、页面、托盘、退出、撤销及未决恢复 | artifacts/stage2、stage3、stage4/installed.json |
| 安装模拟门禁 | 8 组，隔离 SQLite/管道；单项元数据通过仍不能发送，创建观察任务在内容读取前拒绝 | artifacts/delivery-gates/installed-simulated-adapter.json |
| 安装真实只读门禁 | 6 组流程通过、门禁 blocked；一次 get_usage_limits，创建账号匹配/Goal 关联/持久轮次实际观察；任务创建拒绝且零记录 | artifacts/delivery-gates/installed-real-readonly.json |
| 实际独立任务周期 | 两个十秒周期完成模拟投递/唯一回执/Goal 归档，未调用 runNow；关闭生效 | artifacts/stage4/scheduler-timer.json |
| Windows 通知 | 实际 show=2、failed=0、固定文本；事件来自模拟业务，不是实际额度恢复 | stage4 安装报告 |
| 两版升级、卸载、重装 | beta.5 Schema 10→beta.14 Schema 11，未决原意图/原卡原键/次数/held 保留，无重放；卸载保留 profile，重装后核对原结果 | artifacts/stage6/upgrade-report.json，5 组 |
| 历史本应用迁移 | beta.4 Schema 3→11，外观保留，不迁入旧产品数据、不伪造旧业务 | 同升级报告中的独立隔离 profile |

安装/升级业务副作用全部来自隔离夹具，真实发送和真实消费始终为零。真实只读核验不调用 read_thread、Goal API 或卡片端口，不读认证、聊天正文或原生 Goal objective。创建账号相同不证明当前执行绑定，真实旧锁协议未计通过。

## 远端与失败记录

- [CI 44470313405](https://github.com/crankfreedom/codex-dog/actions/runs/44470313405) success：195 项中 190 pass、5 skip、0 fail；G03/G02 12/20 组，阶段 2/3/4–5 9/9/10 组和模拟门禁 8 组。报告以认证范围读取并保存至 artifacts/stage6/remote-ci-44470313405，逐项检查 ID/结果与 JSON 长度/CRC32；日志取自同一运行。
- [Preview 44470312102](https://github.com/crankfreedom/codex-dog/actions/runs/44470312102) success：独立 beta.14 实装 4+9+9+10 组及模拟门禁 8 组。JSON 以认证 ZIP 范围读取、长度/CRC32 核对，证据 artifacts/stage6/remote-preview-44470312102；未完整下载远端安装器到本机验哈希或重装，不假定本机和 runner 安装包相同。
- 五项 skip 为 runner 无相邻旧源码：原四项互操作与新增旧 unlock 回收复现；本机对应项通过。Preview 跳过签名环境步骤，不算签名门禁通过。
- 首轮 CI 44246887639 / Preview 44246943931 有七项目录夹具失败；规范化临时位置后通过，实际 preflight 的 tempPathCanonical=false，生产目录/链接检查未放宽。
- beta.11 安装回归遇到任务编辑与通知游标的全局修订假冲突，已修复并补并发故障注入；失败和修复保留 artifacts/delivery-gates/failures.json。beta.13 桌面启用历史任务时先读会话的隔离失败单独保留于 artifacts/delivery-gates/installed-simulated-adapter-failure.json；beta.14 两个页面均先核对来源门禁。网络/TLS 观察失败未当作 workflow 失败重建运行。
- beta.10 历史结论、真实卡只读首次报告保存失败及有效额外一次、模拟单卡消费脚本和隔离进程时区证据保留；当前同名报告以本候选为准。beta.12 和 beta.13 的历史报告另存 artifacts/delivery-gates/beta12-baseline 与 artifacts/stage6/beta13-baseline，历史不替代本轮证据。

## 仍未完成的验收

- 真实发送需同一所选桌面/host 的目标/Goal 执行账号、来源目录和源端无正文实时状态证明，以及原发送标识→唯一目标 turn 的完整持久查询；当前接口未提供完整证明，真实自动化读取前阻断。后续门禁齐备才请求具体对象/动作/次数/影响的独立发送授权。
- 可信签名继续暂缓：有效链、发布者、时间戳、签名升级和签名卸载器正例未验，不用自签替代。
- 真实卡消费和原键正例按用户决定暂缓；已有两次新增只读授权均已用，不自动再查或消费。
- 实际整机休眠和系统时区切换未执行；现有证据为模块边界、模拟电源事件、实际进程恢复和隔离进程时区，不扩大结论。
- 所有构建 publish=never，无新标签、stable 或公开 Release；最终公开发布仍需单独批准。外部条件和未验证项不改写为全部完成，Goal 不标记完成。

接入见[CLI/MCP](cli.md)，备份与故障恢复见[恢复手册](recovery.md)，逐项设计/验收映射见[覆盖表](coverage.md)。档案遵循 learner → logger，并运行根工作区 node .ai/check-bounds.mjs。
