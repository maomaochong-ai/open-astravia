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

## 协议兼容

- 默认 `protocolMode: "auto"`：先探测无状态 MCP `2026-07-28`，不支持时在同一连接回退到
  `2024-11-05`—`2025-11-25` Legacy initialize/session 流程；也可显式选择 `modern` 或 `legacy`。
- Modern HTTP 每次请求携带协议版本、客户端能力和客户端信息，不依赖 initialize 或 Session ID；支持
  `server/discover`、CacheableResult、MRTR、取消和 subscriptions。
- Modern Tool、Resource、Prompt 的 `input_required` 由统一 MRTR 状态机处理。Legacy Server Request 继续兼容
  Elicitation、Sampling 和 Roots；Desktop 只为当前项目暴露 Root，Sampling 必须由宿主显式注入审批策略。
- MCP Tasks 与 Vetta 后台命令任务分开管理。Tool 创建 Task 后会轮询、处理输入、支持取消，并在 Desktop 活动面板投影
  最小可恢复状态；远端 taskId 和正文不进入 Renderer。

## ToolResult 内容与图片

Vetta 支持 MCP ToolResult 中的 `text`、`image`、`audio`、`resource_link` 和嵌入 `resource` 内容。

- `image` 会进入 Runtime 的图片内容，并继续传给支持图片输入的 AI Provider；Desktop 工具结果展开区也会显示图片预览。
- MIME 为 `image/*` 的嵌入资源 blob 会按图片处理。
- Desktop 展示全部安全图片块和音频播放控件；`audio` 与 `resource_link` 在当前 Agent Core 中仍以明确文本投影，
  完整原始结果保存在工具 details 或 artifact 中。
- `structuredContent`、`isError` 和 `_meta` 会保留；`isError` 会标记模型可见的工具结果错误状态。
- 超过 inline 限制的完整结果会写入 artifact，文本结果可能截断，但安全图片与受限音频预览仍可展示。
- 浏览器投影只接受规范 Base64、安全 MIME，并限制媒体数量、单项和总字节数；SVG、非法编码和超限媒体不会进入 data URL。

## MCP Apps

Desktop 支持 MCP Apps `2026-01-26` 扩展：识别当前 `_meta.ui` 和旧版 `ui/resourceUri`，读取
`text/html;profile=mcp-app` 的 `ui://` 资源，并在双层 sandbox iframe 中运行。App Bridge 只声明已经实现的
initialize、Tool input/result、受限 `tools/call` 和 `resources/read`；Tool 调用同时要求 app visibility 与现有
`autoApprove`，且只能复用同一 MCP Server 连接。导航、设备权限、宿主消息、全屏和画中画当前不声明并默认拒绝。

协议异常、超时、进程退出、MRTR/Task/App 生命周期和结果降级只记录安全摘要，不记录凭据、参数、结果正文或 base64 媒体。

协议细节见 [MCP `2026-07-28` 规范](https://modelcontextprotocol.io/specification/2026-07-28)和
[MCP Apps 规范](https://modelcontextprotocol.io/extensions/apps/overview)。运行时实现在 `@vetta/runtime-mcp`，
本包负责产品侧装配。
