# 实施路线与验收标准

## 1. 完成定义

“适配 `cc-skills`”必须按插件能力验收，不能以“26 个 SKILL.md 能显示”为完成。

完整目标：

1. 10 个插件可从固定 marketplace snapshot 导入、独立启停和升级。
2. inventory 精确识别 26 Skills、7 commands、20 agents、2 Hook sources、15 scripts。
3. Claude Skill 调用、参数、fork 和工具权限语义可验证。
4. `council` / `ci-review` 的 custom agents 真实运行在独立 child session。
5. `cdt` 的 task graph、peer messaging 和 wave gate 真实工作。
6. Hook 的输入、输出、matcher、exit code、Stop continuation 与 Claude fixture 一致。
7. Windows 不会把 `.sh` 交给 `cmd.exe` 后静默失败。
8. 未支持的官方组件和上游漂移均有明确 diagnostic。

## 2. 里程碑

### M0：固定契约与 fixtures

目标：先建立不会随 README 漂移的事实基线。

工作项：

1. vendor 或测试时复制 `cc-skills@f5359d9` 的最小 fixture。
2. 为 marketplace、可选 plugin manifest、Skills、commands、agents、hooks 建 schema tests。
3. inventory 测试断言精确数量和路径。
4. 记录上游不一致：缺失 `.mcp.json`、未接线 validator、未声明逻辑依赖。
5. 加入 CRLF/LF frontmatter fixture，确保不会复现上游 validator 在 Windows 的 26 个误报。
6. 选定并记录 Claude Code Hook 契约版本；禁止 `latest` profile。

验收：fixture 更新导致数量、权限或 Hook 面变化时测试失败，并生成可读差异。

### M1：Marketplace 与 resource-only import

目标：10 个插件能作为资源包安装，不要求前端空壳。

工作项：

1. 实现 Claude marketplace/plugin parser 和 path confinement。
2. 构建中立 resource graph。
3. 支持默认组件目录与可选 manifest component paths。
4. 安装时展示 inventory、来源 commit、版本和 unsupported diagnostics。
5. 将启用的 Skill paths 传给 coding-agent。
6. 定义插件短名和 scoped name 的碰撞规则。

验收：逐个启用/禁用插件只改变该插件贡献；卸载后不留下 Skill、agent 或 Hook source。

### M2：Skills 与 legacy commands

目标：skills-only 插件和所有 7 个 command 可按 Claude 调用习惯运行。

工作项：

1. `commands/*.md` 转换为 synthetic Skill contribution。
2. 支持 `/name`、scoped alias 和现有 `/skill:name`。
3. 实现 `$ARGUMENTS` 一次替换和无占位符时的 append 规则。
4. 保留 `user-invocable`、`disable-model-invocation`、`argument-hint`。
5. 增加 `Skill` tool facade。
6. 实现 scoped `allowed-tools` 预授权，不把它误作永久 allowlist。
7. 实现或明确关闭 dynamic context execution。

验收：

- 26 个 Skill 的可见性与 frontmatter 一致；
- 7 个 command 都能从 slash 输入调用；
- 带空格、引号、换行和非 ASCII 的 arguments 只替换一次；
- background-only Skill 不出现在用户菜单；
- alias 冲突返回候选，不按加载顺序猜测。

### M3：Custom agent

目标：20 个 `agents/*.md` 能编译为真实 Astravia child type。

工作项：

1. 解析 agent frontmatter 与 body。
2. 扩展 `SubagentTypeDefinition` 的 model、maxTurns、skills、memory、background、isolation、精确 tool policy。
3. 按 plugin scoped id 注册到 session registry。
4. 增加 `Agent` 与旧 `Task` facade，归一到现有 coordinator。
5. 映射 Claude 工具名和 MCP 引用。
6. 接入 agent 级模型 resolver、turn budget 和 usage。
7. 在 coordinator 中触发真实 `SubagentStart` / `SubagentStop` Hook。

验收：

- registry 精确出现 20 个外部 agent，来源和文件可追踪；
- `ci-review --single/--lean/--full` 启动正确 agent 集；
- `council` 可并行运行外部 consultant 与内部 Claude-style reviewers；
- agent 的 Write/Edit 禁用由工具层强制；
- `maxTurns` 到达后确定性停止；
- 父会话取消会取消所有相关 child；
- 模型不可用时行为符合显式 fallback 策略。

### M4：Claude command Hook 子集

目标：原样运行本基线两份 `hooks.json` 的有效部分。

工作项：

1. 新增版本化 Claude Hook profile。
2. 支持 plugin Hook discovery、command/sync、matcher 和 timeout。
3. 支持 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`Stop`。
4. 注入 plugin root/data/project dir，记录插件来源。
5. 实现 Claude input/output/exit code 语义。
6. 未支持 event/handler 产生 diagnostic。
7. 增加 Hook trust、hash 变化重新授权和活动详情。
8. Windows 提供托管 Bash + `jq`，或在启用前阻止不兼容 handler。

验收：

- `council` SessionStart 能报告缺失 CLI，且不是 fatal；
- 未启用 Teams 时 `/cdt...` 的 UserPromptSubmit 被阻止并显示原因；
- `PreToolUse(TeamCreate)` 的多个 handler 按配置执行并汇总；
- `Stop` block 只触发受限 continuation，不形成无限循环；
- `${CLAUDE_PLUGIN_ROOT}` 对含空格和中文的路径正确；
- timeout、output limit、取消会杀完整进程树并留下 run summary。

### M5：Agent Teams

目标：`cdt` 五种模式不改上游 command 即可运行。

工作项：

1. TeamCoordinator 和持久化 snapshot。
2. shared task graph、owner、blockedBy、状态转换。
3. lead/teammate/sibling mailbox。
4. `TeamCreate` / `TeamDelete` / `Teammate` / Task 工具 facade。
5. teammate idle、shutdown、取消、恢复和异常回收。
6. wave-gate handoff 与 Hook 生命周期。
7. UI 展示团队、任务、消息、usage 和错误。

验收：

- `plan`：Architect 与 PM 可直接交换消息并产出 plan；
- `dev`：Developer、Code-Tester、QA-Tester、Reviewer 按 task dependency 接力；
- `full`：计划审批 gate 后再开发；
- `auto`：无人工 gate 但仍遵守 task/wave 状态；
- `bugfix`：RED → GREEN → REFACTOR → review；
- 无 owner 且未阻塞的 task 会被 wave-gate 检测；
- TeamDelete 后没有活跃 child、mailbox 或锁；
- 不同 root session 的 team 状态完全隔离。

### M6：官方扩展面

在 `cc-skills` 精确兼容之后按实际需求增加：

- 其余 Claude Hook 事件；
- async、HTTP、MCP tool、prompt、agent Hook handler；
- plugin MCP；
- worktree agent；
- LSP、monitors、output styles、themes、channels、userConfig。

每一项都应有独立 capability flag 和版本化 fixture，不作为 M1-M5 的隐式要求。

## 3. 插件级验收

| 插件 | 最小验收 |
| --- | --- |
| `temporal` | `/temporal` 能读取 references 并生成与项目语言匹配的建议 |
| `doppler` | 命令执行前保留审批，secret 不进入日志 |
| `oasis-dev` | references 相对路径和 Web 工具可用 |
| `pm` | `brainstorm`、create、next、update、review 五个入口可解析；GitHub 写操作需确认 |
| `plugin-dev` | 两个 command 可调用；生成结果通过 Claude plugin validator fixture |
| `dlc` | 10 个 Skill 都可寻址；Cron/Push 缺失时明确 capability error |
| `jules-review` | `context: fork` 生效；缺 `council` 时在启动前报告依赖 |
| `council` | 8 个 agent 可寻址；可用外部 CLI 部分成功；Hook preflight 可见 |
| `ci-review` | 11 个 agent 可寻址；不同 profile 的 agent 数量和 scorer 流程正确；只发一个 PR review |
| `cdt` | 5 个 command、shared tasks、peer messaging、四阶段/五模式状态机和 Hook guard 全部通过 |

## 4. 契约测试建议

### 4.1 Parser

- manifest 缺失时走默认目录；
- manifest component path 覆盖/追加规则；
- symlink/path traversal；
- YAML block scalar、数组/字符串 tool list；
- duplicate name/scoped collision；
- unsupported field/handler/event diagnostics。

### 4.2 Skill runner

- `$ARGUMENTS`、无占位符 append、多 Skill stack 的目标版本行为；
- user/model invocation policy；
- fork 与 inline 的上下文隔离；
- allowed-tools 生命周期；
- dynamic context 禁用策略和命令注入边界。

### 4.3 Agent runtime

- tool allow/deny precedence；
- MCP inherit 与 agent-local server；
- model resolver 与 unavailable fallback；
- maxTurns、abort、resume、follow-up；
- transcript/usage/notification 单次交付；
- plugin disable 时不再允许新 spawn。

### 4.4 Hooks

- 每个事件的 stdin golden fixture；
- stdout JSON、plain text、empty、invalid JSON；
- exit 0/2/其它；
- matcher exact/pipe/regex；
- handler 并发与结果顺序；
- Stop active flag 与 continuation cap；
- Windows/Unix 路径变量和 shell 选择。

### 4.5 Teams

- task DAG 与循环依赖；
- owner claim race；
- sibling message 顺序和单次交付；
- teammate failure/idle/shutdown；
- lead crash 后恢复；
- team 隔离和清理。

## 5. 实施顺序的硬约束

1. M0 必须先于代码兼容，否则实现会追逐 README。
2. M1/M2 完成前不要开始逐插件业务 patch。
3. M3 复用现有 coordinator；禁止另建 Claude-only child runtime。
4. M4 新建 Claude profile；禁止污染 Codex profile。
5. M5 完成前 `cdt` 状态只能是 unsupported/partial，不能标记兼容。
6. 每个阶段跑 root `bun run check`；测试只按仓库规则运行具体文件，不跑 `bun test`。
7. 文档、fixture 和实现必须记录固定上游 commit 与 Claude Code 契约版本。

## 6. 开始实现前仍需确认的产品决策

1. Claude compatibility bundle 是扩展 Astravia 原生 plugin schema 的 `resource-only` runtime，还是独立安装类型。
2. 首发是否承诺 Windows 上原样运行 Bash Hook；若承诺，需要把 POSIX runtime 纳入安装体积和维护范围。
3. Claude agent 模型别名如何映射到用户配置的 provider/model。
4. Agent memory 和 worktree 是 M3 首发能力，还是明确 diagnostic 后放到 M6。
5. Agent Teams 是否允许模型自主提出并在用户确认后创建，还是只允许用户显式命令创建。
6. 逻辑依赖（例如 `jules-review` → `council`）由 compatibility metadata 补充，还是要求上游修复 marketplace。

默认建议：resource-only Astravia plugin + Windows 托管 POSIX runtime + 用户可配置模型档位 + memory/worktree 后置 + Teams 创建需用户确认 + 依赖先用可审计 metadata 补充并推动上游声明。
