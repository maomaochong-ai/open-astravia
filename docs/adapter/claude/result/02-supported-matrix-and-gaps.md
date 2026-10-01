# 支持矩阵与已知缺口

## 1. Astravia 宿主事件 ↔ Claude profile

| 事件 | 宿主是否触发 | Claude profile | 首期语义 |
| --- | --- | --- | --- |
| `SessionStart` | 是 | 支持 | plain stdout / JSON context；exit≠0 记 Failed，**不阻断会话** |
| `UserPromptSubmit` | 是 | 支持 | context；`decision:block` / exit 2 阻断提示词 |
| `PreToolUse` | 是 | 支持 | matcher；exit 2 / `permissionDecision:deny` 阻断；`allow`+`updatedInput` 改写 |
| `PostToolUse` | 是 | 支持 | feedback / block（不可撤销已执行副作用） |
| `PermissionRequest` | 边界存在 | 支持 schema | 依赖宿主是否真正发审批事件 |
| `PreCompact` / `PostCompact` | 是 | 支持 | PreCompact 可 block |
| `SubagentStart` / `SubagentStop` | 部分 | 支持 schema | 宿主子代理生命周期是否完整发出由 coding-agent 决定 |
| `Stop` | 是 | 支持 | block + continuation + `stop_hook_active` |
| 官方其他 ~20 个事件 | 否 | 配置诊断 `unsupported_event` | 不静默忽略 |

## 2. Handler 类型

| type | 状态 |
| --- | --- |
| `command`（sync） | 支持 |
| `command` + `async` / `asyncRewake` | 诊断 `unsupported_handler_mode` |
| `http` / `mcp_tool` / `prompt` / `agent` | 诊断 `unsupported_handler_type` |
| handler `if` 权限过滤 | 诊断；handler 仍加载（fail-open 倾向） |

## 3. 配置与路径

| 能力 | 状态 |
| --- | --- |
| 官方 `~/.claude/settings.json` / 项目 `.claude/settings.json` / `settings.local.json` | 支持（`"hooks"` 键；经 `buildDefaultHookConfigLayers`） |
| plugin `hooks/hooks.json` 原样解析 | 支持（需显式 source） |
| `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_DATA}` | 支持受控展开 |
| CRLF / LF | 读取时规范化 |
| 与 Codex `.codex` / `hooks.json` 路径隔离 | 支持（`profileId` + ownership filter） |
| Astravia `.astravia` / `agentDir` hook 路径 | **已移除**（仅官方布局） |
| 自动扫描 marketplace / 任意插件目录 | **不做**（宿主显式传入） |
| 插件信任 UI / hash 重授权 | **未做**（后续 desktop 插件加载器） |

## 4. Windows 脚本运行

| 场景 | 行为 |
| --- | --- |
| `node xxx.cjs` / 非 shell 命令 | 走默认 shell（Windows 为 cmd） |
| `*.sh` / `bash ...` | 优先 Git Bash / `ASTRAVIA_BASH`；找不到则 **spawn_failed** 明确提示，**不回退 cmd** |
| 本机实测 | 无 Git Bash；WSL `system32\bash.exe` 被刻意跳过 |
| 上游 council/cdt `.sh` | **可加载**，**默认无法在本机原样执行** |

## 5. 与 `cc-skills` 的关系

| 插件 | Hook 层结论 |
| --- | --- |
| `council` | SessionStart preflight 协议可适配；需 Bash/`command -v` 才能跑原始脚本。可用 Node fixture 等价验证 context 注入 |
| `cdt` | UserPromptSubmit block、PreToolUse(Team\*)、Stop 协议可适配。**Teams 工具宿主缺失** → TeamCreate 等 matcher 不会在 Astravia 中触发；`/cdt` block 可用 fixture 验证。Stop wave-gate / session-title 依赖 Teams 状态与 Claude transcript，功能不完整 |
| 其他 8 个插件 | 无 `hooks/hooks.json`；不在本轮 Hook 范围 |

## 6. 明确不做（本轮）

1. Agent / Task / Agent Teams 运行时
2. Claude marketplace / plugin importer 安装 UI
3. Skill `$ARGUMENTS` / `context:fork` / custom agents
4. 把 Claude profile 字段塞进 Codex profile
5. 自动翻译 Bash → PowerShell
6. 扫描 Claude marketplace 插件目录并静默安装/执行（官方 settings 路径已按文档加载）

## 7. 后续建议优先级

1. Windows 托管 Bash + `jq`（或安装时 capability 标记）
2. 插件加载器把 `hooks/hooks.json` 作为 `HookConfigSource` 注入 + 信任确认
3. Stop/PostToolUse 成功消息投影到活动面板
4. PreToolUse `ask` / `defer`（需宿主审批 UI）
5. 其余官方事件按需加 capability flag
