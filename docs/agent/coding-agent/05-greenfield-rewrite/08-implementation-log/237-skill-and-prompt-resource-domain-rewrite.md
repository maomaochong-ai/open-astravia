# 第 237 阶段：Skill 与 Prompt 资源域重写

## 阶段目标

在不改变资源功能的前提下，把 Skill、Prompt Template 和资源诊断合同从旧 `core` 迁入包内独立 `resources` 领域；修正已经落后于当前配置目录和 `invoke_skill` 协议的测试基线，并阻止新资源域重新依赖旧实现。

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

Skill 和 Prompt 是围绕 Agent 内核组合的资源能力，不属于旧 Session 内核实现。本阶段把它们迁入 `src/resources`，调用方直接消费新领域，不保留旧路径转发文件。

审计同时确认 `DefaultResourceLoader` 依赖的 `DefaultPackageManager.resolve()` 会执行缺失包安装、npm 更新判断、临时 Git 刷新和 manifest 过滤。为避免架构迁移造成包资源功能回退，本阶段没有复制一个简化解析器；`ResourceLoader` 与 `PackageManager` 将在后续阶段联合解耦。

## 实施内容

- 新增 `src/resources/contracts/diagnostics.ts`，持有资源警告与冲突合同。
- 新增 `src/resources/skills/index.ts`，保留 Skill 发现、忽略规则、symlink 去重、frontmatter 校验、场景识别、冲突优先级和动态内容读取。
- 新增 `src/resources/prompts/index.ts`，保留命令参数解析、变量替换、模板发现和展开行为。
- 新增薄聚合入口 `src/resources/index.ts`，只公开资源域合同与能力。
- 包根、SDK、旧 Session 组合、Greenfield Adapter、工具和测试全部切换到新资源域。
- 删除旧 `core/skills.ts`、`core/prompt-templates.ts`、`core/diagnostics.ts`，没有保留转发壳。
- 资源测试中的项目目录从写死 `.pi` 改为 `CONFIG_DIR_NAME`；Skill 提示断言改为验证当前 `invoke_skill` 协议，不修改生产提示词。
- 修复 `ResourceLoader` 在 `PackageManager` 已过滤禁用 Skill 后再次合并默认目录的问题；Loader 现在只消费已启用路径，避免禁用配置失效和重复来源扫描。
- 重写进度守卫新增稳定 Resource 域规则，即使更新基线也不能接受它回接旧 `core`；聚合入口限制为 50 行，职责模块暂以 600 行为硬上限，防止迁移后继续无界增长。

## TypeBox / Zod 判断

本阶段输入是 Markdown frontmatter、路径和内部资源值，现有 YAML 解析后只做宽松兼容校验；行为明确允许未知字段、缺少名称时回退目录名，并以诊断而非异常处理多数不规范 Skill。引入 TypeBox 或 Zod 会改变这组兼容语义，因此本阶段不引入。未来若形成外部稳定 Resource Manifest，应在该外部协议边界使用 TypeBox。

## 旧实现依赖变化

| 指标 | 第 236 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 122 | 118 | 0 |
| Skill / Prompt / Diagnostic 域旧依赖 | 4 | 0 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 149 | 146 | 0 |

下降来自生产调用方真实切换和三个旧文件删除；没有通过兼容转发、重命名旧路径或放宽统计实现。

## 行为兼容性验证

- Skill、Prompt Template、ResourceLoader 定向测试共 119 项，覆盖发现、忽略、校验、冲突、参数替换、动态路径、Extension 资源、系统提示和配置目录。
- 质量守卫单测覆盖 Resource 域回接旧 `core` 的拒绝行为。
- 重写进度门禁报告旧依赖 118、Runtime 反向依赖 0、旧文件 146、兼容导出 0；Skill 域已从旧依赖统计消失。
- `check:quick`、完整类型检查和仓库质量门禁作为本阶段最终验收。

## 尚未完成的替换

- `core/resource-loader.ts` 仍有 9 条外部旧依赖边，并直接组合 `DefaultPackageManager`。
- `core/package-manager.ts` 同时混合资源解析、安装、更新、网络和 manifest 过滤。下一阶段应先抽取 package source lifecycle 与纯资源投影端口，再重写 ResourceLoader，而不是复制功能不完整的路径扫描器。
- 全仓仍有 118 条生产代码到旧实现的依赖和 146 个旧实现文件，最终目标仍是全部归零。
