# Content Creator 演进分析

本目录分析如何把 `content-creation` 从“模型直接操作一组画布工具”演进为真正可用的内容生产系统。核心结论不是继续增加工具或节点，而是同时完成三次转变：

1. 从常驻工具集合转为按意图、阶段和能力渐进披露。
2. 从直接编辑画布转为先产出可检查的创作中间件，再编译为画布和执行计划。
3. 从“工作流能跑”转为有 rubric、候选比较、人工闸门和回归基准的质量闭环。

## 文档导航

| 文档 | 回答的问题 |
| --- | --- |
| [现状诊断](./01-current-state.md) | 当前实现为什么能工作但还不好用，问题具体落在哪里？ |
| [参考项目分析](./02-reference-projects.md) | 三个参考项目各自解决了什么，哪些不能照搬？ |
| [目标架构](./03-target-architecture.md) | 工具、Skill、创作状态、画布和执行器应该如何分层？ |
| [质量与评测](./04-quality-and-evaluation.md) | 如何让系统知道“什么是好”，并证明改进有效？ |
| [实施路线](./05-implementation-roadmap.md) | 如何在不推倒现有实现的前提下分阶段落地？ |
| [已实施基础](./06-implemented-foundation.md) | 本轮实际落地了什么，仍有哪些边界？ |
| [visual-skills 融合](./07-visual-skills-integration.md) | 两个 Skill 和 34 份 reference 如何逐项融入 Vetta？ |
| [Generative-Media-Skills Library 融合](./08-generative-media-library-integration.md) | Library 下 57 个 Skill 如何逐项进入场景手册、路由和质量闸门？ |
| [视频生成时间线与分镜](./09-video-generation-timeline.md) | Prompt 内时间分段和分镜如何指导视频模型生成？ |

## 分析快照

| 项目 | 本地提交 | 许可证 | 本次重点 |
| --- | --- | --- | --- |
| 当前 `content-creation` | 当前工作区源码 | 私有仓库 | Agent 工具面、Skill、领域状态、生成与确认流程 |
| Generative-Media-Skills | `03f1362`（2026-08-08） | MIT | Core/Library 分层、配方目录、低成本探索与人工选片 |
| visual-skills | `3c55471`（2026-08-08） | CC BY 4.0 | 薄入口、按任务加载 reference、模型专属知识、质量 checklist |
| ViMax | `05a4894`（2026-07-29） | MIT | 高层领域工具、阶段化 DAG、artifact authority、恢复、候选评审与 benchmark |

分析以本地源码和配置为事实源。参考项目中的模型名称、供应商能力和产品宣传只视为该提交的快照，不作为 Vetta 的固定合同。

## 最重要的判断

### 不应把“Skill 替代 Tool”理解为删除执行接口

Skill 负责教模型如何判断、规划和检查；Tool 负责可信地读写状态和执行副作用。真正需要减少的是模型每轮看到的工具数量、重复合同和过低层级的操作，而不是取消所有工具。

目标形态是：

```text
用户意图
  -> 轻量路由与对应 Skill/reference
  -> CreativeBrief / ShotPlan / GenerationPlan
  -> 少量领域 Tool
  -> Workspace command bus / Generation service
  -> Artifact + Evaluation
```

### 画布不应继续承担全部“思考介质”

当前模型必须把创意直接翻译成节点、连接和几十个 operation 字段。这样很容易得到结构正确但创作价值有限的图。应先形成 brief、视觉锚点、镜头计划、提示词计划和验收标准，再由确定性的 graph compiler 生成或更新节点图。

### 质量必须进入状态机，而不是只写在提示词里

“使用专业镜头语言”“保持一致性”只是建议。可用系统需要保存质量目标、验证结果、候选评分、用户选择和失败原因，并据此决定能否进入下一阶段。质量 gate 必须与 revision、artifact lineage 和付费生成确认一样成为领域对象。

## 推荐优先级

1. 立即启用插件贡献硬隔离，删除重复工具，先把无关会话的上下文成本降下来。
2. 将 7 个工具收敛为 `inspect`、`edit`、`run` 三个领域工具；编辑由 revision 校验和原子命令保证一致性，只有配额生成保留全局确认 gate。
3. 引入 `CreativeBrief`、`ProductionPlan` 和 stage/stale 状态，使画布变成计划的可编辑投影。
4. 建立 image/video/quality-review Skill 家族及渐进 reference 目录。
5. 上线低成本候选探索、像素级评审、用户选片、最终生成闭环。
6. 用固定 benchmark 和遥测比较上下文、工具误用、完成率、用户返工和产物质量。
