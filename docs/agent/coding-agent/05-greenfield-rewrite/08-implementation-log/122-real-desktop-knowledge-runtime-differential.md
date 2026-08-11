# 第 122 轮：真实 Desktop Knowledge Runtime 差分门禁

## 目标

在不改变 Knowledge 功能、失败语义和默认 Runtime 的前提下，让同一套真实 Desktop Canary 分别运行
Legacy 与 Greenfield Knowledge Processing，并比较完整产品可观察合同：

- 相同 raws、模型、Provider 响应、CLI Action 和审批链路；
- 相同成功、退出中止和 Provider HTTP 失败场景；
- 相同 wiki、manifest、tags、失败账本和 Monitor 结果；
- 相同 Renderer 通知与 Desktop 重启、锁释放、endpoint/Provider 清理结果；
- 仅允许 Runtime 身份和内部 processing record 文件名格式不同。

## 实施

### 1. 定义归一化 Knowledge 差分合同

Runtime Canary 现在输出独立的 `RuntimeCanaryKnowledgeContract`，包含：

- 三类扫描结果：成功、退出中止、Provider 失败；
- wiki 正文与 frontmatter、manifest 页数和 tags 索引；
- 失败 source、attempts 与 quarantine 状态；
- processing usage、round、processed/failed/manual scan 指标；
- Renderer 的 processing/statuses 通知；
- processing record 数量；
- Desktop 重启、Session/raws lock、endpoint、Provider 和退出码。

跨进程状态、CLI 输出、CDP 响应和最终差分报告使用 Zod 校验；进入合同后的值继续使用 TypeScript
类型，不为内部对象重复增加 Schema。

### 2. 使用同一 fixture 顺序运行两种 Runtime

新增独立差分入口，依次启动两个完全隔离的真实 Desktop：

```text
Legacy Desktop Canary ─┐
                       ├─> normalize Knowledge contract ─> differential gate
Greenfield Desktop Canary ─┘
```

两次运行复用同一确定性 Provider 行为、source 内容、Knowledge Action、真实审批和生命周期步骤，但各自
拥有隔离的 `VETTA_HOME`、workspace、端口、安装 CLI 与持久文件。顺序执行避免两个 Electron/Provider
fixture 争用宿主资源。

差分器默认拒绝任何合同差异，只声明两项允许差异：

1. `runtimeMode`：被比较的 selector 轴；
2. `processingRecordFormat`：Legacy 使用普通 `.jsonl`，Greenfield 使用
   `.conversation.jsonl`。

第二项只允许文件名格式不同；record 数量、Session lock 与退出释放仍必须相等。

### 3. 完善真实 processing record 与通知观察

Canary 不再假设所有 Knowledge processing record 都是 Conversation V2。它枚举全部 `.jsonl`，要求单次
运行只能出现一种格式，并验证三轮扫描恰好留下三条记录。

Renderer 通知在 Desktop 重启后的稳定主窗口中观察一次完整失败轮，要求：

```text
processing(true)
  -> 至少一次 statuses invalidation
  -> processing(false)
```

成功产物和退出中止分别由文件、Action 结果、锁与进程生命周期合同验证，不把已经销毁的重启前 Renderer
事件伪装成跨重启连续通知流。

### 4. 稳定 UI 验证传输边界

`verify:ui debug runtime-canary` 已持有 Playwright 的浏览器级 CDP 会话。Canary 若再次建立浏览器级会话，
会在 Electron 重启或审批阶段竞争同一个 WebSocket。最终实现改为直接连接主 Renderer 的页面级 CDP target：

- 每次操作都从 `/json/list` 重新发现当前 Desktop 主窗口；
- 明确排除 Pet、Quick Panel、Onboarding 和 `devtools://` 页面；
- 审批通过真实 DOM 按钮触发，不绕过 Action Approval；
- 通知回调通过 preload 暴露的 `window.vetta.knowledge` API 注册；
- Desktop 重启后重新发现页面，不保留失效连接。

该改动只属于 Canary 驱动层，没有修改审批、Knowledge 或 Runtime 产品实现，也没有新增 Playwright 运行时
依赖。

## 差分结果

真实 Legacy 与 Greenfield 运行得到相同的归一化合同：

- 成功、退出中止和 Provider HTTP 失败均返回既有 `scan-now` 完成结果；
- wiki、manifest、tags、source hash 和正文完全一致；
- 失败账本均记录一次未 quarantine 的失败；
- Monitor 均为 3 轮、3 次手动扫描、1 个成功文件、0 个 Monitor failed 文件；
- 通知均为 `processing(true)`、两次 statuses、`processing(false)`；
- 均产生 3 条 processing record；
- 均完成一次 Desktop 重启并释放 Session/raws lock；
- 最终 Action endpoint 删除、Provider 停止、Desktop 退出码为 0。

门禁结果为 `blockingDifferences: []`。唯一差异是前述 Runtime 身份与内部 record 文件名格式。

## 明确未修改

- `VETTA_DESKTOP_AGENT_RUNTIME` 默认值仍为 Legacy；
- Provider/批次直接抛错不进入最终 failure reconciliation 的既有行为未修改；
- Provider HTTP 失败写入 `failures.json`、但 Monitor `filesFailed` 仍为 0 的既有口径未修改；
- Tool、Prompt、Todo、Writer、批次/并发算法、Action 结果和通知时序未修改；
- Legacy 与 Greenfield 的持久化文件格式未互相改写。

## 验证

- Desktop Runtime Canary 差分、Runner、Provider、Poller 与 Round Controller：5 个文件、15 项测试通过；
- `packages/desktop-app` 的 `bunx tsc --noEmit`：通过；
- 根目录 `bun run check:quick`：通过；
- 根目录 `bun run verify:ui:runtime-diff`：通过；
- 根目录 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查与质量守卫全部通过；
- 真实差分结果：2 项允许差异，0 项阻断差异。

## 下一步

第 123 轮应把默认切换作为独立阶段处理：

1. 只改变 Runtime selector 的默认决策，不同时删除 Legacy；
2. 保留显式 `legacy` 回退和 requested/effective/fallback 观察；
3. 增加默认未配置、显式 Legacy、显式 Greenfield 三条真实启动合同；
4. 复跑本轮差分、标准安装产物、Desktop/CLI/RPC/IM Provider Frame 与完整质量门禁；
5. 任何新增行为差异都回退默认值，不通过扩大归一化规则放行。
