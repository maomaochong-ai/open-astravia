# 工作模式是任务解释的先验，资源侧 agent_mode 声明废弃

> **执行策略修订（2026-08-30）**：工具副作用分级与会话首调确认已完整移除，见文末修订。
> 本文原有的“可回收兜底”不再作为当前系统保证。

> **归属修订（2026-08-24，见文末《修订：模式注册表归宿主所有》）**：正文第 5 条把模式注册表放在
> coding-agent 并随其公开导出，该结论已被推翻。注册表（`modes/*.md`、生成脚本、`isAgentMode` 等
> 校验入口）现归 desktop 所有，位于 `apps/desktop/src/main/agent-modes/`；coding-agent 只保留
> `core.mode` block 槽位，正文由宿主经 `resolveModePrompt` 注入。「新增一个模式 = 一份 md + i18n
> 文案」这条承诺不变，只是 md 换了归属地。

工作模式经 ADR-0046 的 2026-08 修订已完成「零硬闸」软化：模式不再排除任何工具、Skill、MCP、插件或
Hook，只保留两样东西——mode 系统提示词 block 与 `agent_mode` 声明驱动的清单排序偏好。产品方向要求
模式在此基础上继续演进：不同模式要有**明确的重心偏移**（Work 优先文档路线、Coding 优先仓库路线，未来
还会新增更多模式），偏移必须是软的（低重心能力仍可用），新增模式的成本要接近零，并且**不给插件与扩展
开发者增加任何模式意识的负担**。

对现存机制的审计得出三个事实，构成本决策的直接动因：

1. **排序偏好对模型选择行为没有可观察的影响。** 模型选工具/Skill 靠 name 与 description 的语义匹配，
   不靠清单位置；在一个每条都被完整读入的结构化工具数组里，把某条从第 12 位挪到第 25 位不改变其被
   选中的概率。`sortByAgentModePreference` 的真实价值只剩「保持提示词前缀稳定」，而这一点不排序反而
   做得更好（注册序天然稳定）。
2. **「提示词详略」从未实现。** ADR-0046 修订、两份 CHANGELOG 与 `docs/plugin/manifest.md` 均称
   `agent_mode` 影响「排序与提示词详略」，但代码中不存在任何按模式调整 description 详略的路径；
   插件级声明也从不下传给子资源，唯一消费方是能力页的展示组件。
3. **真正产生模式差异的机制全部不读 `agent_mode`。** mode prompt（`profiles/modes/*.md`）、工作区
   事实注入（`workspace-facts.ts`）、工具描述反向触发段、heavy 工具首调确认闸——四层里没有一层消费
   资源侧的模式声明。声明与效果之间的链路是断的，字段已经退化为纯装饰。

换言之：`agent_mode` 声明是一个要求插件作者付出成本、却不产生任何行为的字段；而模式重心实际一直由
提示词层独立承担。本 ADR 把这个事实升格为设计。

## 决策

**模式 = 任务解释的先验（prior），且只是先验。** 重心偏移完全发生在「这句话是什么任务」的解释层；
解释确定后，具体工具/Skill 由语义匹配自然选中，模式不介入选择层；执行层的权限与业务校验独立于模式。

### 1. 模式的唯一资产是 `profiles/modes/<id>.md`

每个模式就是一份 md，只写三件事，**措辞只用任务类别，永不出现具体工具名、插件名**：

- **身份与交付形态**：本模式下「完成」长什么样（Work：结构化文档/表格/叙事；Coding：可运行的代码
  加验证）。
- **默认路线**：请求有歧义时的默认解释（如 coding.md 的 "Build me a page is a request for working
  code, not for a design document"）。
- **离开路线的证据标准 + 出声切换**：什么样的用户信号足以切换路线，切换必须显式告知
  （"Never switch routes on your own"）。

宿主 md 与插件之间的接口是自然语言本身：模式作者描述任务类别与默认路线（不知道有哪些插件），插件
作者把 description 写诚实（不知道有哪些模式），模型在解释层完成对接。两侧彻底解耦是「零插件负担」
的结构保证，而非纪律约定。

### 2. 资源侧 `agent_mode` 声明语义归零（deprecated）

- 删除排序链路：`agentModePreferenceRank` / `sortByAgentModePreference` 及其全部消费点
  （`tool-activation.ts` 的工具重排、`system-prompt-sources.ts` 与 `invoke-skill-feature.ts` 的 skill
  重排、`mcp-runtime.ts` 的 MCP 工具重排）。清单顺序回归注册序，前缀缓存更稳。
- `plugin.json` / tool / hook / MCP server / `SKILL.md` frontmatter 的 `agent_mode` 字段**解析保留、
  语义为零**：不破坏既有插件的安装与校验，文档标注 deprecated。能力页「模式偏好」展示区
  （`PluginAgentModeSection`）随字段一并移除。
- 仓库内所有 preset 的 `agent_mode` 声明（manifest、tool 注册、SKILL.md frontmatter）删除。

`matchesAgentMode` 等纯函数一并删除；`scope_use` ∩ `requires` 两条 fail-closed 轴不受影响。

### 3. 资源侧的义务是模式无关的诚实自描述

工具 description 必须写清「我是干什么的、什么情况下**不该**用我、替代做法是什么」（反向触发段，
`content_creation_assets` 为范本）。这是工具卫生，不是模式负担：一次写好，对所有现有及未来模式同时
生效，且直接作用于模型真正阅读的语义匹配层。

### 4. 事实注入与执行边界保持模式无关

- `workspace-facts.ts` 继续在会话创建时把 cwd 的客观性质注入 `core.context`。事实是先验的平衡器：
  Work 模式打开一个 Next.js 仓库时，「改个按钮」自然走代码路线，先验不会变成偏执。
- 工具副作用分级与首调确认已于 2026-08-30 移除（见文末修订）。沙盒、插件权限及工具自身的业务确认
  保持模式无关；提示词引导不保证误调用可回收。

### 5. 模式注册表数据化，新增模式零结构成本

现状：新增一个模式要改散布在 coding-agent / plugin-sdk / desktop（renderer atoms、preload、config
store、session store）等多处的 `"work" | "coding"` 硬编码联合类型，以及 `AgentModeIconToggle` 的
`AGENT_MODES` / `AGENT_MODE_ICONS` 常量与 i18n。

改为：`modes/*.md` frontmatter（id / label / description，新增 `icon`）是唯一事实源，
`generate-modes.mjs` 生成的注册表随 coding-agent 公开导出；`AgentMode` 类型收敛为注册表派生
（跨包边界处退化为 `string` + 运行时校验），UI toggle 遍历注册表渲染。此后：

> **新增一个模式 = 一份 md（含 icon frontmatter）+ i18n 文案。没有第三件事。**

### 6. 护栏：模式路线断言（可选，推荐）

模式差异从此完全由 mode md 的文本质量承担，唯一的回归风险是 md 被后续编辑改漂。为每个模式配少量
路线断言用例（如「Coding 模式下说『做个数据看板』，断言走仓库实现路线而非设计画布」），作为提示词层
的合同测试。这是本方案仅有的持续维护成本，且随模式数量线性、随插件数量为零。

## Considered options

- **保留排序偏好**：机制无效（见动因 1），且字段的存在本身是假信号——它承诺了一种不存在的偏移，
  诱导插件作者与宿主维护者继续在错误的层上投入（本 ADR 前一日刚发生：为「恢复偏好」向两个 preset
  补了 11 处声明，实际效果为零），否。
- **把声明接进提示词（按 `agent_mode` 生成「次要路线」清单附在 mode block 后）**：能修复声明与效果
  之间的断链，但保留了要求插件对模式表态这件事本身——模式增多后插件作者要对 N 个模式逐一表态，
  与「零插件负担、易增模式」直接冲突；且它在解释层重复了 description 已承载的信息，否。
- **运行时语义打分（embedding 相似度计算工具×模式相关度）**：把确定性的提示词组装变成非确定性，
  缓存敌对、不可调试，且仍在选择层施力——错层，否。
- **宿主维护「模式 → 任务类别 → 工具」映射表**：映射表就是换了位置的 `agent_mode`，维护负担从插件方
  转移到宿主方并随两侧数量乘积增长，否。
- **按模式改写工具 description 详略**：description 是插件对模型的契约，宿主按模式改写等于宿主替插件
  说话，破坏不可信边界的责任划分，否。

## 与既有 ADR 的关系

- **ADR-0046 及其 2026-08 修订**：产品语义（Work/Coding 分域、零硬闸、会话创建时固化、会话内不可变）
  全部继续有效。本 ADR 取代其中「`agent_mode` 降级为**排序权重与提示词详略偏好**」的结论——降级的
  终点不是偏好，是废弃；同时取代原正文中「模式注册表为中心硬编码」的结论（改为 md 派生）。0046 顶部
  已加指针。
- **ADR-0069（Turn-bound runtime generations）**：不受影响。mode 仍是会话创建时固化、Turn admission
  捕获的绑定值；本 ADR 只改变 mode 的下游消费方式，不改其生命周期。

## Consequences

- **行为变化**：清单排序不再随模式变化（本就无用户可感知差异）；能力页不再展示「模式偏好」栏。
  模式重心的表达完全集中到 mode prompt + 工作区事实 + 工具自描述三处。
- **删除**：`agentModePreferenceRank` / `sortByAgentModePreference` / `matchesAgentMode` 及四个消费点；
  `PluginAgentModeSection`；全仓 preset 的 `agent_mode` 声明（含 2026-08-12 补入的 11 处）。
- **保留但语义为零**：manifest / 注册字段 / SKILL.md frontmatter 的 `agent_mode` 解析（兼容既有插件），
  `docs/plugin/manifest.md` 相应段落改为 deprecated 声明。
- **迁移（类型）**：`AgentMode` 联合类型收敛为注册表派生；plugin-sdk 的 `ctx.getAgentMode()` 返回类型
  放宽为 `string`（宿主保证值来自注册表），属 SDK 类型层面的宽化，运行时兼容。
- **CHANGELOG**：coding-agent、runtime-tools、plugin-sdk、desktop 各记一条。
- **护栏**：`generate-modes.mjs` 校验 frontmatter 完整性（含 icon）；可选的模式路线断言 evals。


## 修订：模式注册表归宿主所有（2026-08-24）

正文第 5 条把模式注册表数据化后留在了 coding-agent，并随其 `./profile` 子路径公开导出。实际运行一段
时间后，这个归属被证明是错的：

1. **没有第二个消费者。** cli-host 与 SDK 宿主从不传 `agentMode`（全仓 grep 零命中），模式自始至终
   只有 desktop 一个消费方。放在 coding-agent 让一个桌面产品概念占据了通用 Agent 包的公开 API。
2. **注册表里混着纯渲染层字段。** `icon`（iconify class）与 `narration`（会话流按 progress 阶段折叠
   还是工具行内联）都只对 desktop 的 UI 有意义，却写在 coding-agent 的 md frontmatter 里，再经 IPC
   绕回 renderer。iconify class 出现在 Agent 运行时包中是归属错位最直接的证据。
3. **模式本身是产品概念，不是 Agent 能力。** 按本 ADR 的决策，模式只是任务解释的先验，全部作用发生
   在提示词文本层；coding-agent 需要的仅仅是「在 `core.mode` 槽位放一段宿主给的文本」。

### 决策

**注册表归宿主，coding-agent 只保留槽位。**

- `modes/*.md`、`partials/`、生成脚本与生成产物迁到 `apps/desktop/src/main/agent-modes/`，
  生成入口为 `bun run generate:agent-modes`（接入 desktop `build`，并由 `check-guards.mjs` 做
  `--check` 漂移校验）。
- coding-agent 删除 `profiles/modes-data.ts`、`profiles/mode-prompt.ts` 及 `./profile` 上的
  `MODE_PROMPTS` / `getModePrompt` / `isAgentMode` / `ALL_AGENT_MODES` / `DEFAULT_AGENT_MODE` /
  `AgentMode` 导出。
- 新增宿主注入口 `resolveModePrompt?: (agentMode: string | undefined) => string`，沿
  composition options → session initialization profile → turn capability assembly → Prompt Runtime
  抵达 `system-prompt-sources`。不注入 = 任何 `agentMode` 都不追加 mode block，即 CLI / SDK 的默认行为。
- `agentMode` 这个 id 仍沿原链路传递并参与会话持久化，只是对 coding-agent 而言变成不透明字符串：
  它不再知道存在哪些模式，也不解释模式语义。合法值校验归 desktop 的 `isAgentMode`。

### 后果

- **行为不变。** 用户可见行为、模式提示词正文、会话持久化格式（存的一直是 mode id 字符串）与历史
  会话兼容性均无变化。
- **公共 API 破坏性变更。** `@vetta/coding-agent/profile` 不再导出模式注册表相关符号。仓库内唯一
  消费者是 desktop，已同步切换；外部 SDK 使用者若依赖这些符号，需自带注册表并改用 `resolveModePrompt`。
- **回归防线。** 注入漏接不会产生类型错误、模式提示词会静默消失，因此钉了两层：
  `composition-boundary.test.ts` 在生产装配源码层断言注入存在，
  `model-call-frame-contract.test.ts` 端到端断言会话 `agentMode` 对应的正文确实进了 system prompt。
- **未来。** 若 cli-host 或 im-gateway 之后也需要工作模式，正确做法是把注册表抽到一个双方都能依赖的
  位置（如新的 `packages/agent-modes`），而不是退回 coding-agent——注入口 `resolveModePrompt` 已经
  为此留好了边界。

## 修订：移除工具副作用分级与首调确认（2026-08-30）

### 背景

工具名称或 light/heavy 声明不能判断一次调用是否符合当前用户意图。会话首次确认把选择责任交给用户，
确认后又放行该工具的后续所有调用；没有交互宿主时则直接阻断工具。它既不能保证误调用可回收，
也不能提供针对具体参数、目标和动作的授权。

### 决策

完整删除 `sideEffect` / `side_effect` 的声明类型、解析与传输、名称兜底清单、确认拦截器、会话台账、
专用 Session Extension 及 Desktop、SDK、CLI/IM 适配器。内置工具、preset 与 external 插件同时移除声明，
不保留旧字段兼容层、开关或替代实现。该修订取代正文第 4 条及 ADR-0046 中关于首调确认的保证。

模式先验、工作区事实和工具自描述仍负责选择引导。沙盒、插件权限、scope/requires、Hook 拦截、输入校验、
普通提问，以及工具已有的业务确认（例如内容生成计划确认）各自保持不变。

### 备选方案

- 保留等级但默认放行：留下没有行为的公共字段与维护负担，不采用。
- 增加更多工具名或改成逐次确认：仍将意图判断转交用户，并增加交互打扰，不采用。
- 本次同时加入参数级意图或授权策略：需要独立需求与评估，当前不实现。

### 后果与后续方向

原先被分类为 heavy 的工具可以在无确认宿主的会话中执行，也不会再弹出统一首调确认。
这是明确的行为及公共 API 破坏性变化；旧插件源码需要删除相关声明，宿主无需提供 tool-consent function。
不修改会话持久化格式，原台账只存在于内存，无需数据迁移。

移除本机制不等于已经解决工具误调用。后续方案应围绕当前任务意图、单次动作的参数与目标、可验证的授权范围，
以及实际执行边界来评估；不能再把“确认过这个工具”当作后续任意调用的授权。

回归验证覆盖原受拦截的产品/插件工具在无确认宿主时正常执行、旧分级不进入 IPC 合同，以及独立提问、
沙盒授权、Hook、工具错误与取消行为继续有效。
