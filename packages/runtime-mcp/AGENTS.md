# Team: Runtime

> 本包属于 **Runtime Team**，是平台无关的 MCP 协议与状态协调层。

## 职责范围

MCP（Model Context Protocol）的独立 Runtime Feature：定义版本化工具视图 Source Port、增量同步、
Turn generation 内的渐进披露和模型调用级 Prompt/Tool 物化。

## 注意事项

- `src/` 不得导入或 re-export `@vetta/coding-agent`
- 不在本包解析 Desktop/CLI 产品配置，也不绑定具体 `McpManager`
- 配置 Source、OAuth Store、Client Factory 与 Server Runtime 只定义 Port；Node 实现位于 `@vetta/runtime-node/mcp`
- `src/` 不得访问文件系统、进程、网络、凭证、Electron 或宿主全局状态
- 动态新增、删除、未变化 binding 保留、失败保持和渐进披露必须有独立测试
- 修改公开 Port 时同步检查 `runtime-composition` 与 coding-agent 的 legacy adapter

## 测试要求

- 使用 Vitest 和本地 fake Port 验证协议状态机，不连接真实 MCP 服务、OAuth Provider 或用户配置。
- Tool/Resource/Prompt 发现、增量同步或渐进披露变化时，必须覆盖新增、删除、替换、未变化复用、乱序/重复通知、失败保持、取消、活动 Turn 保持旧 generation 和下一 Turn 可见性。
- Schema 或公开 Port 变化必须增加协议合同测试；stdio/HTTP、OAuth、文件配置和凭证行为由平台 Runtime 测试覆盖。
