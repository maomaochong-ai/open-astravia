# 插件贡献按 input-action 模式硬隔离（通用，对齐 knowledgeMode）

`registerInputAction` 现状只做 soft 的 `decoratePrompt` metadata（如 imageMode），工具/skill 仍常驻；「知识检索」则是宿主特例：无 `knowledgeMode` 时剥离 kb 工具。插件工作台需要同类**完全隔离**（关 toggle 时本插件 tools / skills / MCP / systemPrompt / Activity Tab 均不可用），且用户自建插件默认不要这种闸。

决定做成**通用平台能力**：插件可声明「贡献受某 input-action 模式门控」；toggle 默认关，仅当本轮/会话带上对应 mode metadata 时才放行**该 pluginId** 的 agent 贡献与约定 UI。工作台作为第一个接入方；用户经工作台创建的插件默认不声明门控，除非用户明确要求。

## Considered options

- **仅 workbench hardcode `pluginWorkbenchMode`**：快，但每增一个模式插件再堆特例，否。
- **Toggle 仅 soft 引导**：改动小，无法「完全隔离」，否。
- **闸 skill 注入但不做通用机制**：与「用户插件可选门控」冲突，否。

## Consequences

- input-pipeline / agent 资源图需按 pluginId 过滤贡献；Activity Tab 与 input-action 的显隐规则要与 mode 对齐。
- 与 ADR-0023 可信插件模型兼容：隔离的是**贡献可见性**，不是进程沙箱。

> **与 ADR-0046 修订的关系（2026-08）**：ADR-0046 于 2026-08 修订，删除了工作模式（`agent_mode`）
> 的全部硬闸——插件不再因 Work/Coding 模式被隐藏或不加载。本 ADR 的
> `contributionMode.hardIsolation` **不受影响，继续有效**：它门控的是 `registerInputAction` 的
> per-turn / per-session input-action 模式（用户在输入区显式打开的开关，默认关），与 Work/Coding
> 工作模式是两条互不相干的机制。两者曾经都表现为「插件贡献被整体排除」，但只有前者是用户此刻
> 显式表达的意图，因此保留硬隔离语义；后者是全局偏好，不再具备排除能力。
