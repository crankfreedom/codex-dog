# 阶段 5：指定重置卡与能力覆盖

## 当前状态

- 需求：REQ-20261117-05；工程、隔离模块及本机/runner 安装模拟已验证，真实卡来源只读已验，真实消费按用户选择暂缓，不宣称本轮总验收完成。
- CardService、FixtureCards 和 AppServerCards 共用卡片端口；主应用是唯一业务入口，CLI/MCP 不自行访问 App Server 或数据库。
- 真实消费未执行。用户分别授权两次新增只读：首次请求完成但测试报告目录遗漏，结果未留存、不计通过；额外一次返回 known/live 与 3 张 available 卡，脱敏报告保存且主应用/自建进程清理通过。未创建预约、未发送、未消费，来源消费开关为关闭。
- 真实来源必须明确指定本机 codex.exe，不自动发现或改选；留空不启动卡片来源。真实消费来源另须明确开启，每笔预约仍需指定卡与 cards.consume。

## 预约、消费与恢复

- 卡片明细缺失/null、账号 ID 缺失、过期、断连或未知类型不伪装为空卡/可用卡；公开结果只有 cardKey、名称、状态、到期和尾号。
- 创建预约保存原 creditId、账号摘要、唯一消费键、时间区及未来绝对时刻。指定卡在预约前过期或不可用时拒绝。
- 到期原子领取一次；真正消费写入前复核原账号、原卡、授权、退出/休眠及同账号其他未决消费。
- 第一张卡消费未决时，另一张预先预约的卡也停止；错过后标 missed，不以换卡或新幂等键绕过。
- cardKey 绑定来源、账号及卡 ID；列表读取后账号变化，即使原始卡 ID 被复用也拒绝旧选择。既有预约保留旧 cardKey、原 creditId 和原消费键，不迁改或换键；新预约使用当前明确刷新的引用。
- 取消只适用于 pending；running/uncertain 不能冒充成功取消。响应丢失保留原卡原键，显式核对确认可能完成原消费。
- 休眠跨过预约立即 missed，即使迟到不足十秒；退出期间错过的预约启动后 missed，不补用。
- 原卡原键返回 reset / nothingToReset / noCredit / alreadyRedeemed 分别保留；alreadyRedeemed 表示该原键已经成功完成，不换键重试。

## 实际协议证据（只读静态）

- 已安装 CLI SHA-256：094d4db493de22025712cc5963854e7654b7c97f4cee795e3e986270a0f4f6b4。
- 使用 CLI 仅生成实验协议 Schema，未启动真实 App Server 连接；临时目录 codex-dog-protocol-02f5c67de9984e368ab15a442818fa40。
- account/rateLimits/read 使用 excludeResetCreditDetails=false；accountId 可选且 nullable、明细可为 null，缺证据须失败关闭。
- account/rateLimitResetCredit/consume 的底层 creditId 可省略，但本产品强制非空原卡 ID，始终复用原 idempotencyKey。
- 桌面 consume_usage_reset 不能指定 creditId，因此不能用它替代本产品指定卡消费端口。
- 实际桌面 ASAR SHA-256：2551cba1057a05cdc5cf5d75b146fac4092bff4ce77a10c43e3286c88d24c82d。
- REA 发送 handler 证据 ev_edc7216f6bb11e17c20735a1cdcb48a51ae0c0de3f77d0d69ba1d52c6cf43540；所选来源部分覆盖且保留 native integrity 差异，不代表完整应用审计或运行成功。

## 验证与待办

- 实际新增只读报告：artifacts/stage5/real-readonly-once.json；首次报告保存失败保留于 first-read-report-failure.json。来源路径校验的过度转义已修正，新增 Windows/中文空格/异常路径和保存重启测试；卡引用的账号/来源隔离与旧记录兼容另有模块测试，最终 beta.10 安装及 runner 已复验通过。

- test/cards.test.ts 覆盖并发领取、持久幂等、响应丢失、原键核对、已有预约绕行、撤销、账号变化、短休眠及错过。
- test/app-server-cards.test.ts 覆盖真实适配器的隔离模拟协议、写入边界、帧/总截止、账号变化和自有进程清理，不连接真实服务。
- 开发版与最终 beta.10 安装版 CLI/IPC/MCP 已跑通模拟读取、指定卡预约、到期领取及结果核对；桌面实际创建/取消、写后丢响应、短休眠错过、退出重启和原卡核对通过，真实消费为零。
- Schema 10→11 两版 NSIS 升级、卸载保留未决、重装与原键核对通过；消费次数及原键保留，不增加模拟消费。故障注入与实际安装分开标记，见阶段 6。
- CI 44224371601、Preview 44224408068 最终成功；安装模拟报告与本机分别保存，runner 未接真实来源。
- 最终功能、C01–C82 和 A01–A40 已逐项映射 [覆盖表](coverage.md)，真实卡只读通过与首次报告失败分别保留，真实消费按用户选择暂缓，签名等未验项保持可见；能力目录数量本身不是验收结论。
