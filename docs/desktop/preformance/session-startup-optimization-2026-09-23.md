# 普通对话初始化优化与受控对比（2026-09-23）

## 范围与测量口径

此前的[首响应核查](./session-first-response-2026-09-23.md)使用历史日志，不能直接作为当前源码的前后对比。本次增加可重复的隔离基准，优化前后使用相同夹具：

- Windows，Node v22.21.1，Bun 1.3.14。
- 真实 Desktop RuntimeHost、BackendPool、资源加载器、会话持久化和 Turn pipeline；Provider 使用本地 HTTP 假服务。
- 40 个用户技能，每个技能有 1 个 SKILL.md 和 20 个附属文件，共 840 个文件。用户目录、配置、工作目录和会话文件均在临时目录。
- 普通对话场景，启用用户技能，关闭后台任务，无外部插件或 MCP 服务。每次建立独立 Host/Pool 和新工作目录，发送 Hello，验证回复，再修改技能并继续发送，验证 Provider 收到更新后的描述。
- 计时从 `RuntimeHost.createSession()` 前开始，到 `model.request.started` 事件；分别记录创建和发送准备。不含模块导入、夹具写入、Electron 启动/导航/绘制、Renderer 插件首次就绪门以及模型网络/推理时间。操作系统磁盘缓存未清空。
- 不用固定毫秒阈值断言 CI 性能；测试断言资源刷新次数上限、真实请求和回复、下一轮资源更新，避免机器负载导致误报。

因此，这个基准可以验证 Runtime 内部优化收益，不能代表实际界面点击到首 token 的 P95，也不能承诺任意机器、远程目录或插件组合都低于一秒。

## 根因与方案

原实现每次快照准备先刷新技能目录，随后提示词、输入资源解析、invoke_skill 的绑定分别再次刷新。创建预览与首轮发送合计触发 8 次 `refreshSkillsIfChanged`；该计数不包含资源工厂初次 reload 内部的扫描。即使技能未变化，刷新仍要先递归计算目录指纹。指纹扫描原来逐项等待 realpath、stat 和目录读取，附属文件越多，延迟越明显。

本次选择收敛同一次 admission 的资源准备职责，未采用跨会话缓存或启动预热：

1. `AdmittedPromptResources` 在会话/Turn admission 中校验并物化资源一次，提示词、输入解析、invoke_skill 使用同一份内存资源视图。创建预览与首轮发送的刷新合计从 8 次降至 2 次。
2. 保留每轮刷新。文件编辑、新增、删除以及 AGENTS.md 变化仍在后续 Turn 生效；刷新失败或取消不发布半成品，已经绑定的 Turn 保留旧资源。
3. 显式插件技能重配置完成后更新未绑定的工具目录，不重复扫描已经由加载器校验的路径，已绑定回合仍保留其副本。
4. 指纹扫描以最多 8 项为一批并发读取同级元数据，等待本批结束后按原顺序遍历。保留别名去重、符号链接/循环处理、取消与错误语义。
5. 对目录列表已确认为非符号链接的普通文件，用已解析的父目录构造身份，避免再次执行 realpath；根目录、子目录和符号链接仍解析真实路径。

没有增加常驻扫描、预创建空会话或模型请求，没有删除技能、插件、权限和项目说明检查，也没有协议或持久化格式迁移。本次是在既有 [Turn generation](../../adr/0069-turn-bound-runtime-generations.md) 和 [配置 admission](../../adr/0096-agent-configuration-templates-and-session-overrides.md) 边界内集中准备，不改变它们的所有权和生效时机。

## 分步测量

以下每组各运行 5 次，单位 ms。均在跨包测试和完整检查启动之前单独运行。

| 实现 | 创建范围 | 创建到请求范围 | 创建到请求中位数 | 刷新次数 |
| --- | ---: | ---: | ---: | ---: |
| 优化前 | 1987.1–2582.5 | 3326.1–4217.7 | 3344.7 | 8 |
| 仅合并 admission 资源准备 | 944.7–1151.2 | 1267.6–1530.8 | 1338.4 | 2 |
| 再并发检查元数据 | 705.1–901.2 | 936.2–1191.3 | 970.4 | 2 |
| 再减少普通文件 realpath | 458.1–600.8 | 568.1–733.3 | 625.9 | 2 |

最后一组相对基线的创建到请求中位数下降约 81.3%。这些是同夹具的受控数据，不应拿它与旧安装版历史日志中的 5.61–7.26 秒直接计算改善比例。最终兼容修复后的复测与验证结果记录在下节。

## 最终复测与验证

兼容修复、整包测试和静态检查结束后，使用同一夹具单独复测 5 次：

| 指标 | 优化前中位数 | 最终中位数 | 最终范围 | 中位数下降 |
| --- | ---: | ---: | ---: | ---: |
| 创建会话 | 2000.2 ms | 497.8 ms | 431.3–561.3 ms | 75.1% |
| 创建后到模型请求 | 1357.6 ms | 132.4 ms | 115.3–142.5 ms | 90.2% |
| 创建到模型请求 | 3344.7 ms | 630.2 ms | 548.2–703.9 ms | 81.2% |

各列分别计算中位数，阶段中位数不必相加等于总时长中位数。五次全部低于一秒，但样本数量不足以声明 P95。各阶段及最终[原始计时样本](./session-startup-optimization-2026-09-23.samples.json)一并保留。

验证结果：

- 修改前的 Desktop 流程回归明确失败：期望预览与首轮合计最多 2 次资源校验，实际为 8 次；修改后通过。
- 资源更新、删除、AGENTS.md 更新、旧回合快照、刷新失败/取消后重试、插件重配置、指纹并发上限、符号链接去重和循环、取消后清理均有自动化覆盖。
- `bun run test:changed -- packages/coding-agent/src/composition/turn/capability-session-assembly.ts packages/coding-agent/src/model-context/prompt-snapshot.ts packages/coding-agent/src/resources/runtime/skill-resource-state.ts apps/desktop/src/main/agent-runtime/session-startup-performance.test.ts`：Coding Agent 1334 项通过、3 项跳过；Desktop Runtime 48 项通过。
- 该整包运行中 CLI 19 项失败，主要表现为 RPC/子进程超时；停止并行检查后以 `--maxWorkers=1` 复跑 `agent-print-mode`、`agent-runtime-provider-contract`、`agent-runtime-selection`、`installed-artifact-runtime` 四个文件，50 项全部通过。没有提高测试超时或修改 CLI 实现。
- Desktop 整包 3683 项通过、20 项失败、11 项跳过。本次相关的生产会话合同 4 项、能力合同 3 项、模型请求合同 11 项以及新增普通对话流程均通过，覆盖工具循环、持久化/恢复和工作目录隔离。
- Desktop 整包仍非全绿：多个现有远程测试把 Windows 本机临时路径拼为 SSH URI，在路径解析阶段失败；另有设备在线状态的时序断言和命令进程超时。单 worker 复跑远程资源与设备在线状态两个文件，前述路径解析及在线状态断言仍失败，2 项通过、2 项失败；这些失败点没有本次代码修改，不在此次性能修复中改写。
- 最终 `bun run check` 全部通过，包括 lint、根/CLI/Desktop/文档类型检查和架构守卫；发布说明校验、报告链接检查及 `git diff --check` 通过。初轮 `check:quick` 的格式问题已经修正。
- 未操作运行中的 Desktop，未调用真实 Provider，未执行 `verify:ui:*`。没有测量真实 UI、外部插件/MCP、远程磁盘或应用冷启动；这些场景仍需独立验证，不能由本次数据推算。

发布说明已补入 [.github/release-notes/v0.5.59.md](../../../.github/release-notes/v0.5.59.md)。

## 复现方法

在仓库根目录运行：

```powershell
$env:VETTA_STARTUP_BENCHMARK_RUNS = '5'
bun scripts/quality/run-vitest.mjs --config apps/desktop/vitest.config.ts --run --maxWorkers=1 apps/desktop/src/main/agent-runtime/session-startup-performance.test.ts
Remove-Item Env:VETTA_STARTUP_BENCHMARK_RUNS
```

输出 `[startup-benchmark]` 为安全的计时数值。`refreshMs` 是各次刷新调用的等待时长之和，优化前并发调用会在串行队列里等待，不能把它与创建时间相加，也不能作为独占 CPU 时间。

源码与测试：

- [资源准备所有者](../../../packages/coding-agent/src/composition/turn/admitted-prompt-resources.ts)
- [资源准备装配](../../../packages/coding-agent/src/composition/turn/capability-session-assembly.ts)
- [指纹扫描](../../../packages/coding-agent/src/resources/runtime/skill-resource-state.ts)
- [Desktop 常用流程与基准](../../../apps/desktop/src/main/agent-runtime/session-startup-performance.test.ts)
- [资源快照与失败恢复测试](../../../packages/coding-agent/test/runtime-core/admitted-prompt-resources.test.ts)
- [指纹并发、取消、别名测试](../../../packages/coding-agent/test/skill-fingerprint.test.ts)
