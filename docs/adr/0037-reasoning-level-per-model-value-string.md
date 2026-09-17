---
status: accepted
---

# 推理档位改为每模型自由列表 + value 字符串，anthropic 推迟

思考强度原本是**全局**的（desktop 设置页一个 SegmentedControl → `setGlobalThinkingLevel` 广播全会话），而不同模型支持的档位并不一样（同一 provider 下 gpt-5.2 支持 xhigh、更早的 GPT-5 不支持），靠 `@vetta/ai` 里 `supportsXhigh()` / `supportsAdaptiveThinking()` 等**硬编码 model-id 匹配**推断可用集。本次把它改为**每模型独立、跟模型配置走**的 [[推理档位（reasoning level）]]。改动横跨 5 个包、含 DB 迁移、并把 `@vetta/ai` 的 `reasoning` 从固定枚举退化为任意字符串，极难回退，故记此 ADR。

## 决定

- **数据模型**：模型配置携带 `reasoningLevels: string[]`（**只存 value 字符串**）+ `defaultReasoningLevel: string`。`reasoning:bool` 降级为**派生值**（`reasoningLevels` 非空即 true），列表为唯一真相源。落到 `ProviderModel` / `ProviderTemplateModel`（Go）、models.json / templates.json、coding-agent model-registry、desktop 本地 models.json。
- **粒度 = 每模型**，不是每 provider、不是全局。同 provider 不同模型档位可不同，这正是废弃硬编码 `supportsXhigh` 的原因。
- **value 恒为单一字符串**（`minimal/low/medium/high/xhigh` 或任意自定义串）。provider 层按模型 `api` 把它塞进对应字段（openai-responses→`reasoning.effort`、openai-completions/qwen→`reasoning_effort`…）。上层（档位配置 / [[ai input]] / coding-agent）永远只见字符串，不感知协议形状差异。否决「带 kind 判别的 effort/budget 双形」与「任意 JSON payload 片段」——前者加配置负担、后者把 provider 协议细节泄露给配置者。
- **分层 fallback**：每 `api` 类型在 `@vetta/ai` 内置一份**预设档位列表**，仅作「新建模型预填 + 空列表 fallback」，**是预设、非约束**。模型可自由改写自己的列表（服务端走 admin，本地离线 [[预设模板]] / 手搓 provider 走 desktop 本地配置）。列表为空时 fallback 到该 api 预设。
- **显示与 i18n**：档位项不存展示文本。desktop 对**已知 value** 映射 i18n key（低/中/高/超高…随语言切换），未知自定义 value 直接展示原文——既支持自定义又不留死文案，符合 ADR-0031 约束。
- **每模型记忆 + 传输**：desktop 本地记 `modelKey→value` 映射（跨会话/重启保留），随 `PromptRequest` 与 `modelKey` **同行**下发、应用于本轮，保证模型与档位同源一致。**移除**全局 `setGlobalThinkingLevel`/`getGlobalThinkingLevel` 及设置页全局 SegmentedControl。
- **无全局 off**：删掉 coding-agent 硬编码的 `"off"` 特例；关不关思考由档位列表自决（想允许就在列表放一项 value=off/none）。非推理模型（空列表）在 [[ai input]] 不显示档位选择器。
- **coding-agent CLI**：`--thinking` / `model:level` 改为对解析出的模型 `reasoningLevels` 校验（不在列表则告警 + 回退默认档）；`getAvailableThinkingLevels` 从模型配置取；删除 in-scope providers 的 `supportsXhigh` / `clampReasoning` / `mapThinkingLevelToEffort` 等夹取逻辑。
- **admin / 本地 / 预设模板** 表单：自由行编辑器（增删/排序 value 行）+ 默认档单选 + 「按 api 载入预设」按钮。预设模板档位随 snapshot-on-key 一并落进本地 models.json。
- **迁移**：现有 `reasoning=true` 的模型按其 `api` 预设种子填充 `reasoningLevels`，`reasoning=false` 留空。

## 范围（本期刻意不做）

仅覆盖 **openai-completions / openai-responses / 衍生 v1 第三方适配器**（qwen / nvidia / zai …）。[[anthropic-messages]] 原生 provider **本期不删、也不专门适配**，留后续阶段单独接入。

## 关键取舍

**保留 anthropic-messages 原生 provider，只是推迟其档位适配——不删。** 曾提议一刀切删掉 anthropic 走 OpenAI 兼容 /v1，核实后否决：Claude（`claude-opus-4-6`）是 coding-agent 的**默认模型**（`model-resolver.ts` defaultModelPerProvider 首位）；`cache_control` 前缀缓存、thinking `signature`（跨轮回放思考态）、adaptive thinking / max effort 均为**原生独有、/v1 无等价物**，删除等于让 Claude 缓存与多轮思考连续性崩坏，且波及 ~15 文件 / 13 测试套件 / Go 网关协议分支。故本次把 anthropic 与推理档位**解耦**：档位新机制先在 v1 系做到位，anthropic 维持原状、后续再单独接。未来读代码者会问「为何 anthropic 不走这套 reasoningLevels」——答案在此。

**`reasoning` 从固定 `ThinkingLevel` 枚举退化为任意字符串、删掉夹取。** 原设计有 canonical union + 每 provider 映射 + `clampReasoning`（xhigh→high 兜底）。既然档位「完全放开、跟模型配置走」，模型只会列出自己真支持的档，客户端无需再猜测/夹取；夹取逻辑（`supportsXhigh` 等）反而成为与「配置即真相」冲突的旧假设，故删除（in-scope providers）。代价：admin/本地配置者需自己保证填的 value 对该模型合法，非法值由首次真实请求暴露。

**档位只存 value、不存 label。** 存 `{label,value}` 显示更自由，但 label 原文在多语言下不随语言切换、且预设 label 会硬编码某语言。选「只存 value + 已知值走 i18n + 未知回退原文」，与 [[icon symbol]]「客户端资源 + 服务端 slug」同思路——展示层归客户端、配置层只存语义值。

## 后续若改变主意

- 接 anthropic 时：其档位 value 仍是字符串，由 anthropic provider 层把字符串映射成 adaptive effort / budget_tokens（复用现有 `defaultBudgets`），上层与本 ADR 不变；
- 若某 provider 的推理参数确实无法用单一字符串表达，再在 provider 层内做 value→结构的私有映射，不上浮到配置模型；
- 若要服务端下发多语言档位展示名，参照 [[预设模板]] 在线合并/离线快照，把 i18n 映射扩为「内置静态 + 服务端合并」两源。

## 2026-09-17 实现核对与修复

Issue #10 暴露出实现与本 ADR 的透传决定不一致：模型配置加载未保留档位元数据，Runtime Session、启动流程及 Azure/Codex simple stream 仍按旧名称白名单夹取 `xhigh`。本次补齐本地、远程、动态注册与覆盖路径，运行时对推理模型保留调用方选定的原始值；API 预设仅用于展示与缺省选项，不作为执行上限。非推理模型仍关闭推理，现有 `off` 到无推理请求的兼容转换保留，原生 token 预算 provider 的转换不变。CLI/SDK/RPC 的档位列表与 Desktop 使用同一模型声明解析器。

`reasoning` 当前仍是显式能力开关（未提供时可从非空档位列表推导），并非所有旧目录都已迁移成纯列表；不能将上文的目标描述误读为既有数据已全部迁移。`supportsXhigh` 仅为旧调用方保留兼容查询，显式列表优先，不再用于上述请求链路的执行降档。
