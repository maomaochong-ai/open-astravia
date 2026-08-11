# ADR-0061: QuickJS Worker 运行时与宿主声明式 UI

## 状态

Accepted

## 背景

现有 `esm` / Module Federation 插件在宿主 renderer realm 内执行，适合官方和策展插件，但权限 API 无法阻止同 realm 的恶意代码直接探测 DOM、preload 或宿主模块。第三方插件仍需要可交互 UI，但 iframe 路径不在本次范围内。

## 决策

新增可选 `runtime: "quickjs"`：

- renderer 只读取入口文本，不以 V8 ESM 执行；源码传入 Web Worker 内的 QuickJS-WASM。
- 每个插件拥有独立 Worker 和 QuickJS 上下文，设置内存、栈、执行时限和任务数上限。
- QuickJS 默认没有 DOM、Electron、Node、原生 `fetch` 或模块加载器。
- 宿主能力使用 JSON RPC；renderer 只分派固定 allowlist，实际权限继续由 capability session 和主进程校验。
- UI 只允许有界、可序列化的声明树，由宿主 React 组件渲染；事件以 action 消息回传。
- QuickJS 插件禁止自带 CSS 和 Module Federation metadata，避免重新获得宿主样式与 JS 执行面。
- 旧 `esm` / Module Federation 插件不迁移，行为保持兼容。

首版声明式 UI 只提供 Activity Tab，节点包含布局、文本、按钮、输入、文本域、选择和开关。首版 RPC 提供网络、私有存储、设置和 i18n；不提供命令、文件系统、Agent 动态处理器或任意 UI 代码。

## 安全边界

该方案把普通第三方 JS 与宿主 realm 隔开，并使死循环可通过 Worker/QuickJS 中断回收。它不是 OS 进程隔离：Chromium、WebAssembly 或 QuickJS 的底层漏洞仍可能突破边界。所有敏感操作仍必须在主进程做插件身份与权限校验。

## 后果

- 第三方插件可组合复杂表单和操作面板，但不能提交任意 React、HTML、CSS、Canvas 或 DOM 代码。
- host-api 变为异步、JSON 可序列化调用，依赖 Node/DOM 的 npm 包不能直接运行。
- 每个 QuickJS 插件增加一个 Worker 和 WASM 上下文的启动、内存成本。
- 未来需要更强对抗时，可把同一 RPC/声明式 UI 协议迁移到 Electron `utilityProcess`，无需重新开放 UI 执行权。
