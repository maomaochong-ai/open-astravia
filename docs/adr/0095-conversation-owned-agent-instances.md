# ADR-0095：Conversation Session 拥有独立 Agent Instance

- 状态：已接受
- 日期：2026-08-31

## 背景

Coding Agent Composition 同时表示工作区资源组合和固定 revision 的 Agent Instance。Desktop 按 scope 复用
Composition，导致同一工作区中的新会话也被绑定到已有实例；普通对话虽常有独立 cwd，隔离仍依赖目录策略的偶然结果。
会话配置和可观测性需要明确区分持久 Conversation 身份与本次运行身份。

## 决策

1. 保留 ADR-0084 的唯一 RuntimeHost 和共享 Definition Registry。Composition 只组合工作区基础设施和产品
   Session Plan 工厂，不预热实例；每次创建或恢复 Session 由 RuntimeAgentSessionAssemblyBackend 获取无共享 key
   的独立 Instance lease，并随 Session 释放。通用 Instance Pool 仍支持调用方显式请求共享。
2. 活动 Session 的多个 Turn 复用自己的 Instance。新 Session 默认绑定 Registry 当前 Definition revision，旧 Session
   保持原 revision。恢复保留持久 Conversation identity，分配新的 Instance；continuation 只重绑 Session identity。
3. Composition.agentRuntime 只提供 agentId；完整运行身份由 readSessionAgentIdentity(sessionId) 查询。
   移除 Composition 级 instanceId 创建选项。不要把 Instance 或对象引用写入 Conversation 文件。
4. 工作区工具目录、持久化基础设施和允许共享的 MCP Source 仍属于 Composition/平台池；执行资源、扩展状态和
   Turn generation 属于 Session。实例隔离不授予新权限，也不意味着进程、文件或 MCP 连接隔离。
5. Backend 关闭首先封闭创建入口，等待已准入的创建/激活/回滚结束，再释放 Instance Pool；失败的释放仍可重试。
   产品 Definition 转换失败时必须释放尚未交给 Runtime 的 Session Plan，保留原始失败与清理失败。

## 备选方案

- 每会话创建整个 Composition：增加基础设施与连接重复，混淆可共享资源与独占状态。
- 继续共享 Instance，增加更多 Session 字段：保留实例身份与会话配置的错位，难以诊断版本归属。
- 每个 Turn 新建 Instance：破坏多轮状态和资源生命周期，无助于 ADR-0069 的 Turn 内一致性。

## 后果与验证

Composition 身份查询为公共 API 变更；工作区消费者改为按会话读取实例，不提供伪造的兼容身份。
历史数据格式不变，普通能力更新仍遵守 ADR-0069，从下一 Turn 原子可见。本决策不引入 Agent Team 或通信协议。

验证覆盖同 scope 多会话隔离、连续 Turn、Definition 新旧版本、恢复历史、独立关闭、共享 MCP、失败回滚、
关闭期间创建及释放重试。日志沿既有 Observation Hub 记录安全身份，不记录 Prompt、配置值或错误正文。
