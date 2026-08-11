# 第 113 轮：标准安装产物运行时边界收口

## 目标

在不改变产品功能和默认 Runtime selector 的前提下，使用仓库标准的单文件 CLI 安装产物验证：

- Legacy 与 Greenfield `im-claw` 的完整 Provider Frame 和稳定 RPC 生命周期语义。
- 真实 read/MCP Tool Loop、跨 OS 进程会话恢复和 owner lock 清理。
- 同一已安装 Greenfield Session 内 Skill/MCP 的运行时新增、修改和删除。

## 实施假设

- `packages/cli-app/scripts/compile-standalone.mjs` 是唯一标准独立产物编译入口，不另建测试专用打包流程。
- `greenfield-im` 当前只接受 `im-claw`；本轮不以测试为由扩大场景支持。
- RPC 兼容性沿用既有宿主观察合同。Legacy 额外 progress Frame 不是 Greenfield 必须复制的产品语义。
- 默认 selector 保持 Legacy；本轮只闭合切换前证据，不执行默认切换。

## 修改

### 标准安装产物差分

扩展 `packages/cli-app/test/installed-artifact-runtime.test.ts`：

- 编译一次标准 standalone CLI，再复制到隔离安装目录。
- 校验 metafile 后删除编译期仓库路径，避免测试运行时依赖源码树。
- 从同一安装产物分别启动 Legacy 与 `greenfield-im` 真实 RPC 进程。
- 从真实 OpenAI Responses HTTP 请求捕获完整 Provider body。
- 仅归一化 fixture 路径、回合时间和非稳定缓存键，逐项比较 input、系统提示词及 Tool 的名称、顺序、
  描述和 Schema。
- 比较 agent/turn 生命周期、累计 text delta、final text、Tool 结果和 session path change。

### 跨进程恢复

保留并加强既有安装产物恢复测试：

- 第一个 OS 进程执行真实 read Tool Loop。
- 关闭进程并确认 owner lock 释放。
- 第二个独立 OS 进程仅通过 session path 恢复同一 session identity。
- 恢复后执行真实 MCP Tool Loop，并检查持久历史和最终锁清理。

### 动态 Skill/MCP

新增同一已安装 Greenfield Session 的连续变更合同：

1. 初始不存在动态 Skill 和 MCP Tool。
2. 新增默认项目 `.vetta/skills` Skill，下一 Model Call 可见。
3. 修改 Skill 内容，下一 Model Call 只出现新内容。
4. 新增 MCP Server，下一 Model Call 出现对应 Tool 与精确描述。
5. 删除 Skill 并移除 MCP Server，下一 Model Call 均不可见。
6. 全过程 session id 和 session path 不变。

### Legacy RPC stdout 边界修复

安装产物门禁发现顶层 CLI 只在选择 Greenfield 时安装 RPC stdout guard。Legacy RPC 加载 Skill 时会将日志
写入 stdout，污染 JSONL 协议。

`run-agent-cli.ts` 现在对所有 `--mode rpc` 请求安装既有 stdout guard，同时保留 Greenfield 当前的提前保护。
非 RPC Legacy 路径没有变化。

## 明确未修改

- 没有切换默认 Runtime selector。
- 没有扩展 `greenfield-im` 的场景范围。
- 没有修改 Tool 名称、描述、Schema、执行结果或副作用。
- 没有修改会话持久化格式。
- 没有删除 Legacy 实现或公开兼容入口。
- 没有新增测试专用构建流程。

## TypeBox / Zod 判断

没有新增 Schema。标准产物 metafile 继续使用既有 Zod 外部边界校验；RPC 和 Provider 测试数据已经经过现有
协议类型约束。为进程内观察对象重复增加 TypeBox/Zod 不会提高边界安全性。

## 验证

- `bun run verify:artifact:installed`
  - 1 个测试文件、3 项测试通过。
  - 覆盖安装产物 Provider/RPC 差分、跨进程恢复和动态 Skill/MCP。
- `bunx vitest --run test/agent-runtime-selection.test.ts test/agent-runtime-provider-differential.test.ts`
  - 2 个测试文件、10 项测试通过。
- `bun run check:quick` 通过。
- `bun run check` 通过，覆盖 Biome、root tsgo、CLI 类型检查、Desktop tsc、Admin 检查和质量守卫。

## 下一步

进入默认切换准备度审计：枚举所有生产 selector、公开 Legacy API 消费者和旧存储写路径，建立逐入口 canary、
诊断及回滚清单。在该清单清零并形成单独切换决策前，默认值继续保持 Legacy。
