# 插件内聚 MCP：第三配置源，不写用户 mcp.json

插件作为 Agent 能力聚合单元时，需要自带 MCP server（Codex 生态与 Cowart 类插件以 MCP 为主）。决定在 [[可信插件]] 模型下增加 **插件作用域 MCP**，与用户全局 / 项目 `mcp.json` 并列，**不回写** `~/.astravia/agent/mcp.json`。

## 背景

- 既有贡献面：`agent.skillPaths`、`registerTool`、systemPrompt、toolPolicy。
- MCP 仅来自全局 + 项目文件（`McpConfigLoader`），插件无法声明自带 server。
- 若把插件 MCP 写入用户 mcp.json：卸载难、污染用户配置、版本切换脏。

## 决策

1. **清单**：`plugin.json` → `agent.mcpServers` 为相对路径（如 `./.mcp.json`）或内联 map；需权限 `agent.mcp.control`。
2. **运行时名**：`plugin-<pluginId>-<localName>`（kebab-case，**禁止 `_`**，兼容 `mcp_${server}_${tool}` 解析）。
3. **物化**：`buildAgentPluginRuntimeConfig()` 产出 `mcpServerContributions`（路径相对插件根 resolve）。
4. **加载**：`McpManager` 维护内存中的 plugin 源；`initialize` / `reloadIfChanged` / `setPluginServers` 合并三源；组合签名含 plugin fingerprint，避免文件 reload 冲掉插件 server。
5. **生命周期**：插件禁用/卸载 → 贡献集变空 → reconcile 关闭对应进程；启用 + 授权 → 启动。
6. **打包**：声明 mcp 时 zip 纳入配置文件及约定目录 `mcp/`、`scripts/`。

## 非目标（本期）

- MCP Apps / `ui://widget` 宿主
- 插件 MCP 写入用户可编辑 mcp.json
- 自动 `npm install` 依赖策略（后续可加）
- per-server 用户开关 UI（后续可加；清单 `disabled` 仍生效）

## 后果

- 翻译 / 导入 Codex 插件可保留 `.mcp.json` 主路径。
- 设置页 MCP JSON 编辑器仍只读写用户文件；插件 server 不在该文件中。
- 工具名形如 `mcp_plugin-cowart-canvas_...`；localName 中的 `_` 在命名时被规范化为 `-`。
