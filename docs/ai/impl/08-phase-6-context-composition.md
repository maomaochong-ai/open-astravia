# Phase 6：上下文组成报告

## 数据链路

```text
Coding Agent prompt/tool provenance
  -> Runtime ModelCallFrame
  -> 最终 transform/finalize 后的 Provider Context
  -> ContextCompositionReport prepared/completed
  -> Runtime state + usage.update
  -> Desktop contextUsage atom
  -> Context Ring 明细 Popover
```

## 报告契约

- `version: 1`，区分 `prepared` 与 `completed`。
- 区块类型：instruction、tool schema、history、runtime context、current user input。
- 来源所有者：core、skill、plugin、MCP、extension、runtime、user、unknown。
- 每区块保留估算 token、估算方法、字符数和 context window 占比。
- 汇总同时保留 estimate coverage 与 Provider reported input tokens。
- Provider actual 不按比例分摊到各区块，避免把估算包装成精确值。
- 报告不包含 prompt、消息、工具 schema 正文，只在进程内短暂使用内容做估算。

## 精确性边界

当前 estimator 是 Unicode code point 计数基础上的 heuristic fallback。它适合比较组成和趋势，不等于 Provider tokenizer 的精确计数。Provider 返回的 input/cache usage 只作为调用总量校准值。后续可按 model binding 注入 tokenizer estimator，但不得改变报告结构或回填伪精确分项。

Frame 中已有 attribution 的 runtime-context 等区块会原样进入估算；instruction 元数据若与最终 system prompt 不一致，则降级为单个 `unknown/effective-system-prompt`，防止显示过期来源。history 和当前输入以最终 Provider Context 为准。

## Desktop 交互

- Context Ring 保留原有总体占用提示。
- 点击圆环展开明细，展示模型、实际输入总量、估算总量、覆盖状态，以及区块来源、类型、token 和估算占比。
- 所有可见文案均使用 `chat` i18n；中英文键完整。
- UI 只消费可序列化 report，不读取 prompt 正文，也不在 renderer 重新估算。

## 测试证据

- report builder：7 条测试。
- model-call lifecycle：3 条测试，覆盖隐私、过期 attribution、稳定 call id 和 Frame runtime-context 保留。
- Runtime Turn/Host 集成：报告完成态与 usage/state 传播均有测试。
- Coding Agent：prompt/tool 来源和 ContextRuntime usage 共 2 组测试。
- Desktop 纯决策 mapper：6 条测试，覆盖无报告、完整/部分覆盖、未知 token、格式化与占比。

## 未完成项

- Desktop 隔离实例曾成功启动并通过 workspace 真实构建；Playwright 操作验证按用户要求停止，未验证弹层的实际视觉布局。
- 当前没有 model-specific tokenizer，属于已声明的估算限制。
- runtime context 的更细来源需要各贡献者在 Frame 中显式提供 provenance；未知来源不会被猜测归因。
