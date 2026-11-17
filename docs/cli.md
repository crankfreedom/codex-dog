# CLI、IPC 与 MCP 接入

> 原计划 0.4 的设计基线按职责迁入本文件；具体实现状态以 [G04 实施记录](g04.md) 为准。设计目录不等于已实现能力。

## 当前入口参数

- 默认 profile=g02；普通 CLI 使用 client=cli，MCP 使用 client=mcp，各自独立配对。
- 全局选项：--profile、--client、--input FILE|-、--operation、--timeout-ms、--idempotency-key；--json 输出统一协议结果。
- access.request 默认申请 read，自动生成稳定申请键；grant/revoke 必须显式带幂等键与 expectedRevision。
- MCP 变更工具使用额外的 idempotencyKey 参数映射请求元数据，不放入业务 params。
- 退出码当前为 0 成功、2 输入、3 授权、4 状态冲突、5 离线/协议/只读超时、6 变更结果未决、7 内部/存储错误。
- 应用关闭不可调用；离线静态 --help/--version 不读取业务，API 3、来源模式和实时读取说明见 [G04](g04.md)。

## 公共操作与 CLI 命令目录

权限列 read 为普通业务读取；正文需要额外 content.read；“原权限”指操作所有者加原操作所需权限。access.request 是当前用户身份校验后的首次配对例外，不直接获得业务权限。本表保留最终计划签名，当前实现 G04 的 15 项及 [G05](g05.md) 的 updates.status/check/download/install，共 19 项；其余不可执行。更新命令的 candidateId/artifactId/expectedVersion/confirm 及幂等键以 G05 实施契约为准。当前 access.grant 的具体 code/scopes/expectedRevision 等参数以运行契约及 G02 配对手册为准。

| 编号 | 公共 operation | CLI 子命令 | 处理模块 | 权限 | 参数要点 → 结果 |
|---|---|---|---|---|---|
| C01 | app.status | app status | M00 | read | 无 → 就绪、业务进程、连接、更新时间及阻断状态 |
| C02 | app.version | app version | M00 | read | 无 → 主应用版本、API 范围、Schema 版本 |
| C03 | app.quit | app quit | M00 | app.manage | 明确退出确认、expectedInstanceId → OperationView，不中断远端 Codex |
| C04 | capabilities.list | capabilities list | M00 | read | 可选 namespace → 操作、权限、可用性及 Schema 版本 |
| C05 | capabilities.describe | capabilities describe --operation NAME | M00 | read | operation → 输入输出、错误、幂等与示例 |
| C06 | operations.get | operations get --id ID | M00 | read+所有权 | operationId → OperationView；管理员可查看全部 |
| C07 | operations.cancel | operations cancel --id ID | M00 | 原权限 | operationId → 已取消或不可撤销说明 |
| C08 | help.get | help get --topic TOPIC | M11 | read | 章节 ID → 离线内容及适用版本 |
| C09 | help.search | help search --query TEXT | M11 | read | 关键词、分页 → 匹配章节摘要 |
| C10 | connections.discover | connections discover | M01 | read | 无 → 候选及不确定原因，不自动切换 |
| C11 | connections.get | connections get | M01 | read | 无 → 当前选择、revision、兼容性，不返回原始账号 |
| C12 | connections.configure | connections configure --input FILE | M01 | settings.manage | candidateId、callerSelection、expectedRevision → 新配置；须全任务暂停且无未决投递 |
| C13 | quota.get | quota get | M02 | read | 无 → 当前 Observation，不触发网络或引擎 |
| C14 | quota.refresh | quota refresh | M02 | read | 无 → 独立实时读取结果，不改变自动查询计划或推进任务 |
| C15 | quota.policy.get | quota policy get | M02 | read | 无 → intervalSeconds、revision、下次计划 |
| C16 | quota.policy.update | quota policy update --input FILE | M02 | settings.manage | intervalSeconds、expectedRevision → 新策略，不立即派发 |
| C17 | threads.list | threads list | M03 | read | connectionId、分页、过滤 → 会话摘要页 |
| C18 | threads.get | threads get --input FILE | M03 | read | ThreadRef → 有界 ThreadView，不含聊天正文 |
| C19 | goals.get | goals get --input FILE | M03 | read | ThreadRef → GoalView，未知与确认无 Goal 分开 |
| C20 | threads.send | threads send --input FILE | M04 | messages.send | [15.5 设计基线](contracts.md)单次授权及期望状态 → OperationView+attemptId |
| C21 | tasks.list | tasks list | M04 | read | 分页、状态过滤 → TaskView 页，正文默认脱敏 |
| C22 | tasks.get | tasks get --id ID | M04 | read | id、可选 includeContent → TaskView；正文另需 content.read |
| C23 | tasks.create | tasks create --input FILE | M04 | tasks.manage | TaskInput、授权 → TaskView；自动模式且开启还需 messages.send |
| C24 | tasks.update | tasks update --input FILE | M04 | tasks.manage | id、expectedRevision、允许字段 patch → 新修订并保持暂停；未决拒绝 |
| C25 | tasks.enable | tasks enable --input FILE | M04 | tasks.manage | id、confirmedRevision、明确授权 → 开启结果；自动发送另需 messages.send |
| C26 | tasks.pause | tasks pause --id ID | M04 | tasks.manage | id → 暂停结果及仍在途的 attempt 摘要 |
| C27 | tasks.remove | tasks remove --id ID | M04 | tasks.manage | id、expectedRevision → 归档结果；须暂停且无未决 |
| C28 | tasks.reorder | tasks reorder --input FILE | M04 | tasks.manage | id、up/down、expectedQueueRevision → 同级顺序 |
| C29 | tasks.policy.get | tasks policy get --id ID | M04 | read | id → 当前生效策略、修订与授权摘要 |
| C30 | tasks.revisions.list | tasks revisions list --id ID | M04 | read | id、分页 → 修订元数据；不输出历史正文 |
| C31 | tasks.reconcile | tasks reconcile --id ID | M04 | tasks.manage | id → 原 attempt 核对结果，不发送新消息 |
| C32 | tasks.inspect | tasks inspect --id ID | M08 | read | id → 只读逐项阻断结果，不改计数/槽位 |
| C33 | attempts.list | attempts list | M04 | read | taskId 或 threadRef、分页 → 投递摘要页 |
| C34 | attempts.get | attempts get --id ID | M04 | read | attemptId → 提交、匹配、轮次终态及槽位 |
| C35 | attempts.reconcile | attempts reconcile --id ID | M04 | messages.send | 单次发送 attemptId → 读取原回执并更新本地核对状态，不补发 |
| C36 | queue.get | queue get | M05 | read | 无 → 开关、上限、占槽与候选摘要 |
| C37 | queue.configure | queue configure --input FILE | M10 | settings.manage | enabled、limit、expectedRevision → 新配置；降上限不撤回已提交轮次 |
| C38 | scheduler.settings.get | scheduler settings get | M10 | read | 无 → 任务周期及 revision |
| C39 | scheduler.settings.update | scheduler settings update --input FILE | M10 | settings.manage | pollSeconds、expectedRevision → 新配置 |
| C40 | scheduler.runNow | scheduler run-now | M05 | tasks.manage+messages.send | 无 → 执行一次额度/任务检查的 OperationView；可能续跑已授权任务，不提前消费卡预约 |
| C41 | templates.list | templates list | M06 | read | 分页 → 模板摘要与默认项 |
| C42 | templates.get | templates get --id ID | M06 | read | id、可选 includeContent → 模板；正文另需 content.read |
| C43 | templates.create | templates create --input FILE | M06 | tasks.manage | name、body 或 copyOfId/expectedSourceRevision → 新模板；复制正文需 content.read |
| C44 | templates.update | templates update --input FILE | M06 | tasks.manage | id、expectedRevision、patch → 模板；不修改现有任务 |
| C45 | templates.delete | templates delete --id ID | M06 | tasks.manage | id、expectedRevision → 删除结果 |
| C46 | templates.setDefault | templates set-default --id ID | M06 | tasks.manage | id、expectedRevision → 默认模板 |
| C47 | resetCards.list | reset-cards list | M07 | read | 无 → 卡片快照及读取状态 |
| C48 | resetCards.refresh | reset-cards refresh | M07 | read | 无 → 真实明细读取，不消费或推进预约 |
| C49 | resetAppointments.list | reset-appointments list | M07 | read | 状态、分页 → 脱敏预约页 |
| C50 | resetAppointments.create | reset-appointments create --input FILE | M07 | cards.manage+cards.consume | ResetAppointmentInput → 指定卡预约；持久绑定消费授权 |
| C51 | resetAppointments.cancel | reset-appointments cancel --id ID | M07 | cards.manage | id、expectedRevision → 仅取消未领取预约 |
| C52 | resetAppointments.reconcile | reset-appointments reconcile --id ID | M07 | cards.manage+cards.consume | id → 仅原键核对；若底层需重提同键，明确可能完成原消费，不创建新消费意图 |
| C53 | archives.list | archives list | M08 | read | 分页、原因过滤 → 归档摘要页 |
| C54 | archives.get | archives get --id ID | M08 | read | id → 归档详情，缺失字段标未知，正文受 content.read 控制 |
| C55 | events.query | events query --input FILE | M08 | read | taskId/from/to/type/reason、游标、limit → 固定边界事件页 |
| C56 | events.export | events export --input FILE | M08 | read | 同查询条件、可选 limit、output → OperationView；固定只读快照导出 JSONL |
| C57 | timelines.get | timelines get --id ID | M08 | read | taskId、分页 → 有依据的时间线，缺证据不补造耗时 |
| C58 | diagnostics.run | diagnostics run | M08 | read | 可选 taskId → 连接、额度、Goal、库及授权自检，不推进引擎 |
| C59 | settings.get | settings get --section NAME | M10 | read | section → 分区设置、revision及允许字段 |
| C60 | settings.update | settings update --input FILE | M10 | settings.manage | monitoring/notifications/appearance 分区 patch；其余使用专用命令，复用同一分区处理器 |
| C61 | appearance.get | appearance get | M10 | read | 无 → 已保存外观与 revision |
| C62 | appearance.update | appearance update --input FILE | M10 | settings.manage | expectedRevision、外观字段 → 已保存外观，不覆盖监控配置 |
| C63 | appearance.presets | appearance presets | M10 | read | 无 → 默认值、阅读预设与主题白名单 |
| C64 | appearance.preview | appearance preview --input FILE | M11 | settings.manage | 外观 patch、窗口标识 → 当前窗口临时预览，不写库 |
| C65 | appearance.cancelPreview | appearance cancel-preview | M11 | settings.manage | 当前窗口及 previewId → 撤销；离页/窗口关闭也撤销 |
| C66 | notifications.settings.get | notifications settings get | M10 | read | 无 → 通知与托盘设置 |
| C67 | notifications.settings.update | notifications settings update --input FILE | M10 | settings.manage | expectedRevision、patch → 已保存通知设置 |
| C68 | desktop.status | desktop status | M11 | read | 无 → 窗口、托盘和平台支持状态 |
| C69 | desktop.show | desktop show | M11 | app.manage | 无 → 显示现有主窗口 |
| C70 | desktop.openDataDirectory | desktop open-data-directory | M11 | app.manage | 无 → 打开固定的本应用数据目录 |
| C71 | updates.status | updates status | M12 | read | 无 → 渠道、目标版本、检查/下载/安装状态 |
| C72 | updates.check | updates check | M12 | read | 无 → 配置的 GitHub 仓库最新兼容版本，不自动安装 |
| C73 | updates.download | updates download --input FILE | M12 | app.manage | candidateId、expectedVersion → OperationView，不更换目标版本 |
| C74 | updates.install | updates install --input FILE | M12 | app.manage | artifactId、expectedVersion、明确安装确认 → OperationView，走退出门禁 |
| C75 | updates.configure | updates configure --input FILE | M12 | app.manage | stable/beta、检查/下载策略、expectedRevision → 新策略；不接受任意仓库或 URL |
| C76 | access.request | access request --input FILE | M09 | 首次配对 | clientLabel、申请权限 → 待授权 ID，不返回其他客户端秘密 |
| C77 | access.list | access list | M09 | access.manage | 分页 → 客户端、权限、授权版本和状态 |
| C78 | access.grant | access grant --input FILE | M09 | access.manage | 待授权 ID、批准范围、有效期 → 授权结果；不能超出授予者可委派范围 |
| C79 | access.revoke | access revoke --id ID | M09 | access.manage | clientId、expectedRevision → 撤销并使后续派发复核失败 |
| C80 | operations.list | operations list | M00 | read+所有权 | 分页、状态 → 自己的操作；app.manage 可查看全部 |
| C81 | events.subscribe | events subscribe | M08 | read | cursor、过滤 → 有界事件流；慢客户端断开后按持久游标补查 |
| C82 | desktop.openConsole | desktop open-console | M11 | app.manage | 无 → 仅打开本应用现有窗口的诊断控制台，不执行任意命令 |

表中 M10 的专用设置操作与 settings.update 共同调用同一分区服务，不能分别实现校验或保存。所有 --id 变更仍须携带幂等键及需要的 expectedRevision；expectedRevision 不放在命令表重复列出的场景，可与 ID 一起通过 --input 提交，最终 Schema 以能力目录为准。

TaskInput 可改为 templateRef（templateId+revision）替代 prompt，二者互斥；服务端复制指定修订正文并绑定摘要授权。模板正文不会因默认模板变化而追改。需要显示或复制旧正文时必须验证 content.read。

导出默认目录为本应用数据目录下 exports；output 仅允许 JSONL 文件，默认禁止覆盖现有文件。扩展到其他目录须在授权配置的 exportRoots 内，先规范化和校验路径；这不是任意文件写入能力。事件订阅只传脱敏事实，不能用它泄露提示词或凭据。

只读刷新与主动推进明确分开：quota.refresh、reset-cards refresh、tasks inspect、diagnostics run 不调用 scheduler.runNow，不改变调度缓存或额度计划；scheduler run-now 在输出和帮助中明确标注可能触发已经授权的续跑。卡片消费仍仅按预约时间及原授权执行。

MCP 工具名称由公共 operation 稳定编码，例如 tasks.pause 映射 tasks_pause；描述包含原 operation、权限和读写性质，启动时检查名称碰撞。CLI kebab-case、MCP 名称和 IPC 方法不是独立业务契约，三者都映射上述 canonical operation。

#### 请求与调用示例

以下只作为文档示例，不创建任务、不触发真实发送。

~~~json
{
  "threadRef": { "connectionId": "selected-instance", "threadId": "selected-thread" },
  "prompt": "继续此前已确认的任务。",
  "enabled": false,
  "maxResumes": 3,
  "mode": "auto",
  "priority": "normal",
  "expiresAt": null,
  "dailyWindow": { "allDay": true },
  "authorization": { "allowAutomaticSend": true, "connectionRevision": 1 }
}
~~~

~~~powershell
codex-dog.exe quota get --json
codex-dog.exe tasks create --input task.json --idempotency-key create-example-001 --json
codex-dog.exe tasks pause --id TASK_ID --idempotency-key pause-example-001 --json
codex-dog.exe operations get --id OPERATION_ID --json
codex-dog.exe updates check --json
~~~

requestId 由客户端自动生成；--idempotency-key 对应 Request 元数据，不混入业务 params。创建请求必须绑定服务端验证的当前连接/Goal 身份，示例中的占位 ID 不代表有效授权或可直接执行数据。MCP 使用同一 Request 语义与幂等键约定，不重新实现状态机。
