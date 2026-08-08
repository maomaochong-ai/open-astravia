---
title: 配置 MCP 连接器
description: 添加推荐或自定义 MCP 服务，并控制作用域、认证和工具审批。
---

MCP 让 Agent 调用外部工具与数据源。当前入口位于侧栏“扩展 → 连接器”。

## 添加推荐连接器

1. 打开“连接器”，在推荐列表选择服务。
2. 选择全局或当前项目作用域。
3. 按要求完成浏览器授权、令牌或环境变量配置。
4. 保存后检查连接状态，并在会话中让 Agent 列出或调用相关工具。

全局配置位于 `~/.vetta/agent/mcp.json`；项目配置位于 `<项目>/.vetta/mcp.json`。同名服务同时存在时，项目配置覆盖全局配置。

## 添加自定义服务

本地进程使用 stdio：

```json
{
  "my-tools": {
    "command": "node",
    "args": ["${PROJECT_ROOT}/tools/server.mjs"],
    "env": { "TOKEN": "${MY_TOOLS_TOKEN}" }
  }
}
```

远程服务使用 HTTP：

```json
{
  "my-api": {
    "type": "http",
    "url": "https://example.com/mcp",
    "headers": { "Authorization": "Bearer ${MY_API_TOKEN}" }
  }
}
```

`${PROJECT_ROOT}` 指向项目根目录，`${VAR}` 从运行环境读取。优先引用环境变量，不要把令牌直接写进项目配置。

## 审批与排错

`autoApprove` 会让指定工具跳过逐次确认，只应用于行为可预测、输入范围受控的工具。连接失败时依次检查命令是否可执行、工作目录、环境变量、HTTP URL、认证状态和启动超时。工具在 Agent 中以 `mcp_<服务名>_<工具名>` 的形式注册。
