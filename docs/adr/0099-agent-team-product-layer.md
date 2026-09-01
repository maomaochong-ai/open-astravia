# ADR-0099：Desktop Agent Team 产品层

## 状态

已接受

## 背景

Desktop 需要在现有多 Agent Runtime 之上提供可理解、可配置的 Agent Team。用户把团队当作群聊使用，由 Leader 接收默认请求，也可以通过 `@` 选择成员。成员可以配置 MCP、Skill、Plugin 等能力，但系统提示词由预设角色提供，不暴露为编辑字段。

团队成员之间需要共享结果而不是工具调用和推理过程。共享上下文必须可重复投影，重复提交同一请求不能产生重复事件或重复执行。

## 决策

1. 新增 `@vetta/agent-team` 包，持有 Agent Profile、Team Definition、Session Event 和 Context Projection 的纯领域合同。
2. Desktop 主进程使用独立的 Agent Team Store 持久化配置，使用独立的 Session Service 管理每个成员的 Runtime 会话。IPC 仅负责参数校验和路由。
3. Agent Profile 分为库级 Profile 和团队副本。团队引用库级 Profile；复制会产生团队作用域的独立 Profile。更新被多个团队引用的 Profile 时，先计算受影响团队，UI 显示提醒。
4. Team Session 只持久化用户消息和成员最终文本结果。Context Projector 根据已投递事件集合生成公开上下文，过滤工具调用、推理过程和当前请求的用户消息。
5. Event ID 由会话、请求、成员和来源回合等稳定字段生成；Session Service 按会话串行发送，并在同一请求的结果已存在时直接返回，形成幂等边界。
6. Renderer 在侧边栏保留“智能体”配置入口；团队不是常驻的第二个侧边栏区块，而是作为“对话”下拉框中的一种会话来源出现。团队聊天默认使用 Leader，成员提及使用可识别的 `@handle` 按钮选择，而不是要求用户记忆内部 ID。
7. 编排和上下文投影通过 `AgentTeamExtensionRegistry` 注册。团队仅持久化策略 ID，读取与运行时使用同一注册表校验；能力选择保留扩展命名空间，内置 UI 先展示 Skill、Scene、MCP 和 Plugin。
8. 首次读取配置时幂等注入应用内置的 Agent Profile 与默认团队，并记录 `presetVersion`，避免用户必须先创建对象才能对话，也避免被用户删除的未来可选预设在每次启动时反复出现。新建 Profile 默认继承全部全局可用能力；切换任一能力后才物化为自定义集合。
9. Team Session 记录每个成员使用的 Profile ID 与 revision。后续回合发现配置变化时，保留成员 JSONL 历史并重建 live Runtime，使新的 Prompt、Skill、MCP、Plugin 和委派工具从下一回合生效。

## 后果

- 角色提示词和能力开关的职责分离，后续可以接入能力市场而不改变团队协议。
- Team Session 与普通会话的存储和生命周期隔离，便于后续增加团队事件类型、审批或可观测性。
- 当前版本使用本机 JSON 和本机 Runtime，会话跨设备同步、实时流式汇总和更复杂的 Leader 编排仍需后续扩展。
- 内置预设身份不可删除或改写，但能力仍可配置；复制预设时会移除内置身份，形成可独立编辑的团队 Profile。
- 能力目录使用图标、搜索、分组和虚拟列表；选择控件复用设计系统组件，不依赖平台原生 checkbox/select 的外观差异。
- 扩展策略如果被卸载或未注册，配置加载会报告错误并保留原文件，避免静默回退造成数据丢失。

## 不在本决策范围

- 不定义服务端计费、配额或跨账号协作。
- 不允许用户编辑预设系统提示词。
- 不把工具调用正文或模型推理过程传播给其他成员。
