# 第 115 轮：Composition 所有权与依赖图收口

## 目标

完成第 114 轮提出的依赖所有权审计中的第一项实际收口：

- 让 Coding Agent 产品级 Composition 归属 `coding-agent`。
- 保留 `runtime-composition` 已公开 API 的兼容行为。
- 消除 clean build 被旧根入口兼容转发形成的隐式循环。
- 用依赖声明和结构守卫防止边界再次退化。

## 实施假设

- Greenfield Composition 选择 Coding Prompt、Knowledge、Subagent 和产品 Tool 策略，因此属于
  Coding Agent 产品层，不属于中立 Runtime 基础设施。
- `runtime-composition` 和 Runtime 包根均可能有仓库外消费者，不能因为仓库内引用减少就删除导出。
- 本轮只改变文件所有权、依赖声明和装配入口，不改变任何 Runtime、Tool 或会话功能。
- 默认 Runtime selector 继续是 Legacy。

## 修改

### Product Composition 归位

原 `runtime-composition/src` 中的会话 ownership、Greenfield Runtime、Session 执行、外围能力、
Subagent 和 Runtime Tools 装配整体迁入：

```text
packages/coding-agent/src/composition
```

Coding Agent 新增公开子路径 `@vetta/coding-agent/composition`。迁入实现对 Coding Agent 自身能力使用内部
模块引用，对 Runtime 包继续使用稳定公开子路径，避免产品包通过自己的发布根入口反向加载自身产物。

CLI 的过渡转发文件和 Desktop Backend Pool 已直接引用新所有者入口。对应 TypeScript paths 和 Vitest alias
均增加精确子路径映射，避免通用包根 alias 把 `/composition` 错误拼接到 `index.ts`。

### `runtime-composition` 兼容转发

`runtime-composition` 不再持有产品实现，只保留：

- `artifact-manifest.ts`
- `index.ts`
- 独立产物校验

`index.ts` 从 `@vetta/coding-agent/composition` 原样转发全部 API，并继续导出原 artifact manifest。
兼容合同验证关键 Factory 和路径解析函数与新所有者是同一引用，而不是行为相似的第二份包装。

包边界守卫要求 `runtime-composition/src` 只能存在上述两个文件，并限制其 workspace 引用只能指向新的
Composition 子路径。Greenfield 禁止 Legacy Bootstrap 的守卫范围同步覆盖新目录。

### 独立 Runtime 子路径与兼容根入口分段构建

依赖审计确认：

- Coding Agent 使用 `@vetta/runtime-tools/coding`。
- Coding Agent 使用 `@vetta/runtime-storage/conversation`。
- 两个 Runtime 包的根入口仍为兼容性转发到旧 Coding Agent API。

这些入口不能同时用单次包构建表达为无环图。现改为：

```text
runtime-tools build:runtime
runtime-storage build:runtime
  -> coding-agent build
  -> runtime-tools build:compat
  -> runtime-storage build:compat
  -> runtime-composition build
```

`build:runtime` 只编译独立子路径，`build:compat` 只编译包根兼容入口。Coding Agent 在两个 Runtime 包中改为
peer/dev dependency，明确表达“根入口兼容需要宿主提供”，而不是让独立 Runtime 实现生产依赖产品层。

根 `build.sh`、Desktop 前置构建器和构建顺序质量守卫均识别这套分段脚本。Desktop 缓存的 compat build
同时纳入 Runtime 子路径和 Coding Agent 输入哈希，避免任一侧变化后复用陈旧根声明。

### 依赖声明事实守卫

包边界检查新增 manifest truth：

- 生产 `src` 引用 workspace 包时，必须在 dependencies、optionalDependencies 或 peerDependencies 中声明。
- 包自身子路径引用不要求重复声明。
- 当前覆盖 Coding Agent、Runtime Composition、Runtime Storage、Runtime Tools、CLI 和 Desktop。

因此 `coding-agent` 对 Runtime Storage、Runtime Tools 和既有 Zod 使用都已成为显式直接依赖；Desktop
直接消费 Composition 后也声明 Coding Agent，不再依靠 workspace hoist 或旧 `dist` 偶然可用。

## 明确未修改

- 没有改变 Tool 名称、描述、Schema、顺序、scope、执行结果或错误。
- 没有改变动态 Tool、Skill、MCP 和 Prompt 的模型调用级刷新语义。
- 没有改变会话事件、持久化格式、恢复、迁移或 ownership 行为。
- 没有改变 CLI、RPC、IM、Desktop 的 Runtime selector 默认值。
- 没有删除 `runtime-composition`、Runtime 包根或 Coding Agent 的公开兼容 API。
- 没有顺带修复首次并行测试中一次未复现的 Conversation revision 竞争。

## TypeBox / Zod 判断

本轮没有新增外部输入、配置或持久化反序列化边界，因此不新增 Schema。`zod` 已被迁入的既有
Composition 实现直接使用，本轮只把它补为 Coding Agent 的 manifest 直接依赖，避免依靠其他包传递安装。

## 验证

- `bun run check:quick` 通过，包含 Biome、构建顺序、包边界和 forwarding-only 守卫。
- Runtime Tools/Storage 的 `runtime` 与 `compat` 四个 tsconfig 均通过 `tsgo --noEmit`。
- CLI Greenfield Composition 文件完整复跑：1 个文件、14 项测试通过。
- 其余 CLI RuntimeHost、Session Execution、Subagent、Tool Composition、selector 和 IM Host：
  6 个文件、24 项测试通过；首轮并行执行中另有 1 项 revision 竞争失败，单项及完整文件复跑均通过。
- `runtime-composition` 契约：1 个文件、3 项测试通过。
- Desktop Backend Pool：1 个文件、6 项测试通过。
- `bun run verify:artifact:installed`：1 个文件、3 项安装产物测试通过。
- `bun run check` 通过，覆盖 Biome、root tsgo、CLI、Desktop、Admin 和质量守卫。

## 下一步

生成 `coding-agent` 公开导出的消费者分类清单，区分稳定 API、产品 Composition、Legacy 兼容面和真正可迁移
入口。只迁移已有等价稳定子路径的仓库内消费者，并为消费者清零建立守卫；默认 selector 和公开兼容入口的
删除继续留到单独的生产切换决策。
