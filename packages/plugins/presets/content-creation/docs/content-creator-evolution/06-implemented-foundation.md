# 已实施基础

本轮落地的是路线图 Phase 1、Phase 2 和 Phase 4 的可独立交付部分，目标是先降低无关上下文、减少工具选择错误，并把“如何做好内容”变成按任务加载的专业方法。没有在同一轮修改项目持久化协议或引入尚未验证的自动评审状态机。

## 贡献与路由

- 插件启用后贡献 Prompt、Skill 和三个领域 Tool；输入栏“内容创作”模式负责软显隐和 prompt 装饰。
- 动态路由根据当前用户文本启用 `inspect`、`edit`、`run` 的最小集合，不能切换宿主或其它插件工具。
- 系统 Prompt 缩为三个领域入口、状态检查和运行确认语义，不再承担完整创作教程。

结果：模型面对稳定的领域工具面，输入模式仍能显式表达当前画布上下文，而不是承担安全隔离职责。

## 三个领域工具

原有 7 个工具收敛为：

| 工具 | 职责 |
| --- | --- |
| `content_creation_inspect` | 读取 summary/project/graph/readiness/capabilities/runtime/diagnostics 等窄视图 |
| `content_creation_edit` | 原子提交 revision-bound 语义 operation，不要求用户确认 |
| `content_creation_run` | prepare/status/cancel 生成运行；prepare 进入插件全局确认弹窗 |

`edit` 将节点、连接和素材绑定作为一个批次完成校验与提交；revision 冲突或任一命令失败时不会产生部分修改。Agent 使用稳定的 `targetInput` 语义输入，领域层负责解析真实端口，并为端口缺失、类型不匹配、端口占用和成环返回不同错误代码。

`inspect` 的 graph/readiness 视图提供语义连接、连通分量、孤立节点、可运行/阻塞节点和工作流状态，使 Agent 能在创建后确定性复查实际图结构。仅已配置凭据并满足必要 endpoint/model 配置的 Provider 模型会进入 capability registry。

## Skill 资源图

新增或重构 6 个 Skill：

1. `develop-creative-concept`：把模糊需求发展为可评审的策略、创意 territory、treatment 和 beat spine。
2. `operate-content-workflow`：检查、编辑、运行、revision 冲突和确认边界。
3. `direct-image-creation`：图片 brief、模型 Prompt Profile、提示词骨架、视觉拆解、编辑/连续性、文字信息设计、多面板和行业配方。
4. `direct-video-creation`：镜头戏剧性、导演/编剧/剪辑模式、模型 Prompt Profile、镜头卡、Animatic、编辑/延长、速度场景和失败修复。
5. `review-content-quality`：基于实际像素/帧的 must-pass gate、分维 rubric、候选比较和最小修复策略。
6. `create-content-campaign`：产品发布、电影感产品片、广告变体、社媒套装、UGC、角色故事和分镜转视频配方。

每个 `SKILL.md` 只保留触发、路由和关键阶段；细节位于一层 `references/` 中，由具体任务决定是否读取。内容为 Vetta 重新组织和撰写的方法，参考了 Generative-Media-Skills（MIT）、visual-skills（CC BY 4.0）和 ViMax（MIT），相关 Skill 内保留来源说明。

## 已验证合同

- 工具注册面固定为 3 个领域工具。
- 只读诊断、工作流规划和端到端生成请求会得到不同的最小工具集合。
- 创建、编辑、删除、语义连线和素材绑定都直接原子应用，revision conflict 不得覆盖并发修改。
- 生成准备不消耗额度，用户必须在全局弹窗确认；运行仍按依赖排序。
- 端口解析、成环诊断、工作流 readiness、凭据模型过滤与全局运行弹窗都有定向测试。
- 所有 Skill 均通过官方 `skill-creator` 快速校验器。

## 尚未实施

以下能力需要公共持久化合同、迁移和更完整的 UI/评测设计，本轮没有伪装成 Prompt 能力：

- 版本化 `CreativeBrief`、`ContinuityBible`、`ProductionPlan`；
- recipe registry 与确定性 graph compiler；
- stage/stale dependency propagation 和 artifact authority 的领域状态；
- candidate group、用户选片卡和持久化 `Evaluation` artifact；
- 对实际图片像素、视频抽帧和音频的自动评审执行器；
- 可重复的 context/tool/task/cost/quality benchmark 报告。

这些工作仍按 [实施路线](./05-implementation-roadmap.md) 的 Phase 3、Phase 5、Phase 6 推进。当前 Skill 已经定义相应的人工判断方法和阶段边界，但不会声称系统已自动保存或执行这些状态。
