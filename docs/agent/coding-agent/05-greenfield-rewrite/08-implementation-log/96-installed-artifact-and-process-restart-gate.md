# 第 96 轮：独立安装产物与进程重启恢复门禁

## 1. 目标

第 95 轮验证了 `@vetta/runtime-composition` 的 `dist` 闭包和真实 Desktop 主进程 Canary，
但 CLI 仍由源码入口驱动测试，未证明 Desktop 实际分发的单文件可执行程序能够在源码不可见时：

- 启动 Greenfield IM Runtime；
- 从宿主目录读取模型、认证、Skill 与 MCP 配置；
- 执行内置工具和外部 MCP 工具；
- 退出后释放会话所有权；
- 由新的 OS 进程恢复同一会话并继续执行。

本轮把这些要求合并成一个发布级门禁，不修改 Tool、Prompt、Skill、MCP 或会话的业务语义。

## 2. 真实产物探针暴露的问题

按 Desktop 打包使用的 `bun build --compile` 方式编译 `packages/cli-app/src/cli.ts` 后，探针发现两处
此前源码测试无法覆盖的问题。

### 2.1 顶层 CLI 不能进入 Agent

旧 `run-cli.ts` 收到 Agent 命令后会派生：

```text
process.execPath ./agent-cli.js
```

在单文件 Bun 产物中，`process.execPath` 已是 `vetta` 自身，而文件系统中不存在 `agent-cli.js`。
因此顶层帮助可以运行，`vetta agent --help` 却会挂起并异常退出。

修复方式：

- 新增薄入口 `run-agent-cli.ts`；
- 顶层 `run-cli.ts` 静态组合并在同一进程调用 Agent；
- 原 `agent-cli.ts` 继续复用同一入口，保留独立 bin 的兼容性；
- Greenfield 仍在进入 Runtime 前安装 RPC stdout guard。

这使编译器能够把 Agent Runtime 的依赖闭包真正包含进单文件产物，同时不再依赖产物旁的源码文件。

### 2.2 Coding Agent 元数据依赖相邻 `package.json`

单文件产物启动 Agent 后，`coding-agent/config.ts` 会从可执行文件所在目录读取 `package.json`。
但 Desktop 的平台二进制位于 `cli-app/bin/<platform>/`，Windows 安装过程还会只复制
`vetta.exe` 到用户 bin 目录，因此这个隐式文件依赖并不成立。

修复方式：

- 新增唯一的 `scripts/compile-standalone.mjs`；
- 编译脚本读取 Coding Agent package metadata，并通过 Bun `--define` 嵌入产物；
- 普通 Node/Bun 源码和 `dist` 运行仍优先读取原 package metadata；
- 只有 Bun 单文件产物在相邻文件不存在时使用编译期元数据；
- Desktop 打包和开发 CLI shim 均调用同一编译脚本，测试、开发与正式产物不再各自维护编译参数。

这不是把宿主配置固化进内核。嵌入的只有包名、应用名和版本；模型、凭据、Prompt、Skill、MCP、
Tool 激活与会话数据仍在运行时由宿主目录提供。

## 3. 发布级门禁

新增命令：

```powershell
bun run verify:artifact:installed
```

门禁执行以下真实链路：

1. 使用正式编译脚本和当前平台的正式 Bun target 编译 `cli.ts`；
2. 解析 Bun metafile，使用 Zod 校验外部数据结构，并拒绝 external runtime import；
3. 只把可执行文件复制到独立安装目录，安装目录不包含源码、metafile 或 `package.json`；
4. 构造完全位于系统临时目录的 HOME、workspace、agentDir 与 conversationDir；
5. 清理继承环境中的仓库路径，直接启动安装目录中的可执行文件；
6. 由宿主写入 `models.json`、`auth.json`、显式 `SKILL.md` 和 `mcp.json`；
7. 进程 A 完成真实 Provider → `read` → Tool Result → 第二次模型调用；
8. 进程 A 退出，确认 `.owner.lock` 被释放；
9. 进程 B 使用 `--session` 恢复同一 conversation identity；
10. 进程 B 完成真实 Provider → 外部 stdio MCP Tool → Tool Result → 第二次模型调用；
11. 检查 Provider 请求中的 Tool description、Skill marker、工具结果和持久化会话历史；
12. 进程 B 退出，再次确认所有权释放。

门禁验证的是“宿主运行时注入”，不是构建期快照：Skill 与 MCP 均从临时宿主文件加载，两个 OS
进程分别重新装配 Runtime；持久化并跨进程继承的只有会话事实。

## 4. 明确未修改

- 未更改内置工具名称、参数、描述或执行结果；
- 未更改 Skill 发现和显式 `--skill` 行为；
- 未更改 MCP 命名、协议、渐进披露阈值或调用结果；
- 未更改模型解析、认证文件格式或 Provider 协议；
- 未更改 conversation JSONL、session id 或 ownership lock 合同；
- 未切换 Greenfield 默认启用范围；
- 未把运行时 Tool、Prompt、Skill 或 MCP 集合嵌入可执行程序。

## 5. 验证结果

独立产物门禁：

```text
1 file passed
1 test passed
```

CLI Runtime 选择、Provider/Tool Loop 差分与新产物门禁联合回归：

```text
3 files passed
10 tests passed
```

快速质量门：

```text
bun run check:quick
通过
```

完整质量门：

```text
bun run check
Biome、monorepo tsgo、cli-app tsgo、desktop-app tsc、admin tsc 与 guards 全部通过
```

## 6. 结论

当前发布闭包不再等价于“源码 bundle 能运行”，而是：

```text
单一可执行产物
  + 运行时宿主配置
  + 外部 MCP 进程
  + 持久化 Conversation
  -> 新进程可恢复的 Greenfield Agent
```

因此 Coding Agent 内核继续只拥有执行合同和会话事实；模型、Skill、MCP 与工具面由宿主在每个进程
启动时重新组合。下一阶段可在这条门禁稳定后，将同一正式产物接入 Desktop 安装后 Canary，并再评估
Greenfield 默认启用范围。
