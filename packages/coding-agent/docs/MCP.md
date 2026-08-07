# MCP

连接外部 MCP server，工具自动进入模型 tool list。

## 配置路径

| 范围 | 路径 |
|------|------|
| 全局 | `~/.vetta/agent/mcp.json` |
| 项目 | `<cwd>/.vetta/mcp.json` |

项目覆盖同名全局项。示例：`mcp.example.json`。

## 格式

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": { "API_KEY": "${API_KEY}" },
      "cwd": "${PROJECT_ROOT}",
      "disabled": false,
      "autoApprove": ["read_file"],
      "startupTimeout": 10000,
      "debug": false
    }
  }
}
```

- `env` 支持 `${VAR}`；`cwd` 支持 `${PROJECT_ROOT}`。
- HTTP 远程 server 由运行时支持（含 OAuth 流程时凭证在 `~/.vetta/agent/mcp-auth/`，不写回 `mcp.json`）。
- 插件可贡献第三配置源（不回写用户文件），命名 `plugin-<id>-<local>`。见仓库 ADR-0040。

## 行为

- 工具名形如 `mcp_<server>_<tool>`。
- settings：`enableMcp`（默认 true）、`mcpDebug`。
- 排障：检查 command/env/timeout；`"debug": true`；确认 server 状态为 ready。

协议细节见 [MCP 规范](https://modelcontextprotocol.io)。运行时实现在 `@vetta/runtime-mcp`，本包负责产品侧装配。
