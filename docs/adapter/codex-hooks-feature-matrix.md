# Codex Hook 功能对照

## 1. 兼容基线

- Codex 源码：`C:\github\codex`
- 目标提交：`fca51f6dafb106177f23084d16f076ff2f66dd91`
- 唯一 profile：`codex-hooks/fca51f6`
- Vetta 兼容包：`packages/ecosystem-adapter`
- Coding Agent 宿主桥接：`packages/coding-agent/src/core/hooks`

只兼容上述最新版协议，不保留旧版 Codex Hook profile、codec、parser 或运行时选择分支。

## 2. 状态定义

| 状态 | 含义 |
| --- | --- |
| 可用 | 协议语义与 Coding Agent 真实生命周期均已接入 |
| 协议可用 | wire、matcher、输出聚合与通用运行时 API 已完成，但 Coding Agent 暂无对应真实宿主边界 |
| 部分兼容 | 主流程可运行，但存在明确且未伪造的工具输入或宿主能力差异 |
| 未实现 | 当前没有实现，不能宣称兼容 |

## 3. Hook 事件对照

| Codex 事件 | matcher 输入 | 协议能力 | Coding Agent 触发点 | 状态 |
| --- | --- | --- | --- | --- |
| `SessionStart` | `startup/resume/clear/compact` | `continue:false`、additional context | 新会话、恢复、清理、压缩后的下一轮 | 可用 |
| `UserPromptSubmit` | 忽略 matcher | block、stop、additional context | 用户消息写入会话前 | 可用 |
| `PreToolUse` | canonical name 与 aliases | deny、additional context、`updatedInput` | 所有实际激活工具执行前 | 可用 |
| `PermissionRequest` | canonical name 与 aliases | allow/deny、deny 优先聚合 | 沙箱权限 UI 弹出前（`confirmSandboxPermission`） | 可用 |
| `PostToolUse` | canonical name 与 aliases | block、feedback、additional context | 工具成功执行后 | 可用 |
| `PreCompact` | `manual/auto` | `continue:false` | 手动或自动压缩真正开始前 | 可用 |
| `PostCompact` | `manual/auto` | `continue:false` | 摘要、session 与 agent messages 更新后 | 可用 |
| `SubagentStart` | agent type | stop、additional context | `SubagentCoordinator` 子会话创建后、首轮 prompt 前 | 可用 |
| `SubagentStop` | agent type | block 续跑、stop | 子代理自然结束（可续跑）/ interrupt·failed 终态 | 可用 |
| `Stop` | 忽略 matcher | block 续跑、stop、`stop_hook_active` | 根 turn 自然结束点 | 可用 |

说明：协议可用但宿主未触发的事件不会被伪造成其他事件。未来增加统一审批或可见子代理后，只需调用通用 `EcosystemHookRuntime` API，不需要在 Coding Agent 中增加 Codex 专用实现。

## 4. 工具对照

| 工具类别 | 最新 Codex 行为 | Vetta 实现 | 状态 |
| --- | --- | --- | --- |
| Bash/shell | canonical `Bash` | shell descriptor 映射为 `Bash` | 可用 |
| 普通 function tool | 使用真实扁平工具名 | 使用 Vetta 工具真实名称和原始 JSON 参数 | 可用 |
| MCP | `mcp__server__tool` | MCP 创建时保留 server/tool 元数据并稳定编码 | 可用 |
| 其他自定义工具 | 自动进入 Pre/Post | 所有实际激活工具统一经过 wrapper | 可用 |
| `spawn_agent` | canonical `spawn_agent`，alias `Agent` | mapper 已支持 agent descriptor；宿主暂无对应生命周期 | 协议可用 |
| `apply_patch` | canonical `apply_patch`，aliases `Write/Edit` | 真正名为 `apply_patch` 的工具按真实名匹配；Vetta `edit/write` 保留自身 canonical 并提供对应 alias | 部分兼容 |

MCP 不再通过 `mcp_<server>_<tool>` 字符串猜测 server/tool 边界。`ecosystemHook` descriptor 保存原始 MCP 元数据，Codex mapper 只负责生成 Codex canonical name；未来其他生态可以复用同一宿主元数据。

## 5. 配置与执行对照

| 能力 | 最新 Codex | Vetta 实现 | 状态 |
| --- | --- | --- | --- |
| `hooks.json` | 支持 | 解析宿主显式提供的 JSON source | 可用 |
| 配置层累加 | 支持 | 按 `HookConfigLayer` 与 source 顺序累加 | 可用 |
| matcher | 精确候选或正则 | 同规则；`UserPromptSubmit/Stop` 忽略 matcher | 可用 |
| 同事件多 handler | 并发 | 并发执行，结果保持声明顺序 | 可用 |
| 完成顺序 | 决定最后一个 `updatedInput` | 记录真实完成顺序并选择最后有效输入 | 可用 |
| `commandWindows` | Windows 覆盖命令 | Windows 优先选择覆盖命令 | 可用 |
| timeout | 默认 600 秒，最小 1 秒 | 相同 | 可用 |
| 同步 command | 执行 | shell + stdin JSON + 独立 stdout/stderr | 可用 |
| prompt handler | 当前跳过并 warning | 诊断并跳过 | 可用 |
| agent handler | 当前跳过并 warning | 诊断并跳过 | 可用 |
| async handler | 当前跳过并 warning | 诊断并跳过 | 可用 |
| handler env | 插件 source 可注入 | 显式 source env 与进程环境合并 | 可用 |
| 进程取消 | 终止运行 | 取消、超时及输出超限时回收进程树 | 可用 |
| TOML `[hooks]` | 可作为配置入口 | 当前只解析 JSON source | 未实现 |
| 大输出 spill-to-file | 支持 | 当前采用 4 MiB 输出上限 | 未实现 |

## 6. 输入输出语义对照

| 能力 | Vetta 行为 | 状态 |
| --- | --- | --- |
| 事件级 stdin | 10 个事件分别编码，只发送适用字段 | 可用 |
| 严格 stdout | 按事件拒绝未知字段、错误类型和错误 specific output | 可用 |
| 退出码 0 | 按事件解释 JSON 或允许的纯文本 | 可用 |
| 退出码 2 | 按事件映射为阻止、拒绝或续跑 | 可用 |
| 其他非零/超时 | 记录失败并按事件 fail-open | 可用 |
| Pre 输入改写 | 改写后的参数成为唯一真实执行参数 | 可用 |
| additional context | 独立隐藏 custom context，不拼入工具结果 | 可用 |
| Post feedback | 替换模型可见 content，不冒充 additional context | 可用 |
| Post block | 不回滚工具副作用，但拒绝模型看到原始结果 | 可用 |
| Permission 聚合 | deny 优先于 allow；无决策时回到宿主流程 | 协议可用 |
| Stop 递归保护 | `stop_hook_active` + 最多 8 次续跑 | 可用 |

### 6.1 Zod 校验边界

| 数据边界 | 校验方式 | 原因 |
| --- | --- | --- |
| `hooks.json` 根对象、matcher group、handler | Zod schemas 分层 `safeParse` | 保留局部失败诊断，不因单个坏 handler 丢弃整个文件 |
| command handler 字段 | Zod 类型、有限数值、非空命令约束 | 集中处理 `commandWindows`、timeout、async 和 status message |
| 10 个事件的 Hook stdout | 逐事件 Zod `strictObject` | 拒绝未知字段、错误事件名和不适用字段 |
| JSON 文本解析 | `JSON.parse` + Zod | JSON 语法错误和结构错误分别位于清晰边界 |
| 内部 Hook event/effect | TypeScript 判别联合 | 数据由应用内部创建，无需重复运行时 schema 校验 |
| 工具 descriptor 与 outcome 聚合 | 普通类型分支 | 属于领域语义，不是外部数据反序列化 |

Zod 只负责“输入形状是否合法”，不负责 block、stop、fail-open、deny 优先或最后完成输入胜出等业务语义。配置发现、事件解释和 effect 聚合仍保持单一职责。

## 7. 文件发现边界

默认 Coding Agent 经 `buildDefaultHookConfigLayers` 仅提供 Vetta 嵌套路径（source 带 `profileId`）：

1. `~/.vetta/.codex/hooks.json`（用户，`VETTA_HOME` 可覆盖 vetta 根）；
2. `<cwd>/.vetta/.codex/hooks.json`（项目）。

不读顶层 `~/.codex` / 项目根 `.codex`。兼容层不扫描 Codex 源码树或 marketplace；只解析宿主传入层。缺失文件 ENOENT 跳过。

插件加载器可以通过 `HookConfigLayer.sources` 显式提供应用已安装范围内的 Hook 文件和环境变量。

## 8. oh-story 样本对照

样本基线：`C:\github\oh-story-claudecode` 提交 `12a9655a21abacfbd1c01eb41b98f2af007ab5be`。

| oh-story 能力 | 当前结果 | 状态 |
| --- | --- | --- |
| SessionStart 四种 source | matcher 与 wire 均兼容 | 可用 |
| `Bash\|apply_patch\|Edit\|Write` matcher | Bash canonical 匹配；Vetta edit/write 通过 aliases 匹配 | 可用 |
| 正文写前 deny | 在工具实际执行前阻止 | 可用 |
| commit advisory additionalContext | 作为隐藏上下文进入会话 | 可用 |
| Pre/PostCompact | 手动和自动压缩都会触发 | 可用 |
| Stop 扫描 | 根 turn 自然结束点执行 | 可用 |
| `commandWindows` | Windows 使用覆盖命令 | 可用 |
| 样本 `.codex/hooks.json` 自动发现 | 需放到 `.vetta/.codex/hooks.json`（默认不读顶层 `.codex`） | 可用 |

集成方必须把 Hook 配置作为 Vetta 应用或插件的显式 source 提供，并保证配置引用的 Python 脚本路径与实际部署位置一致。兼容层不会自动改写脚本路径。

## 9. 剩余缺口

1. Coding Agent 统一工具审批入口，供 PermissionRequest 真实触发。
2. 可见子代理生命周期与父子 transcript，供 SubagentStart/SubagentStop 真实触发。
3. Vetta 插件 manifest 到 `HookConfigLayer.sources` 的自动桥接及路径越界校验。
4. enabled/trusted/modified hash 状态与用户信任 UI。
5. 成功 Hook 的 `statusMessage/systemMessage` 到 Coding Agent UI 的投影。
6. TOML Hook decoder。
7. 大输出 spill-to-file。
8. Vetta edit/write 与 Codex apply_patch 的等价输入转换。

## 10. 验证

- 根目录 `bun run check` 通过。
- Biome、monorepo `tsgo --noEmit`、desktop `tsc --noEmit` 通过。
- 按仓库规则未运行 `bun test`。
