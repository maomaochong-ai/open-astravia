# 第 200 阶段：Runtime Tool Port Closure

## 阶段目标

第 199 阶段建立 Runtime Tool Surface 后，`GreenfieldRuntimeComposition` 仍把完整的 `CodingToolsRuntimeComposition` 暴露给宿主。生产 RPC Adapter 实际只使用其中的 Registry，但公共合同同时泄漏了 Profile、Compiler、Command Executor、Background Service 与 dispose 等内部组合对象。

本阶段关闭该具体实现泄漏：保留 `runtime.tools.registry` 调用路径与全部动态工具行为，只把公共合同及组合返回类型收窄到已有的 `CodingToolRegistry` 抽象。

## 实施前分析

`@vetta/runtime-tools/coding` 已经提供完整的 `CodingToolRegistry` Port，包含：

- `register()`；
- `activate()`；
- `deactivate()`；
- `revoke()`；
- `unregister()`；
- `snapshot()`；
- `resolve()`；
- `execute()`。

因此不需要再创建 Coding Agent 专用 Registry 接口，也不需要改变动态工具生命周期。`InMemoryCodingToolRegistry` 继续作为默认 Adapter，由 Runtime Tools Composition Root 选择和实例化。

仓库生产消费者中，只有 Greenfield RPC Session Adapter 通过 `runtime.tools.registry` 注册和注销宿主 Tool；没有生产宿主使用完整 Tools Composition 的 Profile、Compiler、Command Executor 或 dispose。

## 实施过程

### 1. 收窄 Runtime Tools Composition 合同

修改：

`packages/coding-agent/src/composition/runtime-tools-composition.ts`

`CodingToolsRuntimeComposition.registry` 的声明类型由具体 `InMemoryCodingToolRegistry` 改为 `CodingToolRegistry`。工厂内部仍创建同一个 `InMemoryCodingToolRegistry`，初始工具、状态机、版本号、Binding revision 与执行撤销行为均未修改。

### 2. 建立宿主 Tool Access Port

修改：

`packages/coding-agent/src/composition/greenfield-runtime-composition-contract.ts`

新增：

```ts
export interface GreenfieldRuntimeToolAccess {
  readonly registry: CodingToolRegistry;
}
```

`GreenfieldRuntimeComposition.tools` 现在只暴露该 Port，不再暴露完整 `CodingToolsRuntimeComposition`。

调用路径继续保持为 `runtime.tools.registry`，所以现有 RPC 注册、测试控制和宿主清理逻辑不需要迁移。Composition 内部仍持有完整 Tools Composition，用于 Profile、Compiler、Session 初始化和最终 dispose。

### 3. 公开中性 Port 类型

通过以下既有出口 re-export `GreenfieldRuntimeToolAccess`：

- Coding Agent Composition 入口；
- Coding Agent Composition package index；
- CLI Composition forwarding entry；
- CLI package index。

宿主和测试现在可以只依赖该窄接口构造 fixture，不必了解内部 Tools Composition。

### 4. 增加架构守卫

修改：

- `scripts/quality/check-package-boundaries.mjs`；
- `scripts/quality/quality-gates.test.mjs`。

守卫要求：

- Greenfield 公共 Composition 合同不得依赖 `CodingToolsRuntimeComposition`；
- 公共 Tool Access 不得暴露 `InMemoryCodingToolRegistry` 或 `FeatureCompiler`；
- `CodingToolsRuntimeComposition.registry` 必须声明为 `CodingToolRegistry`；
- 具体内存 Registry 只允许留在组合工厂实现中。

## 功能兼容性核对

- `runtime.tools.registry` 属性路径未改变；
- RPC 宿主 Tool 注册及 Adapter dispose 注销未改变；
- 动态注册和注销仍在下一次模型调用生效，不重建 Session；
- activate、deactivate、revoke 与 in-flight execution 行为未改变；
- Registry snapshot 的版本化和缓存行为未改变；
- MCP 动态注册、渐进披露和 Knowledge Tool 注册未改变；
- Tools Profile、Compiler、Command Executor 与 Background Service 仍由 Composition 内部使用和释放；
- `InMemoryCodingToolRegistry` 没有被替换或包装，没有引入额外快照；
- 运行时 API 和功能不变，公共 TypeScript 类型不再允许宿主通过 Composition 访问内部 Tools 实现字段。

## 类型校验选择

本阶段没有引入 TypeBox 或 Zod。变更只涉及进程内 TypeScript Port，不解析 JSON、RPC payload、配置文件、持久化数据或 MCP wire input。

## 验证结果

Runtime Tools Registry 状态机：

```text
1 file passed
14 tests passed
```

CLI Runtime Tools、Greenfield Composition 与 RPC Host Tool 生命周期：

```text
3 files passed
38 tests passed
```

质量守卫：

```text
1 file passed
48 tests passed
```

仓库检查：

```text
bun run check:quick 通过
bun run check 通过
Biome 2078 files 通过
Monorepo、CLI、Desktop、Admin 类型检查通过
全部 quality guards 通过
```

## 阶段结论

动态工具现在通过稳定 Registry Port 暴露给宿主，具体内存 Registry 与完整 Tools Composition 留在 Composition 内部。该结构保留了运行时可变性，同时阻止宿主依赖工具编排和生命周期实现。

下一阶段建议提取 Composition Root 中的 Child Composition Policy。该策略目前仍直接负责移除父级共享 MCP Source、Plugin MCP Factory 与 Extension Tools，关闭递归 Subagent，并投影父级 MCP Tool View；这些是独立且需要测试保护的子 Session 隔离规则。
