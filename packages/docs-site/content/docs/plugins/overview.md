---
title: 插件开发概览
description: 理解 Vetta 插件的运行方式、能力出口和信任边界。
---

Vetta 插件用于扩展桌面客户端的界面、文件浏览器、对话和 Agent 能力。插件通过 `@vetta-org/plugin-sdk` 获取宿主提供的策展能力出口。

## 运行模型

- 插件使用 React、TypeScript 和 Vite 开发。
- 生产产物通过 Module Federation 加载。
- React、React DOM 和插件 SDK 由宿主以共享单例提供。
- 插件在桌面渲染进程内运行，不是 iframe 或 Worker 沙箱。

## 信任与权限

插件面向官方或合作方策展的扩展，不应被视为可直接运行的任意不可信代码。需要权限的能力必须同时满足：

1. 在 `plugin.json` 中声明权限。
2. 安装时由用户或管理员授权。
3. 运行时通过宿主权限校验。

## 可扩展范围

插件可以注册界面插槽、页面、文件预览、消息卡片、Agent 工具和 App Action，也可以在获得授权后访问文件、网络、私有存储、自动化任务及用户配置的 AI 模型。

如果只是给 Agent 增加一组指令，优先发布技能；如果只是连接外部工具，优先使用 MCP。只有需要桌面 UI、宿主 API 或完整生命周期时才创建插件。

继续阅读[创建第一个插件](/plugins/getting-started/)、[清单与权限](/plugins/manifest-and-permissions/)和[扩展点](/plugins/extension-points/)。
