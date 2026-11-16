# GitHub 在线更新方案

> 原计划 0.4 的设计基线按职责迁入本文件；具体实现状态以 [G04 实施记录](g04.md) 为准。设计目录不等于已实现能力。

## 独立在线更新方案

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

用户于 2026-11-16 将发行平台改为 GitHub。当前采用 GitHub Releases 托管安装包和更新元数据，构建及草稿发布按 GitHub Actions 规划，不再以自有域名、对象存储或 GitHub Pages 为首版更新源。实际 owner/repository 尚未提供，文档使用 <owner>/<release-repo> 占位，不创建仓库或工作流。

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

依据：[electron-builder 更新流程](https://www.electron.build/v26/docs/features/auto-update/)、[GitHub 发布提供者](https://www.electron.build/v26/docs/publish/)、[GitHub Release 管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)、[Actions token 与最小权限](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)。这些文档用于核对可选机制，实际工具版本仍由阶段 1 实测锁定。

### macOS 扩展边界

预留更新适配器、平台路径、安装产物、架构、签名和公证配置入口。macOS 自动更新未来需要对应签名与产物；Codex 连接发现、Socket 及本地路径同样需要另行适配。预留更新入口不表示整个应用已支持 macOS。
