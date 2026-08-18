# oh-story-claudecode → Vetta 适配评估

## 文档状态

- 评估日期：2026-07-15
- 外部仓库：[`worldwonderer/oh-story-claudecode`](https://github.com/worldwonderer/oh-story-claudecode)
- 评估基线：[`12a9655a21abacfbd1c01eb41b98f2af007ab5be`](https://github.com/worldwonderer/oh-story-claudecode/tree/12a9655a21abacfbd1c01eb41b98f2af007ab5be)
- Vetta 基线：`56f96cb885e06a7fd2dfd56bda5af33bba93e786`
- 评估范围：Vetta desktop、coding-agent、Skill 市场和插件系统
- 本文是兼容性评估与实施依据，不表示已经完成集成。

## 结论

`oh-story-claudecode` 不是单个提示词 Skill，而是一套由 **13 个 Skill、7 个专业 Agent、生命周期 Hooks、浏览器采集脚本和封面生成链路**组成的写作工具集。

Vetta 当前可以运行它的 generic/solo 路径：写作、拆文、导入、去 AI 味和基础审查可以依靠标准 `SKILL.md`、文件工具和 Node/Python 脚本执行。但原样集成无法获得完整体验，主要缺少：

1. 多 Skill 套件级安装和更新。
2. 项目级 custom agent 注册、模型分级和并发调度。
3. `.claude/settings.local.json` / `.codex/hooks.json` 到 Vetta 生命周期事件的适配层。
4. 可复用登录态的 Agent 浏览器控制能力。
5. `story-cover` 到 Vetta 原生图像工具及项目文件落盘的适配。
6. Windows PowerShell 与外部 POSIX Bash 指令之间的兼容处理。

因此推荐先交付「Vetta solo 适配版」，再补齐 Agent、Hooks、浏览器三项宿主能力，升级为完整模式。

## 外部工具集组成

### 13 个 Skill

| Skill | 职责 |
| --- | --- |
| `story-setup` | 部署 skills、agents、hooks、项目规则和上下文模板 |
| `story` | 根据模糊意图路由到具体 Skill |
| `story-long-write` | 长篇大纲、设定、正文和日更 |
| `story-long-analyze` | 长篇拆文与逐章提取 |
| `story-long-scan` | 起点、番茄、晋江等榜单采集 |
| `story-short-write` | 短篇构思、写作和精修 |
| `story-short-analyze` | 短篇结构、反转和情绪拆解 |
| `story-short-scan` | 短篇平台榜单采集 |
| `story-deslop` | 去 AI 味和确定性文本检查 |
| `story-import` | 将已有小说逆向导入标准项目结构 |
| `story-review` | 多视角审查，支持 full/lean/solo |
| `story-cover` | 小说封面生成和平台尺寸导出 |
| `browser-cdp` | 通过 Chrome CDP 复用登录态 |

### 7 个专业 Agent

| Agent | 默认档位 | 职责 | 写权限 |
| --- | --- | --- | --- |
| `story-architect` | 高 | 题材、大纲、钩子、反转、情绪弧线 | 有 |
| `character-designer` | 中 | 角色档案、动机链、关系和对话 | 有 |
| `narrative-writer` | 中 | 正文写作、格式和去 AI 味 | 有 |
| `story-researcher` | 中 | 外部资料研究和结构化落盘 | 有 |
| `chapter-extractor` | 低 | 并行提取章节摘要与情节点 | 只读 |
| `consistency-checker` | 低 | 事实、时间线、伏笔和规则一致性 | 只读 |
| `story-explorer` | 低 | 查询角色、伏笔、设定和进度 | 只读 |

`story-review full` 需要并行运行前四个审查 Agent 中的 `story-architect`、`character-designer`、`narrative-writer`、`consistency-checker`；`lean` 需要前者中的 `story-architect` 与 `consistency-checker`。无法注册或启动 Agent 时，外部 Skill 会自动降级到 solo。

### 生命周期自动化

外部工具集依赖的主要事件：

| 事件 | 行为 |
| --- | --- |
| SessionStart | 发现活跃书目、恢复上下文、检查连续性缺口 |
| SessionEnd / Stop | 记录会话、扫描本回合正文退化和追踪状态 |
| PreToolUse | 写正文前检查细纲；commit 前输出设定警告 |
| PostToolUse | 写后检查截断、复读、工程词泄漏和字数欠账 |
| PreCompact | 保存写作上下文路径、行数和 Git 状态摘要 |
| PostCompact | 注入恢复上下文提示 |

外部 Codex Hook 定义见 [`hooks.json`](https://github.com/worldwonderer/oh-story-claudecode/blob/12a9655a21abacfbd1c01eb41b98f2af007ab5be/skills/story-setup/references/codex/hooks/hooks.json)，实现见 [`story_codex_hook.py`](https://github.com/worldwonderer/oh-story-claudecode/blob/12a9655a21abacfbd1c01eb41b98f2af007ab5be/skills/story-setup/references/codex/hooks/story_codex_hook.py)。

## Vetta 现有能力矩阵

| 能力 | 状态 | 依据与影响 |
| --- | --- | --- |
| 标准 `SKILL.md` 发现 | 已支持 | coding-agent 支持用户、项目、`.agents/skills` 和显式路径，见 [`skills.ts`](../../packages/coding-agent/src/core/skills.ts) |
| Progressive disclosure | 已支持 | 系统提示只注入名称/描述，命中后通过 `invoke_skill` 加载正文 |
| Skill 相对路径解析 | 已支持 | `invoke_skill` 注入 `SKILL_DIR`，要求 scripts/references 使用绝对路径，见 [`invoke-skill`](../../packages/coding-agent/src/core/tools/invoke-skill/index.ts) |
| Read/Write/Edit/Grep/Glob/Shell | 已支持 | 满足主体写作、拆文、导入和追踪文件更新 |
| `ask_user_question` | 已支持 | desktop 有完整问答 UI 与阻塞式返回能力 |
| Node/Python | 已支持 | desktop 托管运行时会注入 PATH，见 [`managed-runtimes.md`](../managed-runtimes.md) |
| 后台 Shell 任务 | 已支持 | 普通会话提供后台任务及查询/停止工具 |
| 原生图像生成/编辑 | 已支持 | RuntimeHost 注入 `generate_image` / `edit_image`，见 [`runtime.ts`](../../apps/desktop/src/main/runtime.ts) |
| MCP | 已支持 | 可用于补充搜索或浏览器服务 |
| Custom agent registry | 未支持 | coding-agent 核心没有内置 sub-agent/custom-agent 注册表 |
| Agent/Task spawn | 未支持 | Skill 不能按 `agent_type` / `subagent_type` 调度隔离会话 |
| Claude/Codex Hook 配置加载 | 未支持 | 不读取 `.claude/settings.local.json` 或 `.codex/hooks.json` |
| 生命周期扩展原语 | 部分支持 | 已有 `session_start`、compact、`tool_call` block、`tool_result`、shutdown 等事件，可用于实现适配器，见 [`extensions/types.ts`](../../packages/coding-agent/src/core/extensions/types.ts) |
| Agent 可控浏览器 | 未支持 | desktop 浏览器面板是展示能力，没有给 Agent 的导航、点击、脚本执行和登录态接口 |
| 多 Skill GUI 整包导入 | 未支持 | 市场和自定义导入都以单个 `SKILL.md` 为安装单元 |

## 具体不兼容点

### 1. 整仓不能作为一个市场 Skill 上传

后端上传只在压缩包根目录或单层顶级目录中寻找一个 `SKILL.md`，见 [`findSkillMd`](../../apps/api/internal/service/skill.go)。外部仓库的文件位于 `skills/{skill-name}/SKILL.md`，因此整仓压缩包不符合市场上传结构。

desktop 自定义导入虽然递归查找 `SKILL.md`，但只选择一个最浅结果，并只复制该 Skill 的父目录，见 [`findShallowestSkillMd`](../../apps/desktop/src/main/ipc/skills.ts)。直接导入整仓最多得到其中一个 Skill，不能得到完整套件。

适配结论：不要把外部仓库当作单个市场 Skill；应包装成 Vetta 插件或 coding-agent package，一次声明整个 `skills/` 目录。

### 2. generic 部署目录不会被 Vetta 自动发现

外部 `story-setup` 的 generic/OpenClaw 路径会把 Skill 复制到项目根 `skills/{skill-name}/`。Vetta 默认发现路径是：

- 全局 `~/.vetta/agent/skills/` / `~/.agents/skills/`
- 项目 `.vetta/skills/` / `.agents/skills/`
- package 或插件声明的 Skill 路径

项目根裸 `skills/` 不是 Vetta 默认发现源。适配时需要选择以下方案之一：

1. 不复制，统一从插件声明的 `agent.skillPaths` 加载。
2. 将 Vetta 部署目标改为 `.vetta/skills/`。
3. 将通用部署目标改为 `.agents/skills/`。

优先推荐方案 1，避免每个写作项目重复复制整套 references。

### 3. 调用语法不同

外部说明使用 `/story-long-write`、`$story-long-write`、`Skill("story-long-write")` 等语法。Vetta 的标准显式调用是：

```text
/skill:story-long-write
```

模型侧调用工具是：

```text
invoke_skill({ name: "story-long-write", args: "..." })
```

自然语言触发可依赖 description 继续工作。适配版应统一修改路由说明和用户文档，不能要求 Vetta 识别 Claude/Codex 专用命令。

### 4. 多 Agent 完整模式不可用

Vetta 的 flowing 是产品级 DAG 工作流，不等同于当前会话内可由 Skill 调用的 `Agent/Task` 工具。外部 Agent TOML/Markdown 文件也不会被 Vetta 自动注册。

直接后果：

- `story-review full/lean` 降级 solo。
- 长篇拆文的 `chapter-extractor` 并行提取降级串行。
- 写作、角色设计、资料研究失去隔离上下文和独立模型路由。
- 无法按低/中/高档模型控制 Agent 成本。

### 5. Hooks 没有执行入口

Vetta 扩展系统已经提供实现所需的大部分原语：

- `session_start`
- `session_before_compact` / `session_compact`
- `tool_call`，可返回 `block` 和 `reason`
- `tool_result`
- `turn_end` / `agent_end` / `session_shutdown`

缺少的是配置和语义适配层，而不是底层事件本身。不能直接执行外部 Hook JSON，应该把写作规则实现成 Vetta Extension：

- 正文写前守卫放到 `tool_call`。
- 写后检查放到 `tool_result` 或 `tool_execution_end`。
- Compact 状态保存/恢复映射到 compact 事件。
- Stop 的正文扫描映射到 `turn_end` 或 `agent_end`，不能错误地映射成整个应用退出。
- commit advisory 对 Shell 命令做结构化检测，不依赖 Claude 的 matcher/if 语法。

### 6. 浏览器能力不完整

外部 `browser-cdp` 依赖：

- Chrome
- Node.js 12+
- 全局 `agent-browser`
- 启动 remote-debugging Chrome
- 必要时关闭用户当前 Chrome，再复制/复用登录态

Vetta 已有 Node，但不托管 `agent-browser`，也没有 Agent 可控的浏览器工具。直接运行该 Skill 还存在关闭用户 Chrome、丢失未保存页面的风险。

完整适配应提供宿主级浏览器工具或插件/MCP，并具备：

1. 独立持久化 partition/profile，不关闭用户常规 Chrome。
2. 打开、等待、快照、点击、输入、执行受控脚本和提取正文。
3. 敏感信息读取和破坏性浏览器操作的明确审批。
4. 每次操作超时、取消和可观察输出。

### 7. 封面生成协议不匹配

外部 `story-cover` 直接调用 OpenAI Images API，并依赖：

- `GPT_IMAGE_API_KEY`
- `curl`、`jq`、`base64`
- ImageMagick 或 macOS `sips`
- 将结果写入 `{BOOK_DIR}/封面/`

Vetta 已有统一图像设置和 `generate_image` / `edit_image`，不应再引入一套环境变量和 API 调用。适配版应优先使用原生工具。

仍需补充的能力：

- 允许将生成结果导出/复制到用户指定项目路径。
- 支持平台目标尺寸的居中裁剪和缩放，例如番茄 `600×800`。
- 保存 prompt、来源图和版本元数据。

### 8. Windows Shell 不兼容

Vetta Windows 默认命令工具运行 PowerShell；外部 Skill 大量使用 POSIX Bash 语法，例如 `set -euo pipefail`、`for ...; do`、`$VAR`、`mktemp`、`command -v`、管道和 `.sh` Hooks。

Node 脚本本身只依赖内置模块，适配成本较低。适配版应：

- 优先用 Node 脚本替代复杂 Shell。
- 字数统计改为直接调用 Vetta 托管 Python，或提供原生字符统计工具。
- Windows 使用 PowerShell 参数数组和文件 API。
- 不要求普通用户安装 Git Bash、jq、ImageMagick 等额外环境。

## 推荐实施方案

### 阶段 A：Solo 适配版

目标：不新增 custom agent 和 hook runtime，先稳定运行主体工作流。

1. 创建 `oh-story-vetta` 插件或 coding-agent package。
2. 使用插件 `agent.skillPaths: ["skills/"]` 一次注册 13 个 Skill；该声明能力见 [`plugin manifest`](../plugin/manifest.md)。
3. 保留上游 Skill 和 references 目录结构，适配改动单独维护，方便后续同步上游。
4. 将所有路由改成 `invoke_skill` / `/skill:name`。
5. 将 `story-setup` 的 Vetta 目标改成插件路径或 `.vetta/skills`，不写裸 `skills/`。
6. 修改 `story-cover`，优先调用 Vetta 原生图像工具。
7. 清理 Windows 不兼容的 Shell 片段，优先复用 Node/Python。
8. 在运行报告中明确输出 `Effective Mode: solo`，不伪装 full/lean。

验收：

- 13 个 Skill 都出现在 Vetta Skill 列表并可显式调用。
- 写作、拆文、导入、去 AI 味、solo 审查至少各跑通一个最小样例。
- Windows 不依赖系统 Node/Python、Git Bash、jq。
- 外部 Skill 目录保持只读，所有产物写入用户项目。

### 阶段 B：Hooks 适配

目标：恢复写作状态与确定性质量守卫。

1. 建立 Vetta story extension，不直接解析执行任意 Claude/Codex Hook shell。
2. 移植正文写前细纲守卫，并允许阻断 Write/Edit/Shell 写入。
3. 移植写后正文轻量检查、字数欠账、追踪状态和标题重复检查。
4. 接入 SessionStart、compact 前后和 turn end。
5. Hook 运行结果进入工具/活动面板，错误不静默吞掉。

验收：

- 缺少细纲时首次创建正文被阻断。
- 已存在正文的正常修改不被误拦截。
- compact 后能够恢复活跃书目和 `追踪/上下文.md`。
- Hook 在 Windows/macOS/Linux 使用同一组语义测试。

### 阶段 C：Custom Agent 与并发调度

目标：恢复 full/lean 审查和并行拆文。

需要新增：

1. 项目级 Agent 定义格式和注册表。
2. `spawn_agent` 类工具，支持 agent 名、prompt、模型、工具白名单和只读/可写权限。
3. 隔离上下文、取消、超时、并发上限和结果聚合。
4. 防止子 Agent 递归 spawn。
5. 低/中/高模型映射和成本提示。

验收：

- `story-review full` 能并行运行四个 reviewer，任一失败时按外部约定整体降级 solo。
- `lean` 只运行两个指定 Agent。
- 只读 Agent 无法写项目文件。
- `chapter-extractor` 可并发处理多个章节，并验证摘要数等于章节数。

### 阶段 D：浏览器与封面完善

目标：恢复扫榜和完整封面交付。

1. 提供 Agent 浏览器工具或内聚 MCP。
2. 复用 Vetta 独立浏览器 partition，避免关闭用户 Chrome。
3. 给浏览器登录态、脚本执行、Token/Cookie 读取设置审批边界。
4. 给原生图像工具增加导出到项目路径和精确裁剪能力。

验收：

- 至少跑通一个长篇榜单和一个短篇榜单采集。
- 浏览器操作可取消、超时后不阻塞会话。
- 封面能生成、迭代并导出番茄 `600×800` 上传版。

## 建议的适配包结构

```text
oh-story-vetta/
├── plugin.json
├── skills/                    # 上游 13 个 Skill，保持目录结构
├── adapter/
│   ├── story-extension.ts     # Hooks 与状态恢复
│   ├── agent-registry.ts      # 完整版阶段再接入
│   ├── browser-tool.ts        # 浏览器能力适配
│   └── image-export.ts        # 原生生图结果导出/裁剪
├── prompts/                   # Vetta 路由与兼容说明
└── upstream.json              # 上游仓库、commit、同步时间和本地 patch 列表
```

不要直接改散落在 13 个 Skill 中的所有平台分支而不留记录。建议通过 `upstream.json` 或补丁目录记录每一处 Vetta 差异，便于上游更新时审计。

## 优先级清单

### P0：使套件可稳定安装和使用

- 多 Skill 打包注册。
- 修正项目 Skill 发现目录。
- Vetta 命令/路由语法。
- Windows Shell 适配。
- `story-cover` 使用原生图像工具。

### P1：恢复核心完整体验

- Custom agent registry 与 spawn。
- Hooks 事件适配和正文写前阻断。
- 浏览器采集能力与用户审批。
- 图像结果项目落盘和平台尺寸导出。

### P2：产品化

- 上游版本检查与可审计更新。
- Agent 模型成本分级 UI。
- Hook/Agent 运行状态和诊断页。
- 跨平台端到端样例与回归测试。

## 不建议的方案

1. **逐个手工上传 13 个市场 Skill**：能工作但丢失套件级版本、更新原子性和统一适配逻辑。
2. **直接信任并执行 `.claude/settings.local.json` / `.codex/hooks.json`**：会引入任意命令执行面，且事件语义并不完全等价。
3. **把 flowing 当作 Skill 子代理替代品**：两者生命周期、上下文和调用入口不同。
4. **要求 Windows 用户安装 Git Bash/jq/ImageMagick**：与 Vetta 托管运行时和普通用户定位冲突。
5. **为了兼容而删除外部 full/lean/guard 功能**：应保留降级语义并逐步补宿主能力，而不是静默弱化。

## 后续决策点

开始实现前需要明确：

1. 首版目标是 solo 可用，还是一次性交付 full/lean 多 Agent。
2. 套件以系统插件、普通插件还是 coding-agent package 发布。
3. Custom Agent 是建设通用宿主能力，还是先做 story 专用实现。
4. 浏览器采用 Vetta 内嵌 partition、外部 Chrome CDP，还是 Playwright MCP。
5. 上游同步策略是 fork、vendor snapshot，还是构建期拉取固定 commit。

默认建议：**系统/普通插件承载 Skill 套件 + 通用 Custom Agent 能力 + Vetta Extension Hooks + 内嵌浏览器 partition**。这样外部写作套件的适配不会变成只服务一个仓库的硬编码分支。
