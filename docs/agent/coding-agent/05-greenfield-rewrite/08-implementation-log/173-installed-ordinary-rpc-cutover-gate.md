# 第 173 轮：普通 RPC 安装产物默认切换门禁

## 目标

第 172 轮已把普通 RPC 的默认后端切换为中性 Greenfield，但当时的主门禁仍偏向源码布局和显式测试组合。标准单文件安装产物还需要证明：不传 Runtime、IM bridge 或测试场景时，真实默认入口能够完整运行、关闭并跨进程恢复，且不会因打包布局改变原有功能。

本轮目标是：

1. 让安装产物测试默认走真正的普通 RPC 启动路径，不再由测试夹具隐式注入 Greenfield IM 场景。
2. 覆盖普通 RPC 默认 Greenfield 的完整外围能力和跨进程恢复。
3. 保留显式 Legacy、IM host bridge、Extension 不兼容和旧会话迁移等既有选择与回退行为。
4. 修复门禁暴露的 standalone HTML 导出资产闭包问题，不改变源码运行和多文件发行行为。

## 分析结论

### 1. 测试默认值必须与产品默认值一致

原安装产物夹具会默认传入 Runtime backend、host bridge 和 IM 场景。即使用例没有显式声明，这些参数也会把进程导向 Greenfield IM，因而不能证明普通 RPC 的默认选择已经生效。

测试启动合同现改为：

```text
无 runtime + 无 host profile -> 普通 RPC 产品默认路径
runtime=legacy             -> 显式 Legacy
hostProfile=im-claw        -> 显式 IM 宿主能力
```

只有测试本身需要验证特定分支时才注入对应参数。这样“默认 Greenfield”由真实 CLI 选择器决定，而不是由测试夹具预先决定。

### 2. 安装产物门禁必须覆盖能力和持久化身份

只检查 `runtimeBackend === "greenfield"` 不足以证明切换无损。本轮在同一个真实安装产物流程中验证模型、Thinking、队列模式、Retry、压缩、Memory、Bash、统计、命名、HTML 导出、关闭和重启恢复。

直接 Bash 的 `bashExecution` 消息身份在重启后仍需精确恢复；会话 id、路径和名称也必须保持一致。该合同同时约束 Runtime 选择、V2 持久化和 RPC 投影三层边界。

### 3. 单文件产物的静态资产属于 Composition Root 闭包

真实门禁发现 `export_html` 在单文件产物中会等待失败：HTML 模板、脚本以及内置 Theme JSON 原先依赖源码相邻文件，编译后的单一可执行文件没有这些路径。

这些资产不应被复制进 Kernel，也不应强迫所有运行形态改成内联。正确处理是由 standalone 编译入口把资产嵌入产物，并在启动时注入 Coding Agent 的窄资产端口：

```text
源码 / 多文件发行 -> 保留现有磁盘资产读取
standalone 产物   -> Composition Root 注入已嵌入资产
```

注入使用稳定的全局 Symbol 作为进程内桥接，以兼容单文件构建中可能出现的模块实例复制；资产解析与导出业务仍由 Coding Agent 拥有。

## 实施内容

### 安装产物启动合同

- 安装产物测试的启动选项拆为 `runtime` 与 `hostProfile`，两者默认都不注入。
- IM provider frame 和 host response 用例显式选择 `im-claw` host profile。
- Legacy 后台任务等用例显式选择 `runtime: "legacy"`。
- 动态 Skill/MCP、迁移旧会话、Extension 兼容和回退用例继续使用标准安装产物，并断言结构化 Runtime 决策。

### 普通 RPC 默认 Greenfield 门禁

- 新增真实单文件产物测试，不传 `--agent-runtime`、host bridge 或 scenario。
- 验证实际后端、请求后端和有效后端均为中性 `greenfield`。
- 验证模型选择、Thinking、steering/follow-up 模式、自动重试、自动压缩和会话命名。
- 通过跨平台命令执行直接 Bash，并验证精确 `bashExecution` 消息身份。
- 验证会话统计和 V2 HTML 导出。
- 关闭后验证 ownership lock 清理；重启同一会话后验证 id、路径、名称和 Bash 消息恢复。
- 重启后继续验证手动压缩，以及非 memory-mode 下 `flush_memory` 保持 no-op。

### Standalone 静态资产闭包

- HTML 导出模块增加可注入的模板资产边界；没有注入时仍按原路径读取模板、CSS 和脚本。
- Theme 模块增加可注入的内置 dark/light 文档边界；没有注入时仍读取现有 JSON 文件。
- 标准 standalone 编译脚本生成临时 Composition Root，静态导入文本和 JSON 资产，完成注入后调用原 CLI 入口。
- 临时入口始终在编译结束后清理，不进入发行目录，也不改变标准 CLI 源码入口。

## TypeBox / Zod 判断

内置 Theme JSON 是结构化数据，注入时复用了 Theme 模块现有的 TypeBox schema 与解析错误合同，没有引入第二套校验器。

HTML 模板、CSS 和脚本是编译期受控的内部字符串资产，不是外部输入或持久化协议；为它们新增 Zod/TypeBox schema 只会重复静态 TypeScript 合同，因此本轮没有额外引入 schema 库。

## 兼容性判断

本轮补的是安装产物切换门禁和打包资产闭包，不是功能重构：

- RPC JSONL wire、命令名称和响应结构未改变。
- Tool、Prompt、Skill、MCP、Extension、压缩、Memory 和导出业务算法未重写。
- IM host bridge 仍显式进入 Greenfield IM profile。
- 显式 Legacy 和不兼容 Extension/旧会话回退仍保留。
- 源码运行与多文件发行继续从磁盘读取导出和 Theme 资产。
- 只有 standalone Composition Root 负责嵌入和注入资产。
- 运行时动态 Tool、Prompt、Skill 和 MCP 不被固化进编译期资产集合。

## 明确未修改

- 没有删除 Legacy RPC 或任何结构化回退条件。
- 没有改变普通非 RPC CLI 的默认 Runtime。
- 没有新增会话格式、RPC schema 或迁移协议。
- 没有把测试专用 host bridge 带入普通 RPC 默认组合。
- 没有引入 Runtime 全局快照，也没有固定运行期动态能力。
- 没有将 HTML/Theme 资产加载职责下沉到 Agent Kernel。

## 验证结果

- `packages/cli-app` 定向安装产物测试：`bunx vitest --run test/installed-artifact-runtime.test.ts`，13 项全部通过。
- 门禁覆盖普通 RPC 默认完整能力、IM provider frame、Provider 失败恢复、会话切换与 drain、Memory 取消、Legacy 后台任务、host response、动态 Skill/MCP、Legacy 会话迁移、不兼容回退、Extension profile 与关闭重试。
- `bun run check:quick` 通过，包含 package boundary 和 standalone CLI build guard。
- 根目录 `bun run check` 通过：Biome、monorepo/CLI/Desktop/Admin 类型检查和全部质量守卫均通过。
- `git diff --check` 通过。

## 下一步

下一阶段应基于现在已稳定的普通 RPC、IM 和安装产物差分矩阵，盘点仍会触发 Legacy RPC Composition 的真实能力组合，并建立可执行的 Legacy allowlist：每个回退项必须有能力原因、对应测试和预期移除条件。先用门禁证明哪些兼容职责仍然必要，再逐项迁出；不应仅因普通 RPC 已默认 Greenfield 就直接删除 Legacy 组合。
