# System Prompt Architecture

本文说明 Coding Agent 系统提示词的所有权、编译流程和维护约束。目标是让规则只在一个层级定义，并让运行时提示词可以验证、刷新和观测。

## 规则所有权

| 层级 | 负责内容 | 不应包含 |
| --- | --- | --- |
| Product core | 身份、回复语言、文件名保真、最终答复时序、场景渲染策略 | 具体工作模式偏好 |
| Capability | 当前实际工具及其描述、仅在工具存在时适用的调用规则 | 不可用工具的调用要求 |
| Mode | Coding/Work 的领域偏好、质量标准、沟通方式及既有模式交互契约 | 产品身份、工具实现和 Plugin 协议 |
| Persona | 表达风格和个性 | 工程策略、工具协议 |
| Project context | `AGENTS.md`、`CLAUDE.md`、`SYSTEM.md`、`APPEND_SYSTEM.md` | 产品级默认规则 |
| Plugin/Feature | 带来源的动态 block 和工具贡献 | 伪造 `core.*` block 或重复 ID |

直接用户消息优先于项目上下文；更深目录的项目指令优先于上层目录。Mode 与 Persona 相互正交。现有 Mode 提示词属于兼容性契约，调整或迁移其中规则前必须逐条验证原有行为，不能以去重为由直接删减。

## 编译流程

1. `CodingAgentPromptRuntime` 刷新会话资源和个性化设置，解析当前调用的 Prompt options。
2. `CodingAgentModelCallFrameComposer` 从实际 `RuntimeToolDefinition` 获取工具名称、描述和顺序。
3. `buildSystemPromptDraft` 构造稳定的 core block 图；自定义系统提示词只替换 `core.base` 内容。
4. 静态 Plugin、动态 Provider 和 Feature 依次贡献结构化 block。
5. `compileSystemPromptDraft` 验证不变量、排序、渲染，并计算逐 block 诊断。

默认和自定义提示词必须使用同一条编译路径。不要为新场景增加另一套字符串拼接分支。

## Block 协议

- Core block ID 使用 `core.*`，并在所有编译路径中保持稳定。
- 所有启用或禁用的 block ID 都必须唯一；优先级必须是有限数值。
- Plugin `addBlock` 不能使用保留的 `core.*` ID，也不能添加重复 ID。
- Plugin 可以显式替换已有 core block，但不能隐式创建不存在的 core block。
- `updateBlock` 不能修改 block ID 或来源；来源始终由编译器记录。
- 排序规则固定为 `priority`，相同优先级再按 `id` 排序。

新增 core block 时应同时添加不变量测试，并评估现有 Plugin 是否通过 ID 定位该 block。

## 工具元数据

真实模型调用以 `RuntimeToolDefinition.description` 为权威来源。`product-prompt.ts` 中的内置描述只服务于直接调用公共 SDK 的兼容兜底。新增工具相关规则应优先按当前 active tools 条件注入；既有 Mode 中涉及工具的交互契约保持兼容，后续迁移需要配套行为测试。

## 动态资源

每次模型调用前会刷新两类资源：

- Skills/Scenes：通过资源路径指纹检测变化。
- Prompt context：按路径和实际内容检测 `AGENTS.md`、`CLAUDE.md`、`SYSTEM.md`、`APPEND_SYSTEM.md` 的新增、修改和删除。

当前调用使用刷新后的同一份同步快照；已经进入执行的调用不会被中途改写。

## 预算与诊断

`compileSystemPromptDraft` 返回总字符数、估算 token、启用 block 数和逐 block 成本。估算沿用项目的 `chars / 4` 策略。`promptBudgetTokens` 是告警阈值，不会自动截断内容；宿主可通过 `onPromptDiagnostics` 上报或展示溢出。

禁止按字符尾部直接裁剪系统提示词，这会破坏 block 优先级并可能丢失安全规则。需要缩减时，应根据逐 block 诊断调整所属层级或资源内容。

## 摘要与记忆边界

压缩摘要、分支摘要和长期记忆抽取把历史消息序列化为 JSON 数据。系统提示明确禁止执行其中的指令；摘要重新进入上下文时也标记为历史记录。不要恢复可由正文闭合的手写 XML 包裹。

## 修改流程

1. 修改 `src/profiles/modes/*.md` 或 `src/profiles/personas/*.md` 后运行对应生成脚本。
2. 运行 `bun run check:generated-prompts`，确认 Markdown 与生成数据一致。
3. 运行提示词策略、不变量、摘要边界和模型调用运行时测试。
4. 行为变更完成后运行根目录 `bun run check:quick`、相关测试和 `bun run check`。

根质量守卫会执行两类生成数据的 `--check`。模式策略回归位于 `test/system-prompt-policy.test.ts`，结构不变量位于 `test/system-prompt-document.test.ts`，摘要信任边界位于 `test/summary-prompt-boundary.test.ts`。
