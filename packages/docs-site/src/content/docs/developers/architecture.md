---
title: 架构与包边界
description: 理解 Vetta 应用、运行时和核心 Agent 包之间的依赖方向。
---

Vetta 使用 monorepo 管理桌面应用、服务和核心 TypeScript 包。依赖方向保持为：

```text
应用 → runtime-* → coding-agent → agent → ai
```

## 核心包

| 包 | 职责 |
| --- | --- |
| `@vetta/ai` | 多模型服务协议、消息转换、流式事件和模型注册表 |
| `@vetta/agent-core` | 有状态 Agent Loop、工具调用和事件流 |
| `@vetta/coding-agent` | 会话、上下文、工具编排及 SDK/RPC 产品能力 |

## 运行时包

运行时层负责把 Coding Agent 能力组织成可被桌面宿主复用的会话、存储、工具、MCP 和遥测接口。运行时包不应依赖具体桌面界面。

## 应用层

桌面应用负责 Electron 生命周期、原生能力、IPC 和用户界面。业务 API 负责账号、组织、模型服务配置及其他服务端规则。

:::note
核心库不依赖桌面应用或管理后台。新增能力时，应先确定契约属于核心、运行时还是宿主，避免把界面生命周期带入底层包。
:::
