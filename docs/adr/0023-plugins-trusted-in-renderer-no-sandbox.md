# 桌面插件按「可信 in-renderer」开放 API，放弃沙箱隔离

把插件系统从 demo 级推向「对外开放 agent 对话常用 API」时，须先定信任模型，它决定每个 API 的形状。现状：插件已在 renderer 进程内执行，经 Module Federation 共享宿主 React/JSX/`@vetta-org/plugin-sdk` 单例（`plugin-host-shim`），`PluginContext` 实际只暴露 `ui.registerGlobalSlot` + `permissions`，声明的 `agent.session.*` / `fs.*` 等权限位是占位、无任何实现。

决定把插件定位为 [[可信插件]]——**一方/合作方编写、经审核策展上架**，继续 in-renderer、共享 React，新开放的 API 是「策展过的能力出口 + `PluginPermission` 门控」。由此 API 形状刻意走捷径：**可同步、可直接传 React 组件实例、可经宿主导出的 hook 直读宿主 jotai atom**（见 [[对话插件 API]]、[[文件预览插槽]]）。明确**不**为不可信第三方做 iframe/worker 沙箱与异步消息桥。

## Considered Options

- **iframe/worker 沙箱 + 全异步消息桥（不可信第三方模型）**：安全边界硬，任何人可上架。但要推翻现有共享 React slot 模型、所有 API 改异步可序列化、组件不能直传实例、状态不能直读 atom——数量级更大的工作，且与「对话类 UI 增强」体验相悖（同步 hook 自动 rerender 的人体工学全失）。当前无不可信上架诉求，被否。
- **分层：现可信落地，但 API 预先按「将来可塞进沙箱」设计**（全异步、不传组件实例、不直读 atom）：保留未来期权，但当下即背上异步/可序列化税，hook 直读 atom 这条最大人体工学红利无法吃。被否。

## Consequences

- 插件拥有完整 DOM 能力，且经共享单例可触及宿主运行时；安全完全依赖**上架审核**这道人工闸，代码层无运行时隔离。这是接受的代价，前提是「策展分发」。
- 一旦将来需要支持不可信第三方插件，本 ADR 选定的 API 形状（同步、传组件实例、hook 直读 atom）须整体推翻重写——这是已知的、被刻意承担的不可逆点。
- `@vetta-org/plugin-sdk` 导出的 hook 要读宿主 atom，又不能反向依赖 desktop：靠宿主在 `installPluginHostShim` 时把 store/atoms/actions 注入 plugin-sdk 内部 bridge，依赖 Module Federation 的「宿主与插件共享同一份 pluginSdk 实例」成立。
- 权限位从占位转为真实门控：新增 `ui.slot.file-preview`，`agent.session.read/write` 开始承载 [[对话插件 API]] 的读/写出口。
- [[文件预览插槽]] 取「仅补空白」优先级，使开放新 slot 不会退化任何现有内置预览体验，是本信任模型下「插件坏了也不伤主体验」的具体体现。
