# 第 167 轮：真实 CLI Replacement 生命周期联合门禁

## 目标

第 166 轮已经在 Host/Composition 层补齐 Replacement 的 Extension 与 Hook 副作用。本轮把合同提升到真实 Vetta RPC CLI 可执行入口，在同一进程时间线上联合观察：

- TypeScript Extension 的 `session_before_switch`、`session_switch`、`session_before_fork`、`session_fork`、`session_shutdown`；
- 项目级 Codex Hook `SessionStart`；
- 项目级 Claude Hook `SessionEnd`；
- new、switch、fork、取消与 stdin EOF；
- Hook command 非零退出的 best-effort 语义；
- Session id、transcript path、previous/target path 和事件顺序。

本轮仍以“架构重构、功能不变”为约束，不改变 Tool、Prompt、Skill、MCP、Extension 或 Hook 的业务协议。

## 兼容配置边界

当前 Codex Hook profile 不支持 `SessionEnd`，不能为了测试虚构该能力。因此测试使用真实的 Vetta 嵌套配置布局：

- `<cwd>/.vetta/.codex/hooks.json` 记录 `SessionStart`；
- `<cwd>/.vetta/.claude/settings.json` 记录 `SessionEnd`；
- 两类 Hook command 与 TypeScript Extension 写入同一 JSONL 审计文件。

这同时验证了配置来源所有权：Codex Adapter 只消费 `.codex/hooks.json`，Claude Adapter 只消费 `.claude/settings.json`，Runtime/Host 不解析具体生态 wire payload。

## 测试先发现的缺口

### 1. Greenfield CLI 未接入默认 Hook 配置层

通用 `GreenfieldRuntimeComposition` 已支持 `hookConfigLayers`，但 Greenfield IM CLI Composition Root 没有像 Legacy SDK 一样调用 `buildDefaultHookConfigLayers`。结果是进程内测试可以收到 Hook，真实 CLI 的 Greenfield 后端却完全忽略用户和项目配置。

修复位于 `greenfield-im-runtime-host.ts`：Composition Root 负责根据 `cwd` 与 Vetta Home 组装默认配置层，再注入通用 Composition。配置发现没有下沉到 Runtime Core。

### 2. RPC stdin EOF 跳过 `session_shutdown`

共享 RPC transport 的 EOF 清理原先只执行 `dispose()`；只有 Extension 主动调用 `ctx.shutdown()` 时才执行 `shutdown()`。因此 Legacy 正常退出缺少 `session_shutdown`，而 Greenfield 的 Event Host 又在 dispose 时兜底发送，形成后端差异。

修复位于共享 `rpc-mode.ts`：

1. EOF 先 drain 已接收命令与活动工作；
2. EOF 和主动关闭复用同一个 memoized `shutdown()` Promise；
3. `shutdown()` 完成后再 `dispose()`；
4. shutdown 失败仍按既有 best-effort 规则输出错误并继续释放。

后端不再各自决定 transport EOF 的 Extension 生命周期。

### 3. 首次 SessionStart source 不一致

Legacy CLI 在构造 `AgentSession` 前已经写入模型和思考级别元数据，因此首次 `SessionStart` 的既有 source 是 `resume`；Greenfield 通用 Composition 按 storage create 操作产生 `startup`。

为了保留 Legacy 外部行为，没有修改通用 create 语义。CLI Composition Root 通过既有 `sessionHooks.start(sessionId, "resume")` 端口显式应用该宿主兼容规则。

## 固化的真实时间线

测试按以下单一场景运行 Legacy 与 Greenfield：

1. 首次 Prompt：`SessionStart(resume)`；
2. Extension 取消 new：只有 `session_before_switch(new)`，identity 不变；
3. 成功 new：`before_switch → SessionEnd(clear) → session_switch`，目标首次 Prompt 才 `SessionStart(clear)`；
4. switch 回 source：`before_switch → SessionEnd(resume) → session_switch`，目标首次 Prompt 才 `SessionStart(resume)`；
5. fork：`before_fork → SessionEnd(clear) → session_fork`，目标首次 Prompt 才 `SessionStart(clear)`；
6. stdin EOF：`session_shutdown → SessionEnd(other)` 各一次。

测试中的全部 `SessionEnd` command 都先记录输入再以 code 9 退出。new/switch/fork 仍成功、退出码仍为 0，证明生命周期 Hook 失败不会阻断身份替换或资源释放。取消路径没有 SessionEnd、session_switch 或目标 SessionStart。

## 实施范围

- `packages/cli-app/src/rpc/greenfield-im-runtime-host.ts`
  - 注入默认 Vetta 嵌套 Hook 配置层；
  - 通过现有 Session Hook Port 保留 CLI 首次 `resume` 兼容语义。
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts`
  - EOF 与主动关闭统一为一次性 `shutdown → dispose` 生命周期。
- `packages/cli-app/test/agent-runtime-session-lifecycle-side-effects-differential.test.ts`
  - 构建真实 RPC CLI bundle；
  - 创建真实 TypeScript Extension、Codex/Claude 项目 Hook 配置和 command 子进程；
  - 对 Legacy/Greenfield 的完整联合时间线做精确差分。

## 验证结果

- 真实 RPC CLI Replacement 生命周期差分：1 项通过。
- RPC command/shutdown 单元回归：15 项通过。
- `bun run check:quick` 通过。
- 根目录完整 `bun run check` 通过。

## TypeBox / Zod 判断

本轮没有新增生产外部输入格式。Hook JSON 仍由 ecosystem-adapter 既有 Zod schema 解析，RPC frame 仍由既有 TypeBox validator 校验；新增代码只组合已校验配置层和已类型化生命周期端口，因此不重复引入 Schema。

测试审计 JSONL 是测试进程内部生成的数据，并由窄类型守卫读取，不构成生产信任边界。

## 明确未修改

- 没有让 Codex profile 支持其原本不支持的 `SessionEnd`。
- 没有改变 Hook matcher、stdin wire、输出解释或失败策略。
- 没有改变 Extension payload、取消、fork 或 session identity 业务语义。
- 没有把配置解析、Hook command 执行下沉到 Runtime Core。
- 没有引入通用 Event Bus、Middleware 或新的事务框架。
- 没有增加生产故障注入开关。

## 下一步

下一阶段应审计 replacement 已提交后的清理失败语义：`finalize`、previous Session dispose、ownership release 失败时，RPC 是否仍把已提交 target 作为权威 identity，并给出稳定且不伪回滚的可观察结果。应优先使用已有可注入资源 Port 做 Host 单元合同，再选择真实可达的故障做 CLI 门禁，不为不可达故障污染生产接口。
