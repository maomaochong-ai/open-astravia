# 目标架构

## 设计目标

目标不是让模型更熟练地拼装节点，而是让用户可以用自然语言获得可编辑、可恢复、成本可控且质量可解释的内容生产过程。

系统应满足：

- 非内容创作会话不携带该插件贡献。
- 内容创作工具包一旦进入会话，工具名称、顺序和 Schema 在后续 Turn 保持稳定。
- 专业知识按模态、任务和模型加载，不与执行 schema 混在一起。
- Agent 先产出结构化创作计划，画布是计划的投影与人工编辑器。
- 所有付费生成都有成本可见的 plan 和确认 gate。
- 生成结果必须经过确定性检查、语义评审、视觉评审或用户选择。
- 上游修改会把依赖的下游 artifact 标记为 stale，而不是静默沿用。

## 五层结构

```text
1. Contribution Gate
   hard isolation / scenario / session-monotonic deferred bundle

2. Knowledge Plane
   router skill / modality skill / recipe / model profile / quality rubric

3. Planning Plane
   CreativeBrief -> ProductionPlan -> GraphPlan -> GenerationPlan

4. Execution Plane
   domain tools -> AgentService -> Workspace dispatch / GenerationService

5. Quality Plane
   validators -> evaluator -> visual judge -> human gate -> Evaluation artifacts
```

## 第一层：贡献与工具渐进披露

### L0：插件级硬隔离

把 `content-creation` 视为显式进入的创作模式：

- `plugin.json` 增加 `contributionMode.hardIsolation: true`；
- 提供 input action 打开/关闭内容创作模式；
- 未打开时 tools、skills、system prompt 和 Activity Tab 都不进入会话；
- ~~`agent_mode: ["work"]` 继续作为上层硬界。~~（已失效：agent_mode 随 ADR-0071 废弃，工具选择由描述引导，run 自带确认保留；工具首调确认已移除。）

这直接解决无关 Work 对话被污染的问题。

### L1：领域工具收敛

将 7 个工具收敛为 3 个：

#### `inspect` 领域操作

读取项目、阶段、选区、能力、诊断、评测和运行状态。要求：

- 默认只返回 summary；
- 用 `view` 指定 `brief | plan | graph | capabilities | diagnostics | evaluations | runs`；
- 支持 `nodeIds`、`artifactIds` 等窄过滤；
- 大模型目录返回摘要和可选值，不回传供应商无关字段。

#### `edit` 领域操作

提交领域级 intent，而不是要求模型决定 apply/preview：

```ts
type EditRequest =
  | { action: "set-brief"; brief: CreativeBriefInput }
  | { action: "apply-recipe"; recipeId: string; inputs: unknown }
  | { action: "revise-stage"; target: StageArtifactRef; instruction: string }
  | { action: "edit-graph"; operations: ContentAgentOperation[] };
```

服务端根据以下规则自动决定直接 apply 或返回确认卡：

- 删除或替换已有产物；
- 影响超过阈值的批量变更；
- 会使已确认阶段 stale；
- 预计产生费用或改变交付物；
- 用户显式要求预览。

安全策略不应依赖模型记住调用哪个工具。

#### `run` 领域操作

统一 prepare、resume、cancel 和 status：

- `action: "prepare"` 返回 generation plan 和确认卡；
- `action: "resume"` 只继续未完成且仍有效的阶段；
- `action: "cancel"` 走明确授权；
- `action: "status"` 是窄状态查询；
- 卡片订阅承担 UI 实时更新，模型只获取阶段性摘要。

`open_content_creation` 作为 edit/run 成功后的宿主副作用或 UI action，不再占一个模型工具。

### L2：稳定入口、按需 Schema 与 Skill

插件贡献启用期间，`content_creation_search` 与 `content_creation_execute` 保持固定的模型工具集合与注册顺序。
`search` 默认返回不含 Schema 的操作索引，并按 query 或精确 operation ID 返回当前步骤所需的 `inspect`、`assets`、
`edit.*` 或 `run` Schema；`execute` 使用轻量 envelope，并在插件领域边界按完整 Schema 再校验嵌套输入。
执行仍受插件权限、revision、路径校验与 run 全局确认约束，不增加工具首调确认。

插件通过 `agent.systemPrompt.promptPaths` 固定贡献一段简洁的工作流路由提示，并申请最小的
`agent.systemPrompt.write` 权限；它只区分复杂、规范、可审查的内容生产与简单、一次性、要求立即出结果的
直接生成，不注册逐轮执行的动态 System Prompt Provider，也不申请 `agent.tools.control`。稳定的 Skill 索引负责
进一步说明具体任务入口；模型命中后调用宿主 `invoke_skill`，Skill 正文以工具结果进入消息历史，并按正文路由
读取必要 reference。这样用户措辞和工作流阶段不会改变 system prompt 内容或工具定义，专业知识仍可按任务渐进披露。

### L3：宿主级通用 deferred plugin tools

长期仍可把现有 MCP `tool_search` 的 deferred controller 抽象到所有 catalog tool source。当某个领域工具包
的序列化 Schema 超过预算时，只注入轻量索引和搜索工具；命中后一次性激活完整领域工具包，并在当前
Session 内只增不减。允许首次激活产生一次可解释的缓存变化，后续 Turn 必须恢复稳定，不能按工作流阶段
反复启停。

触发阈值应以 Schema 字节数或估算 token 为主，而不是只数工具个数。本插件现有 `edit` operation Schema 已达到约
50 KB，且用户明确要求参考 Cloudflare 的 MCP 优化，因此先在插件领域内落地固定 `search + execute` 合同；它不执行
模型生成代码，也不改变宿主 catalog。未来宿主提供通用 deferred source 后，可将同一 operation catalog 适配到宿主入口，
而不改变 `inspect` / `assets` / `edit` / `run` 领域服务。

## 第二层：Skill 与知识资源图

推荐目录：

```text
agent/skills/
  content-creation-router/SKILL.md
  operate-content-project/SKILL.md
  direct-image-creation/
    SKILL.md
    references/
      universal-quality.md
      editing.md
      text-rendering.md
      continuity.md
      failure-repairs.md
      models/<capability-profile>.md
      patterns/<domain>.md
  direct-video-creation/
    SKILL.md
    references/
      dramaturgy.md
      shot-language.md
      continuity.md
      sound.md
      failure-repairs.md
      models/<capability-profile>.md
      patterns/<genre>.md
  review-content-quality/
    SKILL.md
    references/
      image-rubric.md
      video-rubric.md
      platform-rubric.md
  recipes/
    product-hero/SKILL.md
    cinematic-product-ad/SKILL.md
    social-campaign-pack/SKILL.md
    storyboard/SKILL.md
```

原则：

- router 只判断任务模态、交付物和需要加载的 Skill。
- 每个 Skill body 保持薄，只放读取顺序、决策树和输出协议。
- universal、model、task pattern 和 failure repair 分开。
- model reference 描述提示策略；实时可用模型、尺寸、时长和输入限制仍以 capability registry 为真源。
- recipe 定义产品级输入、阶段、并行关系、gate、fallback 和交付物，不直接写供应商请求。
- quality-review 与 creator 分离，避免创作提示污染评审标准。

## 第三层：创作中间件

### `CreativeBrief`

建议最小合同：

```ts
interface CreativeBrief {
  objective: string;
  audience?: string;
  surfaces: Array<{ kind: string; aspectRatio?: string; duration?: number }>;
  subject: string;
  message?: string;
  creativeDirection: {
    style: string;
    palette?: string[];
    lighting?: string;
    cameraLanguage?: string;
    soundDirection?: string;
  };
  references: Array<{
    assetId: string;
    role: "identity" | "product" | "composition" | "style" | "motion" | "audio";
    preserve: string[];
    ignore?: string[];
  }>;
  constraints: string[];
  successCriteria: string[];
  budgetMode: "draft" | "balanced" | "final";
}
```

模型先补齐 brief，只有会显著改变费用、交付物或 reference 要求的缺失信息才询问用户。

### `ProductionPlan`

Production plan 表达“要生产什么”，不暴露画布坐标：

- deliverable plan；
- shared visual/continuity bible；
- shot 或 variant 列表；
- 每项的功能、依赖、质量目标和 fallback；
- 探索与最终生成的分界；
- 用户 gate；
- 预计模型能力和成本等级。

### `GraphPlan`

由确定性的 compiler 将 ProductionPlan 映射为现有节点和边：

- 使用 Node Definition Registry 校验端口类型；
- 自动生成稳定 id、purpose、连接和布局；
- 复用语义匹配的现有节点；
- 只在高级自由编辑时暴露低层 operation；
- graph diff 继续走 revision 和 preview token。

这样既保留开放画布，也避免让模型每次重新发明图结构。

### `GenerationPlan`

生成前冻结以下信息：

- 对应 project revision 与 stage artifact revision；
- 具体节点/镜头、依赖和执行顺序；
- model capability resolution 结果；
- draft/final 参数与候选数量；
- 预计调用次数和费用等级；
- blocking diagnostics；
- 生成后要执行的 evaluator；
- 用户确认项。

## 第四层：阶段状态机与 artifact lineage

推荐通用阶段：

```text
draft
  -> brief-ready
  -> concept-ready
  -> production-plan-ready
  -> generation-ready
  -> exploring
  -> selection-needed
  -> finalizing
  -> review-needed
  -> delivered
```

不同 recipe 可跳过不需要的阶段，但不能绕过 generation confirmation 与适用的质量 gate。

每个阶段 artifact 保存：

- `id/type/version/status`；
- `sourceRevision` 和上游依赖；
- 创建者（user/agent/system）；
- 内容或 workspace path；
- validation/evaluation refs；
- `staleReason`；
- supersedes/derivedFrom lineage。

当 brief、reference 或 continuity anchor 改变时，下游 plan、prompt、candidate 和 final 应按依赖图标记 stale。恢复运行只复用非 stale artifact。

## 第五层：UI 与 Agent 的职责

UI 和 Agent 继续共享领域服务，但面向不同交互：

- Agent 负责从意图生成 brief、计划、候选策略和修订建议。
- 画布负责查看、局部编辑、比较候选和理解依赖。
- 卡片负责阶段确认、费用确认、候选选择和 review 结论。
- GenerationPlan 负责保存视频模型所需的时间分段、镜头职责和交接状态。

建议在 Activity Tab 增加阶段栏：Brief、Plan、Canvas、Generate、Review。不是再加一层装饰导航，而是让用户看到当前系统为何还不能生成、哪些决策待确认、哪些结果因修改已过期。
