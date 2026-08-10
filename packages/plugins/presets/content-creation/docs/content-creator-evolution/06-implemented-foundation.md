# 已实施基础

本轮落地的是路线图 Phase 1、Phase 2 和 Phase 4 的可独立交付部分，目标是先降低无关上下文、减少工具选择错误，并把“如何做好内容”变成按任务加载的专业方法。没有在同一轮修改项目持久化协议或引入尚未验证的自动评审状态机。

## 贡献隔离

- `plugin.json` 启用 `contributionMode.hardIsolation`。
- 输入栏新增“内容创作”模式，启用后才注入插件的 Prompt、Skill、Tool 和画布入口。
- 系统 Prompt 缩为三个领域入口、安全边界和确认语义，不再承担完整创作教程。

结果：普通 Work 会话不会持续携带内容创作插件的上下文；用户进入明确模式后才加载相关能力。

## 三个领域工具

原有 7 个工具收敛为：

| 工具 | 职责 |
| --- | --- |
| `content_creation_inspect` | 读取 summary/project/capabilities/runtime/diagnostics 等窄视图 |
| `content_creation_edit` | 提交语义 operation，由服务端决定直接应用还是返回确认预览 |
| `content_creation_run` | prepare/status/cancel 生成运行；prepare 始终保留用户确认卡 |

`edit` 的当前风险规则是：包含删除操作或超过 6 条命令的批次返回预览；其余小型非破坏性批次在 revision 校验后直接应用。动态路由只拥有这三个工具的 allowlist，根据当前用户文本启用 inspect、edit、run 的最小集合，不能切换宿主或其它插件工具。

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
- 小型安全修改直接应用；删除和较大批次自动进入预览。
- destructive preview、revision conflict、生成确认与依赖排序等已有安全语义保持不变。
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
