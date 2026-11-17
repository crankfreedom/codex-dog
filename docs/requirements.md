# 需求与功能基线

> 原计划 0.4 的设计基线按职责迁入本文件；已有真实只读见 [G04](g04.md)，当前更新实现及验证状态见 [G05](g05.md)。设计目录不等于已实现能力。

## 现有基线与证据边界

功能核对入口：../../codex-resume/README.md、src/app/contracts.ts、src/app/service.ts、src/engine.ts、src/domain.ts、electron/main.ts、electron/worker.ts 及对应测试。

- 旧项目已有独立 utilityProcess、受限 contextBridge IPC、SQLite 持久化及发送前意图记录，值得继承其机制与约束。
- MonitorService 当前集中承担任务、额度、调度、重置卡等职责，是重新划分边界的重点。
- 旧档案曾记录 codex-modules 独立封装已完成部分实现；本次工作区核对仅见空目录，不应将其作为可复用代码资产。
- 旧测试和真实验证是设计参考，不自动成为新项目已通过验证的证据。
- 旧项目依赖版本是参考值，新项目具体版本和打包组合在阶段 1 验证后锁定。
- 首版外部查询以现有产品数据边界为基础；“全部接口”指全部公开产品能力，不意味着暴露任意 SQL、认证文件、原始管道或内部方法。

## 功能、模块、公开接口与验收对照

下表为功能归属摘要；具体模块边界、操作名称及 CLI 映射以[15 设计基线](roadmap.md)的阶段 0 设计基线为准，该表是最终范围；当前 19 项实现见 G04/G05，其余尚未实现。公共能力覆盖所有面向用户的操作，内部实现方法不逐个暴露。

| 功能 | 归属模块 | 公开能力草案 | 验收重点 |
|---|---|---|---|
| Codex 实例发现、连接选择、重连 | Codex 接入、连接管理 | connections.discover/get/configure | 多实例要求明确选择；连接失败不能伪装为空数据 |
| 额度快照与剩余额度展示 | 额度 | quota.get/refresh | 来源、读取时间、过期状态完整；未知不能当零或可用 |
| 额度与任务独立检查计划 | 额度、调度 | quota.policy.get/update、scheduler.settings.get/update | 两类周期独立；预计恢复时间不能触发恢复结论 |
| 会话列表与有界状态读取 | 会话 | threads.list/get | 目标身份校验、分页和字段边界明确 |
| 当前 Goal 元数据 | Goal 观察 | goals.get | 只读身份与状态；源缺失或不兼容保守失败 |
| 指定空闲会话的单次显式发送 | 续跑投递 | threads.send | 单次授权、目标状态与槽位复核，使用相同意图及核对机制；不得绕过现有托管 |
| 自动续跑任务创建与启停 | 托管任务 | tasks.create/get/list/enable/pause | 明确目标、提示词、次数上限及授权；完成任务不能误加入 |
| 暂停编辑与修订授权 | 托管任务 | tasks.update、tasks.revisions.list | 未落定投递不能编辑；保存后暂停；重新开启核验修订 |
| 队列、优先级、同级排序和槽位 | 调度 | queue.get/configure、tasks.reorder | 高优先级不抢占；暂停、到期、重启不提前释放槽位 |
| 仅观察模式、时段与有效期 | 托管任务、调度 | tasks.create/update、tasks.policy.get | 仅观察不创建发送意图；到期不等于完成；跨午夜边界正确 |
| 发送、回执与结果核对 | 续跑投递 | tasks.reconcile、attempts.get/list | 提交、回执、轮次完成分别表示；不确定不补发 |
| 完成识别、自动移除与人工移除 | 托管任务、历史 | tasks.remove、archives.list/get | Goal 与最新轮次综合判断；归档保留事件和尝试 |
| 提示词模板与默认模板 | 模板 | templates.list/get/create/update/delete/setDefault | 已创建任务的正文不被模板更新追改 |
| 重置卡明细 | 重置卡 | resetCards.list/refresh | 保留真实来源；完整卡 ID 不进入普通展示和日志 |
| 指定卡片预约、取消与核对 | 重置卡 | resetAppointments.create/list/cancel/reconcile | 明确指定卡及授权；保留原幂等键；错过不补用 |
| 自检与阻断原因 | 诊断 | diagnostics.run、tasks.inspect | 只读检查不推进调度；通过、阻断、未知、未检查分开 |
| 历史、时间线、稳定分页与范围导出 | 历史 | events.query/export、timelines.get、archives.list | 有界查询、一致性快照、旧缺失字段标未知 |
| 通知、托盘与窗口操作 | 桌面平台 | desktop.status/show、notifications.settings.get/update | 关闭窗口与完全退出的语义明确；通知遵守业务策略 |
| 设置、外观与本机数据入口 | 设置、外观、桌面平台 | settings.get/update、appearance.get/update、desktop.openDataDirectory | 有界参数、局部保存、预览撤销；操作使用固定路径 |
| 离线使用说明与能力发现 | 文档、能力目录 | help.get/search、capabilities.list/describe | 离线可用；接口说明与实际注册能力一致 |
| 应用版本、状态与退出 | 应用生命周期 | app.status/version/quit | 当前进程状态可辨；退出后返回明确离线错误 |
| 在线更新 | 更新 | updates.status/check/download/install | 安装前停止新投递并安全退出；命令行可调用 |
| 客户端授权与操作进度 | 访问控制、应用生命周期 | access.*、operations.* | 初次授权不能自授；长操作结果可核对，取消不撤回已发生副作用 |

旧 CLI 的模拟、混合、真实验证场景作为开发验证能力评估迁移：默认仅使用夹具和只读接入；真实发送、真实卡消费需要当次明确授权，不能因提供测试命令而自动执行。
