# 第 80 轮：IM Sidecar Runtime 显式接入与可执行入口闭包

## 1. 本轮目标

把第 78 轮已经具备的 Runtime Selector 真正接入 Desktop → IM Gateway → Agent RPC 子进程生产链路，同时
保持现有功能默认不变。

成功标准：

1. Desktop IM 宿主未配置时继续启动 Legacy。
2. 只有显式选择 `greenfield-im` 时才请求 Greenfield。
3. Windows、macOS、Linux 最终都经过同一个 `cli-app` Runtime Selector。
4. Greenfield 启动条件不满足并 fallback 时，宿主能够区分“请求的后端”和“实际运行的后端”。
5. 不提前切换 Desktop 主对话 Runtime，也不制造只能看见、不能打开的 Greenfield 会话。

## 2. 实施前发现的入口绕过

第 78 轮新增了独立 `agent-rpc-cli.ts` 和 `--agent-runtime`，但生产 IM 链路仍有两个绕过点：

- macOS/Linux 通过 Electron `--agent-rpc` 进入 `agent-rpc-command.ts` 后，直接调用
  `@vetta/coding-agent.main()`。
- Windows 的 `agent-rpc-cli.mjs` 由 `coding-agent/dist/cli.js` 打包生成。

这意味着只在 IM Gateway 增加 `--agent-runtime greenfield-im` 不会形成完整接入：参数最终会落到不认识
该选项的 Legacy CLI，而不是 Runtime Selector。

## 3. 采用的边界

本轮把职责固定为：

```text
Desktop IM Composition
  └─ requested runtimeBackend（启动期不可变）
      └─ IM Gateway host protocol
          └─ local hostclient 追加 --agent-runtime
              └─ cli-app Runtime Selector
                  ├─ Legacy
                  └─ Greenfield IM → 必要时 Legacy fallback
                      └─ get_state.runtimeBackend（实际后端）
```

关键约束：

- Desktop 只决定请求哪个 Runtime，不实现选择或 fallback 算法。
- Go Sidecar 只透传类型化配置并观察结果，不了解 Greenfield 的组装细节。
- `cli-app` 是 Runtime Composition Root 和选择策略的唯一事实源。
- 平台分支只处理可执行文件形态、Electron discriminator 和 stdio 差异，不再决定 Runtime。

## 4. 实际修改

### 4.1 Desktop 显式 opt-in

`CodingAgentSpec` 新增 `runtimeBackend: "legacy" | "greenfield-im"`。

当前灰度入口为：

```text
VETTA_IM_AGENT_RUNTIME=greenfield-im
```

未设置、空字符串或显式 `legacy` 均选择 Legacy；其他值直接报错，不静默猜测。构造函数同时保留类型化
`runtimeBackend` 参数，后续接入持久化设置时无需改变 Sidecar 协议。

这里没有引入 TypeBox/Zod：该边界只是一个两值字符串 discriminator，显式解析函数已能完整覆盖输入空间；
额外 schema 层不会增加有效安全性。复杂 RPC Frame 仍继续使用既有 TypeBox 校验。

### 4.2 三平台统一 Runtime Selector

- Electron `--agent-rpc` 改为调用 `@vetta/cli-app.runAgentRuntimeCli()`。
- Windows staged `agent-rpc-cli.mjs` 改由 `cli-app/src/agent-rpc-cli.ts` 打包。
- `@vetta/cli-app` 加入 Desktop workspace 依赖。
- Desktop TypeScript source path map 补齐 `cli-app` 及其直接 Runtime 依赖，避免独立 Desktop `tsc`
  错误读取陈旧 `dist/*.d.ts`。

最终各平台 argv 仍保留原有模型、scenario、sandbox、`ELECTRON_RUN_AS_NODE` 和资源目录行为；变化只在入口
从 Legacy CLI 收敛到 Runtime Selector。

### 4.3 请求后端与实际后端分离

RPC `get_state.data` 新增必填 `runtimeBackend`：

- `LegacyRpcSessionAdapter` 返回 `legacy`。
- `GreenfieldImRpcSessionAdapter` 返回 `greenfield-im`。
- Greenfield 启动 fallback 后实际使用 Legacy Adapter，因此自然返回 `legacy`，不需要在选择器中伪造状态。

IM Gateway 在握手时读取该字段，并通过结构化宿主日志上报：

- `requestedRuntimeBackend`
- `actualRuntimeBackend`

这样可观察性反映实际会话所有者，而不是仅记录启动参数。

### 4.4 兼容性

`hostclient/local.Options.RuntimeBackend` 为空时不追加 `--agent-runtime`。因此独立 `im-gateway start`
仍可指向旧式、直接的 coding-agent 可执行文件；只有 Desktop 注入的新 `CodingAgentSpec` 使用选择器参数。

## 5. 测试

新增或补充的门禁：

1. Desktop：
   - 默认 Legacy、显式 Greenfield、非法值 fail closed。
   - Windows 可执行 prefix 与 Runtime 配置分离。
   - Electron `--agent-rpc` 实际调用共享 Runtime Selector。
   - 打包脚本从 `cli-app/src/agent-rpc-cli.ts` 生成 Windows RPC 入口，不再引用 Legacy CLI。
2. Coding Agent / CLI App：
   - Legacy 与 Greenfield Adapter 分别报告实际 `runtimeBackend`。
   - 既有真实 Selector 子进程测试继续验证 fresh/resume、ownership conflict 和 Legacy fallback。
3. IM Gateway：
   - Go host protocol 解码 `runtimeBackend`。
   - local hostclient 确认请求 Greenfield、实际 Legacy 的 handshake 观察结果。
   - host command 编译测试验证 Desktop → local Options 接线。

## 6. 明确未修改

- Desktop 主对话 `RuntimeHost` 仍使用 Legacy。
- Desktop Session Catalog、open/resume、rename/delete 没有提前接入 Greenfield 文件。
- 没有切换默认 Runtime。
- 没有删除 Legacy、旧会话格式或旧 RPC 能力。
- 没有改变 Tool、Prompt、Skill、MCP、Memory、Provider、模型选择或 IM 消息功能。
- Runtime 选择在一个 Sidecar 生命周期内不可热切换；变更配置需要重启 Sidecar，避免同一进程池混用后端。

## 7. 验证结果

定向验证：

```text
packages/desktop-app:
  bunx vitest --run src/main/im-host/coding-agent-spec.test.ts

packages/coding-agent:
  bunx vitest --run test/rpc/legacy-rpc-session-adapter.test.ts test/rpc/rpc-command-dispatcher.test.ts

packages/cli-app:
  bun run typecheck
  bunx vitest --run test/greenfield-im-rpc-adapter.test.ts test/agent-runtime-selection.test.ts

packages/im-gateway:
  go test ./internal/hostclient/local
  go test ./internal/hostproto
  go test ./cmd/im-gateway

repository root:
  bun run check:quick
  bunx tsc --noEmit -p packages/desktop-app/tsconfig.json
  bun run check
```

结果：22 项 TypeScript 定向测试、3 个 Go 定向 package、CLI 独立类型检查、Desktop 独立类型检查、
`check:quick` 与完整 `check` 全部通过。

## 8. 下一步

下一阶段应把“宿主会话能力闭包”作为一个完整阶段：

1. 为 Desktop Session Catalog 定义 Legacy/Greenfield 中立的会话描述合同。
2. 一次性接通 list/open/resume/rename/delete，不能只增加列表可见性。
3. 用真实 Desktop Sidecar 启动路径验证 crash/restart、fallback、会话锁释放和模型 Tool Loop。
4. 这些门禁通过后，再讨论扩大 `greenfield-im` 灰度范围；默认值仍不应在同一阶段切换。
