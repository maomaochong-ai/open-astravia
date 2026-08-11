# 第 137 轮：Greenfield Extension Tool Runtime 与切换门禁

## 目标

在不修改 Extension Tool 业务功能的前提下，把 `registerTool()` 从 Legacy-only 缺口迁移为 Greenfield
可组合能力，并把第 136 轮的真实 CLI 差分提升为稳定 CI 门禁。迁移后仅 Tool 能力不再触发 Legacy
回退；Command、Shortcut 与 Message Renderer 仍保持原回退行为。

## 架构判断

Extension Tool 不应注册进 Runtime Core 的全局 Tool Registry。它依赖 Coding Agent 的
`ExtensionContext`、Session Runner、旧事件拦截和产品 scope，属于调用级产品能力。正确边界是：

```text
Host Bootstrap
  -> Extension registrations
  -> CodingAgentGreenfieldExtensionToolRuntime
  -> Model Call Frame
  -> Plugin MCP / Plugin Tool policy
  -> Extension tool_call / tool_result
  -> Ecosystem Hook
  -> Runtime Tool Loop
```

该 Runtime 在 Composition 生命周期内保存注册定义，在执行时按 `request.sessionId` 找到当前
`ExtensionRunner`。Conversation rollover 只重绑定 Session identity，不重建整套工具定义；子 Agent
不会继承未绑定的父会话 Extension Tool。

## 实施

### 1. 新增 Extension Tool 调用级适配器

`CodingAgentGreenfieldExtensionToolRuntime` 负责：

- 按 Extension 加载顺序合并工具，同名注册保持 Legacy first-wins；
- 复用原 TypeBox `parameters` 作为 Runtime `inputSchema`；
- 透传 `scope_use`、`requires` 与 `category`，缺省 `scope_use` 与 Legacy 一样覆盖全部场景；
- 显式 tools 选择、scope 选择和同名覆盖均在每次 Model Call Frame 物化；
- 通过 Session Runner 创建真实 `ExtensionContext`，透传 signal、progress callback、content 与 details；
- rollover 后把原 Runner 从旧 session id 原子迁移到新 session id。

Extension Tool 不进入共享 Capability Snapshot。只有当前调用的 Frame 会被替换，因此不会把某一
Session 的 Runner 或本地 Extension 实例泄漏给其他 Session。

### 2. 接入最终工具组合顺序

Model Call Composer 先组合 Extension Tool，再组合 Plugin MCP 和 Plugin Tool，最后继续使用现有
Extension Event 与 Ecosystem Hook wrapper。该顺序保留 Legacy 的关键行为：

- Extension Tool 覆盖同名基础/插件工具；
- MCP 仍可按既有顺序覆盖工具表面；
- 未激活的同名 Extension Tool 会隐藏被覆盖的基础工具；
- `tool_call` / `tool_result` 位于真实执行内层，Ecosystem Hook 位于外层；
- Provider 看到的 schema、工具顺序和 Tool Loop 结果仍可做新旧精确差分。

### 3. 宿主能力声明改为显式 descriptor

兼容性解析不再隐式假定 Greenfield 支持哪些能力。宿主必须声明已安装的 actions、events、tools、
commands、shortcuts 与 message renderers。当前 IM Host 明确声明 actions、全部已迁移 events 和 tools：

- Provider/Flag/Event/Tool Extension 可进入 Greenfield；
- Command、Shortcut、Message Renderer 继续返回 `legacy-extension`；
- 以后新增宿主能力时必须先安装实现，再修改 descriptor，不能只删除回退条件。

### 4. 新增稳定切换门禁

根目录新增 `bun run verify:runtime-cutover`，执行 CLI 真实 Provider 差分和 Greenfield Host 组合测试，
并接入 `.github/workflows/quality.yml`。新增 Extension Tool 差分场景比较：

- 首次 Provider 请求中的完整工具 schema 与有序工具表面；
- Extension Runner 提供的 cwd、model 与 idle context；
- progress update 次数；
- Tool Result 进入第二次 Provider 调用；
- RPC 工具执行事件和最终文本；
- Legacy 与 Greenfield 的完整观察结果相等。

## Schema 判断

本轮不新增 Zod。Extension Tool 已有 TypeBox `parameters`，它就是模型工具输入的权威 schema，
Greenfield 直接复用，避免建立第二套校验模型。宿主 capability descriptor 是同进程静态 TypeScript
合同，不是外部 wire 输入；若以后经 RPC 或配置文件传输，再在协议入口增加 TypeBox/Zod 校验。

## 测试

已通过：

- Extension Tool Runtime 与兼容性单元测试：2 个文件、8 个测试；
- Greenfield IM Runtime Host 组合测试：1 个文件、9 个测试；
- 根 TypeScript `tsgo --noEmit`；
- 根 `bun run check:quick`。

真实独立 CLI 差分测试已经写入并纳入 CI。本地 Windows 沙箱中的 Vitest 可正常运行，但其测试内
启动的 `bun build` 子进程读取部分源码时返回 `EPERM`，因此本机没有把该独立产物场景记录为通过；
这不是差分断言或 TypeScript 失败。CI 门禁保留独立产物构建，不以源码直跑替代。

根 `bun run check` 已执行：Biome、质量守卫、根 tsgo、CLI typecheck 与 Desktop typecheck 均通过，
最终在既有 Admin `tsc -b` 阶段因 `packages/admin/node_modules/@types/*` 的多项声明文件缺失而失败。
该依赖安装状态与本轮文件无关，未通过修改类型配置或删除类型引用规避。

## 明确未修改

- 未修改 Extension Tool 的名称、schema、执行参数、结果、进度或错误语义。
- 未修改 Legacy Runtime、Extension Loader 或注册 API。
- 未把 Extension、SessionManager、Runner 或 UI 类型下沉到 Runtime Core。
- 未移除 Command、Shortcut、Message Renderer 的 Legacy 回退。
- 未把运行期工具变化改成永久全局快照；当前调用继续读取当前激活策略。

## 结果与下一步

Extension Tool 已从“因为架构缺口被迫回退”变为 Coding Agent 调用级能力，核心 Runtime 仍只依赖
通用 Tool 合同。下一阶段应迁移 Extension Command：先定义格式中立的 Host Command 合同和 RPC
发现/执行边界，再做真实 CLI 差分；Shortcut 与 Message Renderer 属于具体 UI Host，应留在宿主层，
不应为了消除回退而塞入 Agent 内核。
