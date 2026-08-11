# 第 121 轮：真实 Desktop Knowledge 生命周期 Canary

## 目标

在不改变 Knowledge 功能语义和默认 Runtime 的前提下，用真实 Desktop 主进程、安装后的 Vetta CLI、
Action RPC 与审批 UI 验证 Greenfield Knowledge Processing 的生产生命周期：

- 手动整理能够经过真实 Action 注册、审批和执行链路；
- 退出时活动加工轮先中止、再释放 Session/Composition、raws lock 和临时资源；
- Desktop 重启后会话与 Knowledge 结果保持可用；
- Provider HTTP 失败继续遵循既有失败记录与监控口径；
- 最终退出后 Action endpoint、Desktop 和确定性 Provider 均已停止。

## 实施

### 1. 收口 Knowledge Poller 的异步关闭所有权

`shutdownKnowledgePoller()` 改为幂等异步关闭：

1. 立即进入 shutting-down 状态并停止 scheduler；
2. 中止当前活动轮并等待其完成；
3. 兜底释放 raws lock；
4. 关闭后拒绝新的 run、reload 和 retry。

Desktop `before-quit` 在关闭本地 RPC 前立即启动该流程，随后等待关闭 Promise。这样既允许进行中的
`knowledge.manage` Action 先完成收尾，又避免 RPC 先断开后仍有后台加工继续运行。

### 2. 扩展真实 Runtime Canary

Canary 使用隔离的 `VETTA_HOME`、Knowledge 根和确定性 Provider，并通过安装到隔离目录的 `vetta.exe`
执行 `action run knowledge.manage`。审批不是 Debug API 伪造，而是连接当前 Desktop 的 Playwright
会话，点击真实 Action 审批对话框。

单次 Canary 覆盖：

1. 首次手动扫描成功，验证 wiki、manifest、tags、usage 和 processing record；
2. 第二次扫描仍在执行时请求退出，验证活动轮中止、raws lock 释放和进程退出；
3. 重启 Desktop，验证原会话继续、Knowledge Action Provider 重新注册；
4. 写入失败源并触发 Provider HTTP 500，验证失败记录；
5. 带活动会话再次退出，验证 endpoint 删除、Provider 停止和 Desktop 零退出码。

审批按钮带倒计时更新，普通自动点击会持续等待元素稳定，因此 Canary 对已经定位到的审批按钮使用
force click；这只改变测试驱动方式，不绕过真实审批逻辑。

### 3. 修复能力输入边界的 TypeBox 空对象定义

`knowledge.manage.scan-now` 原先用 `Type.Unsafe<Record<string, never>>` 描述空输入。该定义没有可供
TypeBox Value 解码的结构 Kind，真实 CLI 调用 `{}` 时会抛出 `Unknown type`。现在改用：

```ts
Type.Object({}, { additionalProperties: false })
```

它保持“只接受空对象”的原合同，并补充 `{}` 成功、额外属性拒绝的回归测试。能力目录随后由现有生成器
重新生成。Zod 仅用于 Canary 中跨进程 CLI、Provider、状态文件和监控 JSON 的不可信输入，不进入进程内
Knowledge Port。

### 4. 补齐隔离前置构建

真实 Desktop 启动会独立构建 workspace prerequisite，因此暴露出 `runtime-mcp` build tsconfig 缺少
DOM 类型库的问题。该包的公开类型确实引用 `RequestInit`、`Response` 等 Web API，构建配置现显式包含
`DOM`，没有降级或移除现有类型。

## 兼容性结论

真实链路确认的既有失败语义是：

- Provider HTTP 失败不会令 `knowledge.manage` CLI Action 以非零码退出；
- 加工轮会完成，并在 `failures.json` 为失败 source 写入一次未隔离记录；
- 已成功生成的 wiki、manifest 和 tags 保持不变；
- 当前 Monitor 的 `filesFailed` 仍为 `0`。

最后一项是现有持久失败记录与 Monitor 统计口径之间的观察差异。本轮 Canary 同时固定两者，没有借架构
重构修改产品统计语义。若要统一口径，应作为独立功能修复评审。

默认 `VETTA_DESKTOP_AGENT_RUNTIME` 仍为 Legacy；只有 Canary 的隔离环境显式选择 Greenfield。

## 验证

- `packages/capability-sdk/test/domain/knowledge.test.ts`：4 项通过；
- Desktop Runtime Canary、Provider、Poller shutdown 与 Round Controller 定向测试：4 个文件、11 项通过；
- `bun run check:quick`：通过；
- `bun run verify:ui:start -- --runtime-canary greenfield`：真实隔离 Desktop 启动成功；
- `bun run verify:ui:debug -- runtime-canary`：真实 CLI/审批/退出/重启/失败链路通过；
- 最终状态：Desktop 已重启一次，旧会话保留，Session/raws lock 已释放，Action endpoint 已删除，
  Provider 已停止，Desktop 退出码为 0。

## 下一步

1. 单独决定 `failures.json` 与 Monitor `filesFailed` 是否应统一，以及 Action 是否需要暴露“轮完成但部分文件
   失败”的结构化结果；该决定属于功能语义，不夹带在架构重构中。
2. 若保持现有语义，在默认切换前增加一轮显式 Greenfield 灰度观察；若修改语义，先增加对应失败回归测试。
3. 灰度无新增差异后，将 Knowledge Poller 默认值切换作为独立阶段，并保留进程级 selector 回退。

