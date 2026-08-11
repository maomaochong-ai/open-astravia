# 142：Extension Profile 与真实 CLI 切换门禁

## 目标

把 Greenfield IM 的 Extension 选择从“当前数组恰好列全”收口为可由 TypeScript 穷尽校验的宿主
Profile，并通过真实 RPC CLI 进程证明：

- 已支持的 Event、Tool、Command 组合不回退；
- RPC 没有承载面的 UI 注册不回退；
- 未知或未来事件继续安全回退 Legacy，且回退原因可观察；
- Runtime 决策诊断不污染 JSONL stdout。

## 分析结论

### 1. 事件支持状态属于宿主 Profile

`ExtensionEvent` 定义合法事件全集，coding-agent 兼容性层只定义三态合同：

- `supported`：宿主无损承载；
- `unsupported`：宿主应该承载但当前存在缺口；
- `inapplicable`：当前宿主没有对应交互面。

具体状态由 CLI Composition Root 声明。Greenfield IM RPC 把 28 个已接通事件标为 `supported`，把
`user_bash` 标为 `inapplicable`。`satisfies Record<ExtensionEvent["type"], ...>` 使新增合法事件而未更新
Profile 时直接产生类型错误，避免默认落入错误支持路径。

### 2. 未知事件必须保留 forward-compatible 回退

Extension Loader 的注册表在运行时仍可能出现比当前 TypeScript 联合更晚的事件。兼容性解析不能因
Profile 穷尽而假定输入永远已知；不在 Profile 中的字符串统一按 `unsupported` 处理，继续返回
`legacy-extension`。这使旧客户端加载未来 Extension 时失败关闭，而不是静默丢事件。

### 3. Runtime 决策诊断属于 stderr

RPC stdout 是纯 JSONL 协议，不能混入切换日志。`AgentRuntimeDecision` 新增结构化 Extension 回退诊断：

- `unsupportedEvents`；
- `unmetRuntimeCapabilities`。

标准决策输出只在 stderr 追加 `unsupportedEvents` 与 `unmetCapabilities`。Legacy Session 等非
Extension 回退不伪造这些字段。

## 实施内容

### coding-agent

- 从 `ExtensionEvent["type"]` 派生公开的事件类型、三态和穷尽 Profile 类型。
- `CodingAgentGreenfieldExtensionHostCapabilities` 改为消费 `eventProfile`，不再组合“支持数组 +
  不适用数组”。
- 兼容性解析按 Profile 分类已知事件，并把未知事件归类为 `unsupported`。
- 保留 `CODING_AGENT_GREENFIELD_EXTENSION_EVENTS` 兼容导出，并用测试校验它与 supported 状态一致。

### CLI Composition Root

- 新增并公开 `GREENFIELD_IM_EXTENSION_EVENT_PROFILE`，完整声明全部合法事件。
- Greenfield IM Host 使用 Profile 解析 Extension 能力。
- Runtime 选择决策携带结构化 Extension 回退诊断，stderr 输出具体事件和能力缺口。

### 真实 CLI 门禁

真实 RPC CLI 子进程新增三条切换用例：

1. 同时注册 `session_start`、Tool 和 Command 的 Extension 进入 Greenfield；
2. 只注册 Shortcut、Message Renderer、`user_bash` 的 Extension 仍进入 Greenfield；
3. 注册 `future_event` 的 Extension 回退 Legacy，stderr 同时包含 `future_event` 和
   `event-handler`。

三条用例都先通过真实 `get_state` 建立会话，证明测试覆盖启动与 Session Host，而不只是调用纯选择
函数。进程测试继续检查 stdout 可被严格解析为 JSONL Frame。

## 功能兼容性

本轮没有修改 Extension 注册 API、Event payload、Tool/Command 执行、RPC Frame 或 Session 格式。
Greenfield/Legacy 的功能选择结果保持如下：

- 已实现 Extension 能力继续运行于 Greenfield；
- RPC 不适用能力继续不执行，也不造成无意义回退；
- 未知或真实缺失能力继续回退 Legacy；
- `legacy-session` 与 `unsupported-session-selection` 行为不变。

## Schema 决策

没有引入 TypeBox 或 Zod。新增 Profile 是编译期 TypeScript 合同，Runtime 决策是进程内对象；没有新增
外部输入、网络协议或持久化格式。RPC stdout 仍沿用既有 TypeBox 校验边界。

## 测试

通过的验证：

```text
bunx vitest --run test/extension-compatibility.test.ts（coding-agent，8 项）
bunx vitest --run test/agent-runtime-selection.test.ts（cli-app，8 项）
bunx vitest --run test/greenfield-im-runtime-host.test.ts（cli-app，16 项）
bun run check:quick
bun run check
git diff --check
```

## 结果

Greenfield IM Extension 切换已经具备静态完备性、运行时 forward compatibility 和真实进程门禁。
`legacy-extension` 不再代表某个已知注册被遗漏；在当前 Profile 下，它只表示未知/未来事件或真正未满足
的运行时能力。

## 下一步

下一阶段应完成安装产物级的默认切换门禁：使用标准安装后的 Vetta CLI 验证相同 Extension Profile，
随后把 IM/RPC 的默认选择从 Legacy 调整为 Greenfield，同时保留显式 `--agent-runtime legacy`、旧会话
格式回退和未知 Extension 回退。默认值切换应与安装产物测试放在同一阶段，避免只修改选择器常量。
