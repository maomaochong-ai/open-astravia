---
status: accepted
---

# Agent 浏览器操作使用独立 CLI Session

## 背景

ADR-0088 将浏览器进程、profile、策略与生命周期收敛为 Desktop Foundation Capability，并让 Browser
系统插件通过单个 `browser_operate` Tool 把该能力暴露给 Agent。该结构适合插件代码的稳定 API，但压缩了
`agent-browser` 已为 Agent 设计的 CLI 命令面，批处理、版本匹配 Skill 和新上游命令都需要再次包装成 Tool
合同。真实任务测试还表明，主要开销来自模型在受限 Tool 操作之间反复规划，而不是底层浏览器命令本身。

产品现在明确选择两种调用面拥有独立活跃 Session：Agent 使用 CLI，插件代码使用 `ctx.browser` API。两者仍
复用 Desktop 安装的锁定版本运行时，但不尝试共享 daemon、当前页面、元素 ref 或 profile 生命周期。

## 决策

1. Browser 系统插件只向 Agent 贡献按需 Skill，不再注册 `browser_operate` 或其它浏览器专用 Tool。Agent
   通过现有 shell Tool 直接调用 PATH 中的 `agent-browser`。
2. Desktop 继续通过托管 npm 前缀安装锁定版本的 `agent-browser`，并把该前缀加入 Agent 命令环境 PATH。
   插件面板继续负责安装、升级、浏览器下载与状态诊断。
3. 每个 Coding Agent Session 的命令环境注入宿主确认的 `VETTA_AGENT_SESSION_ID`。Skill 要求每条
   `agent-browser` 命令显式以该值作为 `--session`，并使用 `--pin-tab`。同一 Agent Session 的连续命令复用
   自己的浏览器；不同 Agent Session 不从 cwd 推导或共享 session。
4. 同一任务操作多个账号时，以 `<agent-session-id>-<account-key>` 形成独立 upstream session，并用稳定
   `--restore <account-key>` 保存 Cookie 与 localStorage。需要完整 Chrome profile 时可显式使用 upstream
   `--profile`，但该 profile 不属于 `BrowserAutomationService`。
5. Plugin SDK 的 `ctx.browser`、Foundation Capability、Desktop `BrowserAutomationService` 和现有 namespace
   隔离合同保持不变。Agent CLI 与 Plugin API 只共享二进制安装来源，不共享活跃 Session 或资源所有权。
6. Agent CLI 以 full-access 命令环境为首个支持目标。当前 OS sandbox 会为每次命令创建临时 HOME，不能在
   多个模型轮次之间稳定复用 upstream daemon；在建立 Session 持久目录合同前，不宣称 sandbox 模式支持该流程。

本决策替代 ADR-0088 中“Browser 系统插件保留 Agent 结构化工具体验”和“不长期并行维护 CLI 与
Capability 两条执行路径”的结论；ADR-0088 对 Plugin API、Foundation Capability 与宿主资源所有权的决策继续有效。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| `vetta browser` 代理 CLI 经 Local RPC 进入 BrowserAutomationService | Agent 仍只能使用 Vetta 重新定义的命令子集；需要维护额外 CLI/RPC 协议，且用户明确不要求与 Plugin API 共享 Session |
| 继续使用 `browser_operate` | 专用 Tool Schema 常驻，命令面与 upstream 演进重复，预先确定的操作难以利用 CLI batch/chaining |
| CLI 与 Tool 长期并存 | 模型面对两条等价操作路径，Skill、测试与故障诊断需要维护两套事实源 |
| 所有 Agent 继续按 workspace 哈希共享 session | 同一项目中的并行会话会互相导航、使 ref 失效并操作错误账号 |
| 每条 CLI 命令创建随机 session | 无法跨模型轮次完成 snapshot、click、read 等有状态任务 |

## 后果

- Agent 获得 upstream 的完整 CLI、JSON、batch、refs、profiles、restore 与版本匹配 Skill，不需要等待 Vetta
  为每个新命令增加 Tool Schema。
- `VETTA_AGENT_SESSION_ID` 成为 Coding Agent 命令环境的公开宿主合同；宿主提供的值覆盖调用方同名 env。
- Agent CLI 的 Chrome、daemon 和持久状态不受 `ctx.browser` 的 namespace、revision、取消与关闭生命周期管理；
  故障诊断需要区分 CLI 与 Capability 两条路径。
- 关闭 Agent Runtime 不等价于立即关闭 CLI daemon；Skill 在任务结束时执行 `agent-browser close`，upstream
  idle timeout 继续负责异常退出后的回收。
- Browser 插件原来的来源、headed、域名和输出设置不再代理 Agent CLI 参数，因此从插件设置中移除；需要时
  由 Agent 使用对应 upstream flags。Plugin API 调用者继续在自己的 Session 参数中声明行为。
