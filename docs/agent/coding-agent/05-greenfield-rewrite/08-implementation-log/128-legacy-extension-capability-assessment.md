# 第 128 轮：Legacy Extension 能力评估与回退合同

## 目标

把 Greenfield CLI 的 `legacy-extension` 判断从“是否加载了 Extension”提升为 Coding Agent
宿主拥有的能力评估合同，同时保证旧 Extension 功能不被静默忽略：

- Coding Agent 负责理解旧 Extension 注册结构；
- CLI 只消费结构化兼容性结果；
- 区分启动阶段已经应用的 Provider/Flag 与需要 Session Runtime 的能力；
- 旧 API 尚未完整适配前，所有 Extension 继续安全回退 Legacy。

## 审计结论

旧 Extension 与 Greenfield Plugin 不是同一套抽象：

| 旧 Extension 能力 | 当前 Greenfield 基础 | 本轮结论 |
| --- | --- | --- |
| Provider、CLI Flag | Bootstrap 已在 Runtime 选择前应用 | 归类为启动贡献 |
| Tool | 已有动态 Runtime Tool/Plugin Tool | 执行上下文仍不等价 |
| Context、Prompt、Tool 拦截 | 有 Plugin Effect 与模型调用编排 | 事件顺序和返回语义未完整映射 |
| Compaction Hook | 已有窄 Extension Adapter | 只覆盖两个压缩事件 |
| 生命周期事件 | 有 Session/Turn 观察事件 | 不是旧 Extension 事件全集 |
| Command、Shortcut、Renderer、UI | RPC/Greenfield 无完整宿主等价面 | 必须继续 Legacy |
| Session 切换、Fork、Tree | 已有部分 Session Port | 旧 Context 仍直接暴露 SessionManager |

更关键的是，Extension factory 可以保存传入的 `ExtensionAPI`，随后从 Tool、事件、定时器或其他闭包
调用 `sendMessage`、`setModel`、`compact`、会话控制等命令式 API。注册表为空不能证明该 Extension
只使用 Provider 或 Flag。

因此本轮引入 `opaque-runtime-api`：只要加载了旧 Extension，在完整命令式 API Adapter 建立前就仍有
一个无法通过静态注册表消除的 Runtime 缺口。

## 实施

### 1. Coding Agent 宿主能力评估

新增 `coding-agent-extension-compatibility.ts`，输出：

- `bootstrapContributions.providers`；
- `bootstrapContributions.flags`；
- 每个 Extension 的 Event、Tool、Command、Shortcut、Flag、Message Renderer 注册摘要；
- 确定性排序后的 `requiredRuntimeCapabilities`；
- 当前尚未覆盖的 `unmetRuntimeCapabilities`；
- 宿主选择使用的 `requiresLegacyRuntime`。

当前运行时能力按以下稳定顺序报告：

1. `opaque-runtime-api`；
2. `event-handler`；
3. `tool`；
4. `command`；
5. `shortcut`；
6. `message-renderer`。

Provider 注册在清空 pending 列表前完成评估，因此诊断不会因后续写入 ModelRegistry 而丢失。

### 2. Bootstrap 单一事实源

`CodingAgentHostBootstrap` 新增 `extensionCompatibility`。评估只执行一次，和已加载 Extension、
Provider 注册及二次 CLI 参数解析来自同一资源快照。

公开 Bootstrap API 只导出评估结果类型，不导出需要读取 Extension Map 的评估输入和实现函数，
避免宿主消费者重新解释旧结构。

### 3. CLI 回退边界

Greenfield IM Host 不再读取：

```text
extensionsResult.extensions.length
```

而只读取：

```text
extensionCompatibility.requiresLegacyRuntime
```

`legacy-extension` fallback 同时携带完整 `extensionCompatibility`，可观察到具体注册面和未满足能力。
Legacy、Greenfield Session、模型、Tool、Prompt、Skill、MCP 和持久化行为均未改变。

### 4. Schema 选择

本轮没有引入 TypeBox 或 Zod。评估输入来自进程内已经类型化的 Extension Loader 结果，不是外部协议、
配置文件或不可信 JSON；使用运行时 Schema 不会增加边界安全性。

## 测试

新增和更新的测试覆盖：

- 无 Extension 时没有 Runtime 缺口；
- 多 Extension 的 Provider/Flag 去重和确定性排序；
- Event、Tool、Command、Shortcut、Renderer 的完整分类；
- 空 handler 不产生虚假事件能力；
- 只有 Provider/Flag 时仍保留 `opaque-runtime-api`；
- Host Bootstrap 暴露空评估；
- CLI 不再读取 Extension 注册数组，而依据 Bootstrap 评估继续回退。

针对性测试结果：

- `coding-agent`：2 个文件，4 项测试通过；
- `cli-app`：1 个文件，5 项测试通过；
- 合计：3 个文件，9 项测试通过。

最终质量门：

- 根目录 `bun run check:quick`：通过；
- 根目录 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查和质量守卫全部通过。

## 明确未修改

- 没有放行任何旧 Extension 进入 Greenfield；
- 没有忽略 Tool、事件、命令、快捷键、Renderer 或 UI 回调；
- 没有把旧 Extension 转写成产品 Plugin；
- 没有给 Greenfield Core 引入 ExtensionAPI、SessionManager 或 UI 类型；
- 没有改变 Provider/Flag 的应用时序；
- 没有改变 `legacy-session` 或 `unsupported-session-selection`。

## 结果

`legacy-extension` 仍保持原有安全行为，但回退决策已经不再绑定 Extension 数组长度。Coding Agent
宿主现在提供可扩展、可诊断的能力缺口合同，CLI 不理解旧 Extension 内部结构。

`requiredRuntimeCapabilities` 与 `unmetRuntimeCapabilities` 当前相同是刻意设计：未来每完成一个兼容
Adapter，只能在有差分测试证明语义一致后，从 unmet 集合移除对应能力，不能通过 CLI 特判绕过。

## 下一步

第 129 轮建议建立 Legacy Extension Execution Host Port，并作为一个完整阶段处理：

1. 冻结 Extension Tool、`tool_call/tool_result`、`context/before_agent_start` 的旧行为顺序和错误语义；
2. 将 send message、history append、model/thinking、active tools、compact 等命令式操作映射到现有
   Session/Runtime 小 Port；
3. 明确 SessionManager、UI、Command/Shortcut/Renderer 仍不可适配的能力，禁止伪造对象；
4. 优先完成 Tool 与模型调用 Hook 的宿主边缘 Adapter，再通过能力差分结果缩小 fallback；
5. 只有完整覆盖 ExtensionAPI 的异步持有语义后，才能移除 `opaque-runtime-api`。
