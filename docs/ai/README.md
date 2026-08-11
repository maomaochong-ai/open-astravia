# AI 与 Agent 架构审计

本文档集审计 `packages/ai` 与 `packages/agent`，并与本机 `C:\develop\github\ai` 中的 Vercel AI SDK 快照进行职责对齐后的比较。

## 结论摘要

不能简单地说两个包“实现得都不好”。更准确的判断是：

- `packages/ai` 已经解决了不少困难的 Provider 兼容问题，尤其是跨 Provider 消息交接、思考块、工具调用 ID、OAuth/CLI 协议和模型目录；但它把协议、Provider 实现、模型元数据、认证、环境探测和进程级配置放进了同一个发布单元。随着 Provider 数量增长，这种边界开始放大类型逃逸、全局副作用、错误不可分类和浏览器打包风险。
- `packages/agent` 对桌面长会话有明确价值：它支持 steering、follow-up、动态工具集、上下文检查点和可观察事件。这些并不是 Vercel `ToolLoopAgent` 的直接替代品。不过，当前循环缺少可靠的失败闭环和默认停止上限，存在可复现的“底层抛错后事件流不结束”问题；检查点也可能无限等待。
- Vercel AI SDK 的主要优势不是代码写法，而是边界：稳定 Provider 协议、共享 Provider 工具、独立 Provider 包、上层生成/Agent 编排。它的代价是规模大、类型复杂、维护门槛高，不适合整体照搬。
- 最优路线不是重写，也不是直接替换成 Vercel AI SDK，而是先修复流和循环的终止语义，再逐步把 `packages/ai` 内部拆成协议内核、共享传输工具、Provider 适配器和模型目录。

## 最高优先级问题

| 编号 | 优先级 | 问题 | 影响 |
| --- | --- | --- | --- |
| AG-01 | P0 | `agentLoop` 的后台异步任务抛错时没有关闭或拒绝事件流 | 调用方可能永久等待 |
| AI-01 | P0 | `EventStream` 没有失败通道，`end()` 未传结果时 `result()` 永不完成 | Provider/代理异常可变成悬挂请求 |
| AG-02 | P1 | Agent Loop 没有默认步数上限或统一停止策略 | 重复工具调用可无限消耗资源 |
| AG-03 | P1 | `context_checkpoint` 没有超时或取消闭环 | 宿主遗漏响应时任务永久挂起 |
| AI-02 | P1 | 浏览器扩展环境下工具参数验证直接 fail-open | 未验证的模型输入进入工具执行 |
| AI-03 | P1 | 根入口触发 Provider 注册和全局 HTTP dispatcher 修改 | 隔离性、测试性和浏览器打包受影响 |

P0 表示会破坏请求终止或等待语义；P1 表示高概率造成正确性、安全性或演进阻塞；P2 表示重要但可分阶段处理的设计债务。

## 文档导航

1. [审计范围与架构基线](./01-scope-and-architecture.md)
2. [`packages/ai` 专项审计](./02-packages-ai-review.md)
3. [`packages/agent` 专项审计](./03-packages-agent-review.md)
4. [与 Vercel AI SDK 的多维对比](./04-vercel-ai-sdk-comparison.md)
5. [目标架构与演进路线](./05-evolution-roadmap.md)

## 建议先做什么

第一轮只处理终止语义，不做大拆包：

1. 给 `EventStream` 增加明确的 `close(result)` 与 `fail(error)`，保证迭代器和 `result()` 总能同时结束。
2. 托管 `agentLoop` 后台任务，把异常转发到事件流，并添加回归测试。
3. 给 Agent Loop 增加默认最大步数和可组合停止条件。
4. 给上下文检查点增加 `AbortSignal` 与超时。

完成这四项后，再开始协议和 Provider 边界调整。否则拆包只会移动现有故障，而不会降低运行风险。
