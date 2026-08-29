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

## ToolResult 内容与图片

Vetta 支持 MCP ToolResult 中的 `text`、`image`、`audio`、`resource_link` 和嵌入 `resource` 内容。

- `image` 会进入 Runtime 的图片内容，并继续传给支持图片输入的 AI Provider；Desktop 工具结果展开区也会显示图片预览。
- MIME 为 `image/*` 的嵌入资源 blob 会按图片处理。
- `audio` 与 `resource_link` 在当前 Agent Core 中以明确文本投影，同时完整原始结果保存在工具 details 或 artifact 中。
- `structuredContent`、`isError` 和 `_meta` 会保留；`isError` 会标记模型可见的工具结果错误状态。
- 超过 inline 限制的完整结果会写入 artifact，文本结果可能截断，但图片仍保留在当前结果中。

当前不支持 MCP Apps `ui://` 宿主、任务协议和音频的完整 UI 播放。Transport 会校验 initialize、ToolResult 和 ResourceResult 的基础结构；
协议异常、超时、进程退出和结果降级会记录到宿主 MCP 日志，但不会记录凭据或图片 base64。

协议细节见 [MCP 规范](https://modelcontextprotocol.io)。运行时实现在 `@vetta/runtime-mcp`，本包负责产品侧装配。
