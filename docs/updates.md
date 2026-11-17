# GitHub 在线更新方案

> 原计划 0.4 的设计基线按职责迁入本文件；已有真实更新见 [G05](g05.md)，当前发行配置和签名入口见 [G06](g06.md)。设计目录不等于已实现能力。

## 独立在线更新方案

### G05 实施契约（REQ-20261116-09）

- 用户已指定公开发行入口 crankfreedom/codex-dog/releases；本轮继续 G05，仅允许测试预发布与隔离安装验证，不发布 stable。
- 固定 electron-builder 26.18.0 / electron-updater 6.8.11，使用稳定 v26 文档；不把 v27 未发行的签名清单能力当成已支持。
- 两版测试版本为 0.5.0-beta.1/0.5.0-beta.2，独立测试 appId/安装目录/profile，模拟数据，不接真实 Codex。
- 新增 updates.status/check/download/install，状态与检查为 read，下载及安装须明确 app.manage；公共参数不接受任意仓库、URL 或文件路径。
- 更新候选绑定 candidateId、expectedVersion、文件哈希；下载与安装为持久操作，必须携带幂等键，安装还须 artifactId、expectedVersion 和 confirm=true。
- 安装接受只表示已排队；稍后检查 CLI 文件占用、创建 SQLite 一致备份、持久记录待重启、关闭对外入口及 worker，最后执行 NSIS；重启后版本相符才完成。
- 已启动的安装版 CLI/MCP 不强杀；文件占用时保留旧程序与数据，提示关闭后用新操作重试。安装器也检查 CLI 文件，阻断手动升级绕过。
- 下载/哈希/网络/缺附件/版本变化/退出门禁失败不得提前运行安装器；退出失败不宣称安装成功；不自动降级或承诺整安装目录自动回滚。
- GitHub 源固定 beta 测试通道；本机回环协议夹具只在明确标记的测试发行包启用，不作为真实 GitHub 证据；草稿与真实预发布、网络证据分开记录。
- 未签名仅用于独立 G05 测试发行，HTTPS/哈希不能代替发布者签名；正式签名、Actions 发布环境和 G06 仍待验证。
- 2026-11-17 G05 已通过：本机 NSIS 11 组、真实 GitHub 8 组；beta.1/.2 为公开测试预发布，均非 latest，实际下载并升级至 beta.2；完整证据见 g05.md，不发布正式 stable。

### 边界与发布形式

- 建议使用 electron-builder、electron-updater 与 Windows NSIS，精确兼容版本先验证再锁定。
- 更新服务管理渠道、检查、下载、校验和状态；Windows 安装适配运行于 Electron 主进程。
- 更新通过生命周期接口申请安装，不直接读取任务内部状态或修改数据库。
- 首版整应用更新，桌面、CLI、业务进程及内置文档同版本发布，暂不实施模块热更新。
- CLI/MCP 调用同一更新服务，应用未启动时不能检查、下载或安装更新。
- 预留平台适配能力查询，macOS 当前明确返回未支持，不用空实现冒充已支持。

### 更新流程

检查版本 → 展示说明 → 按用户策略下载 → 校验来源及包完整性 → 用户或已授权调用方选择安装 → 阻止新投递和写操作 → 协调停止 → 安装 → 重启 → 校验迁移并核对未决任务。

允许后台检查和下载，不在活跃派发中强制重启。安装命令接受和最终安装完成分开表示；连接关闭后通过新版本启动状态确认，不能把断连视为安装成功。

### 更新源与安全

用户于 2026-11-16 将发行平台改为 GitHub，随后指定公开仓库 crankfreedom/codex-dog，当前源码与发行共用该仓库。G05 已验证 GitHub Releases 下载及安装；G06 新增本地 Actions 文件，当前仅校验与构建 artifact，未推送实跑，也没有自动创建草稿或正式发布的步骤。不再以自有域名、对象存储或 GitHub Pages 为首版更新源。

G06 正式更新入口区分 stable/beta，安装前必须验证 Authenticode、发布者及时间戳；无签名 Preview 不接入更新。用户暂无服务/证书，当前仅实现接入门禁，可信签名和签名后的实际升级尚待验证。

- 发布提供者采用 electron-builder 的 github provider，配置 owner、repo 及明确的发布策略；客户端只连接产品配置的发行仓库，不接收助手任意指定的下载 URL。
- 面向分发建议使用公开发行仓库，使客户端无需 GitHub 登录即可读取更新；源码仓库是否公开与发行仓库可分开决定。私有发行仓库需要额外认证设计，当前不以客户端内置 PAT 作为方案。
- stable 为默认渠道，只接收正式发行；beta 为用户明确选择的预发布渠道。版本使用 SemVer，禁止自动降级，安装目标版本不得在下载后被静默替换。
- Release 附件包含 Windows NSIS 安装包、生成的渠道元数据（正式渠道通常为 latest.yml）和打包器要求的关联文件；差分 blockmap 与 beta 元数据以选定版本实测产物为准。GitHub 自动生成的源码 ZIP 和 Actions 临时构建产物不作为安装更新包。
- Actions 先类型检查、相关测试和构建，再完成签名及打包；创建草稿 Release，上传并校验全部附件、版本、哈希和平台架构后，才进入正式发布步骤。后续流水线可以准备草稿，实际对外发布须有单独明确授权或事先约定的发布策略；本次不创建标签、不执行 git 操作。
- 发布任务最小化使用 contents: write 权限；同仓库优先使用任务 GITHUB_TOKEN。发行仓库独立时须另行配置限定仓库的发布凭据，不能假定默认 token 可以跨仓库写入；发布凭据及签名私钥仅在受限发布环境中使用，不进入客户端。
- GitHub 仓库管理权限、HTTPS、包哈希与平台代码签名分别处理来源和完整性风险；SHA-512 只能检查是否匹配元数据，不能单独证明发布者身份。Windows 签名和更新清单真实性保护以选定稳定工具版本的验证结果定案，不依赖未发布能力。
- 不覆盖同版本已发布安装包；问题版本采用更高版本前向修复。撤回或标记异常版本需明确用户策略，不通过客户端自动降级绕过数据库兼容性。
- GitHub 无法访问、限流或附件缺失时，返回可重试的更新错误并退避，不影响现有监控；不自动切换到未经批准的镜像。
- 数据库升级前做一致性备份，旧程序拒绝高版本库；安装前处理命令行文件占用及所有进程释放，安装后重新核对未决业务状态。自动回滚不作首版承诺。

依据：[electron-builder 更新流程](https://www.electron.build/v26/docs/features/auto-update/)、[GitHub 发布提供者](https://www.electron.build/v26/docs/publish/)、[GitHub Release 管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)、[Actions token 与最小权限](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)。当前 G05 工具版本已锁定，签名与 Actions 仍需后续实测。

### macOS 扩展边界

预留更新适配器、平台路径、安装产物、架构、签名和公证配置入口。macOS 自动更新未来需要对应签名与产物；Codex 连接发现、Socket 及本地路径同样需要另行适配。预留更新入口不表示整个应用已支持 macOS。
