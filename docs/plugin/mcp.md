# 插件内聚 MCP 与三源聚合

插件可通过清单声明 **自带 MCP server**，随插件启用进入 agent 工具面，禁用/卸载即拆除。这是会话 MCP 的**第三配置源**，与用户全局 / 项目 MCP **聚合**后一起暴露给模型。

详见 ADR-0040。

## 三源聚合（必读）

每个 agent 会话的 MCP 工具来自 **三源合并**（`McpManager`）：

| 源 | 配置位置 | 谁拥有 |
| --- | --- | --- |
| **全局** | 用户 `~/.vetta/agent/mcp.json` | 用户设置页可编辑 |
| **项目** | 项目侧 MCP 配置（若有） | 项目 |
| **插件** | `plugin.json` → `agent.mcpServers` | 插件包；**不写**用户 mcp.json |

```text
                    ┌─ global mcp.json
  McpManager  ←────┼─ project mcp
                    └─ plugin contributions  (mcpServerContributions)
                              │
                              ▼
                    统一 tool 面：mcp_<server>_<tool>
```

要点：

1. **并列聚合，不是覆盖**：三源 server 同时可运行；靠**运行时名**避免撞车。
2. **插件源不回写用户文件**：卸载/禁用插件只影响插件贡献，不会在用户 mcp.json 里留垃圾。
3. **物化路径**：主进程 `buildAgentPluginRuntimeConfig()` → `mcpServerContributions` → 会话 `setPluginServers`；启停插件走 `reconfigureAgentPlugins` 联动 reconcile。
4. **组合签名含 plugin fingerprint**：避免「只 reload 用户文件」时把插件 server 冲掉。
5. **硬隔离**（若插件声明 `contributionMode.hardIsolation` / input-action `hardIsolation`）：mode 关时该插件的 MCP 贡献一并剥离，与 skills/tools 一致（ADR-0041）。

设置页的 MCP JSON 编辑器**只读写用户文件**，**不会**列出或编辑插件内聚 server。

## 清单

权限：`agent.mcp.control`。

```json
{
  "permissions": ["agent.mcp.control"],
  "agent": {
    "mcpServers": "./.mcp.json"
  }
}
```

或内联：

```json
"agent": {
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["./scripts/start-mcp.mjs"],
      "cwd": "."
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

`.mcp.json` 形状与用户 MCP 相同：

```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["./mcp/server.mjs"],
      "cwd": "."
    }
  }
}
```

相对路径（`command` / `args` / `cwd`）相对**插件安装根**（`InstalledPlugin.rootPath`）解析；裸命令名（如 `node`）走 PATH（含托管运行时注入的 PATH）。

可选字段与用户 MCP 一致：`disabled`、`autoApprove`、`env`、`headers`、`displayName`、`description`、OAuth 相关等。

## 工作模式（agent_mode）

**内联 map** 的每个 server 可加 `agent_mode` 声明它主推的工作模式（Work/Coding，ADR-0046），缺省/空 = 通用：

```json
"agent": {
  "mcpServers": {
    "canvas": { "command": "node", "args": ["./mcp/server.mjs"], "agent_mode": ["coding"] }
  }
}
```

- **不是闸**（ADR-0046 于 2026-08 修订）：非主推模式下该 server 的工具**仍然进入会话、仍然可调用**，只是在工具清单里被排到末尾。真正决定工具是否进入会话的仍是可见性开关与 `scope_use` / `requires`。
- 与插件级 [manifest `agent_mode`](./manifest.md#agent_mode工作模式偏好) 各自独立，不再取交集。
- `.mcp.json` **路径形式**为保持社区标准不扩展该字段，其下的 server 只**继承插件级** `agent_mode`。要按 server 分别声明偏好请用内联 map。

## 权限与生命周期

| 条件 | 行为 |
|------|------|
| 插件启用 + 已授 `agent.mcp.control` +（若硬隔离则 mode 开） | 贡献进入 `mcpServerContributions`，进程启动，工具进 agent |
| 未授权 / 禁用 / 硬隔离 mode 关 | 不贡献；已运行的 server 被 reconcile 关掉 |
| 系统插件 | 声明的权限自动全授（含本权限） |
| 启动失败 | 宿主会打错误日志（避免「无 tools」静默）；排查 command/路径/依赖 |

## 运行时命名

- 本地 key（如 `canvas` / `cowart_mcp`）→ 全局名 **`plugin-<pluginId>-<normalizedLocal>`**
- `_` 与非法字符规范为 **kebab-case**（如 `cowart_mcp` → `cowart-mcp`）；**禁止**在最终 runtimeName 中保留 `_`（兼容 `mcp_${server}_${tool}` 解析）
- Agent 可见工具名形如：`mcp_plugin-<id>-<local>_<toolName>`

命名后与全局/项目 server 并列，不因 local key 撞名而互相覆盖。

## 打包

`vettaPluginFederation` 打包时，若声明了 `agent.mcpServers`：

- 字符串路径：打入该 `.mcp.json`
- 约定目录 **`mcp/`** 一并打入

另外，构建工具也会把 **`scripts/`** 打进 zip（工作台脚本等同理），便于 `args: ["./scripts/start-mcp.mjs"]`。

`node_modules` 默认不进 zip；由预构建 bundle 或文档说明运行时安装。

## 与 registerTool

| | 插件 MCP（聚合第三源） | `ctx.agent.registerTool` |
|--|------------------------|---------------------------|
| 进程 | 独立 stdio / http | renderer handler |
| 适用 | 现成 MCP server、重逻辑、跨语言 | 轻逻辑、强绑 UI / 宿主状态 |
| 权限 | `agent.mcp.control` | `agent.tools.register` + `execute` |
| UI | 默认可走宿主工具渲染；可用 [registerToolCallSlot](./ui-slots.md#工具行内渲染-registertoolcallslot) 换皮 | 可返回 `cards` 进 [消息卡片](./message-cards.md) |

同一插件可同时使用两者。

## 非目标（当前）

- MCP Apps / `ui://widget` 宿主
- 设置页展示/编辑插件 MCP
- 安装插件时自动 `npm install` MCP 依赖
- per-server 用户开关 UI（清单 `disabled` 仍生效）

## 参考实现

- `packages/plugins/externals/cowart-vetta`：活动面板 + 插件内聚 MCP（画布工具）
