# ADR-0096: Agent 配置模板与会话覆盖

- 状态：Accepted
- 日期：2026-08-31
- 关联：ADR-0083、ADR-0095

## 背景

会话已独占 Agent Instance，但资源和模型仍由宿主默认装配。逐项修改 Prompt、Skill、MCP 或 Plugin 会让一个 Turn 混用多个版本，也无法可靠恢复历史会话。配置模板需要与 Agent Definition revision、资源 generation 和安全权限明确区分。

## 决策

Coding Agent 拥有严格的配置 Schema、模板快照、会话覆盖与 SessionExtension 合同。复用 Runtime Configuration Registry/Resolver 解析默认、固定版本模板、会话覆盖三层；不创建第二个通用配置中心。

配置支持追加系统提示词、Skill/Tool/MCP Server/Plugin 选择、模型与推理等级。资源选择 `null` 表示继承宿主，空数组表示全部禁用，显式列表与宿主能力取交集。模板不能添加凭证、运行命令、安装插件或提升权限。模型优先级为本次请求、会话配置、原有模型状态。

配置仅作为 Runtime/SDK 与宿主代码能力开放，不通过 Desktop 对话 UI、preload 或专用 IPC 提供模板 CRUD、资源目录和会话编辑入口。模板由调用方提供固定版本快照；Desktop 不再维护模板编辑器专用文件仓库。会话文档通过 `coding-agent.configuration.v1` custom entry 保存完整模板快照与覆盖；模板后续修改或删除不影响既有会话。旧文档使用默认配置，未知格式明确失败，不静默恢复成全权限默认值。

配置保存成功后才发布 desired revision。通用 Agent Session 的 Snapshot admission 串行协调资源准备与完整快照捕获，捕获成功才提交 effective revision；失败释放快照、保留最后生效版本并拒绝本次执行。关闭等待在途捕获，已有 Turn lease 不因更新失效。Runtime Core 只认识 admission commit/rollback，不认识产品字段。

沿既有 Plugin 更新器同步贡献、MCP 与 Skill，不建立并行更新路径。Skill 源使用过滤装饰器，覆盖提示词、显式引用与 invoke_skill。工具最终集合取交集。MCP descriptor 提供明确的可选 serverName；限制启用时缺失来源的 MCP 工具不可用。Plugin Hook 在会话工厂获得 membership，并沿 Turn lease 冻结。

底层 Session Extension 保留 desired/effective/pending/失败查询与 expectedRevision 并发更新检查。配置状态通过现有 Observation Hub 进入可观测链路，不新增对话内配置控件。关键日志仅含身份、版本、操作阶段和稳定错误码，不记录配置值或错误正文。

## 备选方案

- 仅保存 Desktop Settings：不能覆盖 SDK、恢复和执行边界。
- 每次修改重建 Session：破坏会话资源与在途 Turn 生命周期。
- 各资源独立更新：无法证明一个 Turn 原子采用完整版本。
- 会话只保存模板 ID：删除或编辑模板后无法重现会话选择。

## 后果与验证

模板是可移植的资源引用配置，不是可执行 Agent Definition 或安全沙箱。不改变共享基础设施所有权，不实现 Agent Team。

验证涵盖 Schema、层解析、CAS、原子持久化、恢复、资源交集、快照失败与关闭竞态、旧 Turn 冻结，以及 Desktop 不再暴露编辑入口。缺失资源会阻止下一次执行，宿主调用方需通过底层配置 API 修正或恢复对应资源。

## 2026-08-31 修订

按产品范围收回最近新增的 Desktop 配置操作面，保留每会话独立实例及完整配置能力。已有会话内的模板快照与覆盖继续恢复；遗留 `agent-templates.json` 保持原样、不再读取或写入，既有会话不依赖该文件。原有模型选择与工作模式控件不在本次移除范围内。
