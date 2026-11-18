# 旧版目标锁兼容核验

## 源码已确认的事实

- 旧源码 `codex-resume/src/store.ts` 的目录选择为 `CODEX_RESUME_LOCK_DIR` 优先；未设置时使用 `APPDATA/codex-resume/locks`，APPDATA 缺失才退到 home/.local/share。
- 原始目标字符串以 SHA-256 生成 `.lock` 文件名；内容为 `pid` 与随机 UUID `token`。独占创建使用 wx，随后写入并 fsync。
- 旧 CLI 的运行入口直接取得目标锁；旧桌面 `src/app/service.ts` 的 lease() 在取得锁失败后会执行 unlock()，然后再次取得锁。
- 旧 unlock() 仅凭锁记录的 PID 已退出即可删除，不读取 Codex Dog 未决意图。因此同目录和格式互操作不能证明崩溃/退出后的未决保护兼容。

## 本轮独立实现及证据

- `LegacyLockGate.inspect({directory,targetId,expectedDirectoryIdentity?})` 仅观察明确本地目录及规范小写 UUID 的目标文件，不创建目录、不取得锁、不删除锁。
- 每个祖先目录检查类型与链接，核对 realpath 和目录身份；锁文件以只读 fd 验证前后设备/inode/时间/长度/链接数，以及路径当前身份。只读取最多 4096 字节的严格 pid/token 记录，结果不返回原 token。
- 结果将 `lockAvailability=free/held/unknown` 与 `legacyDirectoryBinding=unknown`、`legacyCrashRecoveryCompatibility=unknown` 分开；空目录不会变成 overall passed，PID 存活也不是运行代码或环境归属证明。
- 七项本机隔离测试通过，覆盖缺目录、活/死/不可确认持有者、坏记录、超限、硬链接、文件/目录替换、祖先 junction，以及真实子进程持锁。全部运行在新建临时目录。
- 其中一项以原旧 FileJournal 源码在临时目录证明：新持有者退出后遗留的锁会被旧 unlock() 删除；结合旧桌面的静态调用路径构成兼容阻断证据，不是运行中旧桌面实测。
- runner 没有相邻旧源码时，该额外一项明确 skip；新版自包含检查继续运行。已有原旧锁互操作测试另外保留，不能扩大其成功范围。

## 仍需具备的真实条件

- 明确旧工具的实际运行入口/版本、启动方式，以及有效的 `CODEX_RESUME_LOCK_DIR`；若覆盖值为相对路径，还需旧进程的实际工作目录。不能用当前 Codex Dog 进程环境猜测旧进程环境。
- 选择实际共享的绝对锁目录，并核对当前文件系统身份。只读缺锁只能说明该瞬间无目标文件，不能替代派发边界的原子取得。
- 实际旧运行版本必须具有与未决保留兼容的回收策略，或有可靠的旧托管停用排他条件；当前已读旧桌面源码的自动回收行为不能直接放行。
- 当前没有读取旧运行作业或数据库，没有检查、取得或修改真实目录中的锁，没有真实发送。完整门禁与其他阻断见 [阶段 4 记录](stage4.md)。
