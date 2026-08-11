# 第 54 轮：Runtime Core 依赖倒置与显式生产组合

## 目标

在接入真实 Greenfield Composition Root 前，先修正包级依赖方向：

```text
错误：runtime-core ──> coding-agent

目标：coding-agent ──> runtime-core
      desktop-app ──> RuntimeHost + coding-agent Legacy Adapter
```

本轮只移动实现归属和组合责任，不改 Session、历史、工具、沙箱、模型或宿主交互行为。

## 分析结论

### 1. `runtime-core` 中混入了三类不同所有权

- Runtime-owned 合同：会话创建请求、Assembly、Session Port、观察事件和沙箱授权合同。
- Coding Agent 兼容实现：`AgentSession`、`SessionManager`、`ModelRegistry`、工具工厂和
  `ExtensionUIContext` 的适配。
- 产品组合默认值：RuntimeHost 在构造器内自行选择 Legacy Backend、Catalog、History Reader
  和 Shared Model Controller。

第一类属于内核；第二类属于 `coding-agent` Adapter；第三类必须由应用 Composition Root 决定。
把三者放在 `runtime-core` 会让内核反向依赖产品实现，并使所谓“可替换 Backend”只停留在接口表面。

### 2. 通用词汇应由下层合同拥有

`ConversationScenario`、`PromptResourceRef` 和 `PromptAttachmentRef` 被 Runtime 合同和 Coding Agent
共同使用，因此改由 `runtime-core/contracts` 定义，Coding Agent 只兼容性重导出。它们不包含
Coding Agent 实现细节，不应由上层产品包拥有。

### 3. 沙箱授权与沙箱工具不是同一层

授权缓存、拒绝路径、授权决策和 AsyncLocalStorage grant 是通用运行时策略，保留在
`runtime-core/sandbox`。read/write/edit/bash 工具包装、平台工具工厂和旧
`ExtensionContext` 适配依赖 Coding Agent 工具实现，移动到
`coding-agent/adapters/runtime-core/execution-mode`。

### 4. 当前不需要 TypeBox 或 Zod

本轮边界都是进程内、由 TypeScript Composition Root 直接构造的对象，没有解析 JSON、插件声明或
外部输入。引入运行时 Schema 只会重复静态类型。以后若 Backend 选择来自配置文件或 IPC payload，
应在那个外部输入边界使用 TypeBox；不在内部 Port 之间重复校验。

## 已实施

### Runtime Core

- `RuntimeSessionBackend` 只保留泛型工厂合同；`RuntimeHostSessionBackend` 只接收
  Runtime-owned 创建请求并返回 Runtime-owned Assembly。
- 删除生产源码对 `@vetta/coding-agent` 的全部导入和生产依赖。
- `RuntimeHost` 不再在构造器内实例化 Legacy Backend、Catalog、History Reader 或
  Shared Model Controller；创建/目录/文件读取发生时若缺少对应组合，返回明确 Runtime Error。
- 独立保留 Greenfield 事件映射、Session Port、模型运行时和 Conversation 合同。
- 新增 `@vetta/runtime-core/sandbox` 子入口，暴露实现无关的授权合同和 grant 生命周期。

### Coding Agent Adapter

- 新增 `@vetta/coding-agent/runtime-host` 子入口。
- Legacy Session Backend、Session Port、事件映射、历史转换、Catalog、文件历史读取和共享模型控制
  全部上移到 `coding-agent/src/adapters/runtime-core`。
- 平台沙箱工具构造与 workspace guard 同步上移；运行时授权决策通过
  `@vetta/runtime-core/sandbox` 注入。
- 新增 `createLegacyRuntimeHostOptions()`，一次显式组装完整旧运行时依赖。

### Desktop Composition Root

Desktop 继续创建同一个共享 `RuntimeHost`，但现在先调用
`createLegacyRuntimeHostOptions()` 显式选择 Legacy 实现。共享 `ModelRegistry`、远端 URL、
Skill 路径、沙箱二进制和用户提问 handler 均按原路径注入，产品行为不变。

### 结构门禁

包边界检查从“部分 Greenfield 文件不得导入 Coding Agent”升级为：

> `packages/runtime-core/src/**` 任何生产文件都不得导入 `@vetta/coding-agent`。

测试可以引用 Compatibility Adapter；生产内核不可以。

## 兼容性处理

- Desktop 生产入口继续使用 Legacy Backend，没有切换 Greenfield。
- 旧 Session JSONL、历史分支、turn timing、事件、模型选择、沙箱工具和动态重配置合同继续由原测试验证。
- `runtime-tools` 与 `runtime-storage` 包根的旧代理导出继续保留。本轮没有为了消除依赖而删除公开功能；
  它们必须等真实实现迁移并建立等价兼容门面后再处理。
- `RuntimeHost` 的直接 SDK 使用者现在需要显式注入 Session Composition；应用内现有生产入口已经完成迁移。

## 测试

新增或调整的验证包括：

- 未注入 Session Backend 时给出明确错误，避免静默回落具体实现。
- `createLegacyRuntimeHostOptions()` 必须交付 Backend、Catalog 和文件历史读取器。
- Legacy create-only Backend 到 Runtime Assembly 的映射保持不变。
- Legacy Session Port、事件、历史、模型、宿主交互、后台工作和沙箱重配置行为继续通过。
- 包边界门禁验证任意 `runtime-core/src` 文件导入 Coding Agent 都会失败。

验证结果：

- `packages/runtime-core`：24 个测试文件、112 项测试全部通过。
- `packages/runtime-storage`：4 个测试文件、25 项测试全部通过。
- 包边界质量测试：22 项测试全部通过。
- `bun run check:quick` 通过。
- 根目录 `bun run check` 通过，包括 Biome、全仓 `tsgo`、Desktop 独立 `tsc`、Admin `tsc -b`
  和质量守卫。
- Coding Agent 新增 Composition 测试通过；全包测试在当前 Windows 环境仍有 80 项既有失败，
  主要来自平台路径、shell、模型 fixture、资源发现和旧 mock，不由本轮改动引入。

## 下一步

下一阶段可以建立真实 Greenfield Runtime Composition Root，但应作为一个完整纵向阶段完成：

1. 在 `coding-agent` 或独立应用组合包中实现 Model Catalog/Credential、Prompt Adapter、
   Repository、Runtime Factory 和 Host Interaction Adapter。
2. 用同一个 `GreenfieldRuntimeModel` 同时注入 Session Assembly 与 Turn Pipeline。
3. 先增加并行入口和 Legacy/Greenfield 行为差分，不直接替换 Desktop 默认入口。
4. 补齐剩余 Host Interaction、Execution、Configuration、Todo 和 Background Work 能力后，
   再评估灰度切换。

`runtime-tools` / `runtime-storage` 的包根兼容代理应单独安排后续迁移，不与 Greenfield 组合根接入混在
同一轮，也不能用删除导出来伪造“依赖已清理”。
