# 第 248 阶段：HTML 导出运行时与资产边界重写

## 阶段目标

在不改变 CLI、SDK、RPC、IM 的 HTML 导出能力、默认文件名、主题、工具渲染和独立可执行产物的前提下，删除旧 `src/core/export-html` 实现，建立显式可组合、可注入、可独立测试的 HTML 导出领域；模板资产不再通过进程级全局变量隐式安装。

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段与最终目标的关系

第 247 阶段后，HTML 导出仍有 4 条生产代码到旧 Core 的依赖，旧目录同时承担会话投影、工具预渲染、主题解析、模板读取、全局资产注入、HTML 生成和文件写入。独立产物还通过 `Symbol.for` 修改进程级状态。本阶段按 Port、投影、渲染、资产源和组合根拆分这些职责，并让所有宿主消费同一个窄 `CodingAgentHtmlExportRuntime`。

## 实施内容

### 1. 建立独立 HTML 导出领域

- 新增 `src/export-html/contracts.ts`，定义 `CodingAgentHtmlExportRuntime`、模板资产源、主题源、文件写入器、旧会话读取器和工具 HTML 渲染 Port。
- 会话投影进入 `export-document.ts`；模板替换、主题变量和颜色推导进入 `html-renderer.ts`；默认命名与写入流程进入 `export-runtime.ts`。
- `createCodingAgentHtmlExportRuntime` 只负责组合默认文件资产、主题适配器、legacy reader 与文件 writer，也允许宿主显式注入替代实现。
- 没有引入 TypeBox/Zod：本阶段没有新增外部不可信结构解析，Greenfield 输入是 `ConversationDocument`，旧 JSONL 继续由既有 legacy format reader 校验和投影。

### 2. 让宿主显式消费运行时

- CLI control、SDK Host、RPC session adapter 与 IM/Print/RPC composition 统一接收可选 `htmlExporter`，默认由 Composition Root 创建。
- SDK 的自定义工具 HTML 渲染保留为独立适配器，不再依赖旧 Core 工具渲染器。
- 新增 `@vetta/coding-agent/export-html` 公共子路径；CLI App 通过该稳定子路径消费合同与工厂。

### 3. 删除独立产物的隐式全局资产安装

- 独立可执行脚本直接把内嵌模板构造成 `CodingAgentHtmlExportRuntime`，通过 `runCli` / `runAgentCli` 选项向下传递。
- 删除 `installExportTemplateAssets` 与全局 `Symbol` 状态；运行时资产变化只影响对应组合实例，不污染进程内其他会话。
- 普通 Node/Bun 产物继续从 `dist/export-html` 读取随包资产，构建脚本与包资产复制路径同步更新。

### 4. 保留静态行为资产并删除旧目录

- HTML、CSS、浏览器脚本、Marked、Highlight 和 ANSI 转换器迁入新领域；六个文件的新旧 Git Blob ID 全部一致，内容未被功能性改写。
- 删除旧 `src/core/export-html/index.ts` 与 `tool-renderer.ts`，旧目录不再提供执行入口。

### 5. 建立零回流守卫

- 重写进度守卫新增 `Legacy HTML export references` 指标，扫描生产源码、SDK 示例、CLI 构建脚本、包清单与二进制构建脚本。
- `core/export-html`、`installExportTemplateAssets` 和旧全局资产 Symbol 标识一旦重新出现，即使写入基线也会失败。
- 守卫单元测试覆盖旧资产路径和隐式安装器两种回流。

## 行为兼容性验证

- 新增 HTML 导出运行时测试 3 项：验证显式资产/主题/writer 注入、Greenfield 文档与自定义工具投影、legacy 默认命名与字符串输出路径、缺失文件错误和互斥组合错误。
- 公共子路径测试验证 `./export-html` 清单目标和工厂可用；与运行时测试合计 5 项通过。
- 既有 SDK Host Adapter 测试 8 项通过，覆盖真实 SDK `exportToHtml` 路径及其余宿主能力回归。
- 重写治理测试 11 项通过；根 TSGo 类型检查通过。
- 根级 `bun run check` 通过，包含全仓 Biome、monorepo 与 CLI App 类型检查、Desktop/Admin 独立类型检查和全部质量守卫。
- CLI App 的既有 `agent-runtime-selection` 测试在收集阶段因工作区 `@vetta/runtime-knowledge` 未构建入口而阻断，没有执行到本次导出断言；本阶段没有构建或修改该无关包来掩盖环境前置条件。

## 旧实现依赖变化

| 指标 | 第 247 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 19 | 15 | 0 |
| Export HTML 旧依赖边 | 4 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 60 | 54 | 0 |
| Export HTML 旧实现文件 | 6 | 0 | 0 |
| Legacy HTML 导出路径/全局安装器引用 | 未独立统计 | 0 | 0 |
| `compat/*` 包导出 | 0 | 0 | 0 |
| 深层 `core/*` 包导出 | 0 | 0 | 0 |

## 尚未完成的替换

- 仍有 15 条旧产品 Core 依赖和 54 个旧实现文件。
- Memory 有 4 条旧依赖；Hooks、Slash Commands 和 Timings 各有 2 条；Background Tasks、Concurrency、Event Bus、Footer Data Provider 与 Image Budget 各有 1 条。
- 下一阶段应优先重写 Memory：它是剩余依赖最多且涉及持久化用户数据的领域，需要先冻结读取、写入、检索、压缩和迁移行为，再按存储 Port、领域服务与宿主组合拆分，不能只移动旧实现。
