# 阶段 31：Runtime Write

## 目标

在不改变 `write` 工具功能的前提下，将其迁移为独立 Runtime Tool，并把 Coding Agent 特有的路径保护
留在宿主适配层。迁移结果必须通过行为合同、Tool Profile 差分和真实文件系统测试。

## 实施内容

### 1. 独立 Write Tool

在 `@vetta/runtime-tools/coding/tools/write` 下新增独立目录，分别承载：

- TypeScript 工具描述；
- TypeBox 参数 schema；
- 工具执行实现；
- Catalog registration；
- 公共导出。

工具继续使用原有名称、描述、参数、scope 和 core 标记。路径解析、父目录创建、原样写入、模糊路径
重定向、取消传播、错误传播和结果文本均按旧实现保留。

### 2. 文件系统副作用边界

新增 `WriteOperations`，只包含 `mkdir` 和 `writeFile`。默认实现使用 Node.js 文件系统；测试可注入
受控 Operations，验证调用顺序、取消点和错误传播，无需让 Runtime 依赖 Coding Agent。

### 3. 宿主路径策略

新增必需的 `WritePathPolicy` Port。Runtime 只获取可选的通用拒绝原因，不理解 Skill、Scene 或知识库
Wiki 的业务含义，也不保存对应业务提示文本。

Coding Agent 的适配器复用旧有 `isProtectedSkillOrScenePath` 和 `isKnowledgeWikiPath` 规则，并由 CLI
Composition Root 显式注入。该依赖没有 permissive 默认值：任何新的宿主若要注册 `write`，都必须
明确选择路径策略，不能因遗漏配置而静默绕过保护。

### 4. 路径解析复用

从 Runtime 共享路径模块导出既有 `resolveToCwd`，并加入与旧实现一致的 `resolveWritablePath`。这只复用
通用路径语义，不把宿主策略或 Coding Agent 代码移入 Runtime。

### 5. Composition Root 接入

CLI Runtime Composition Root 注册独立 `write`，注入当前工作目录对应的宿主路径策略。Profile 差分
测试仍以旧 Tool Factory 为基线，确认所有既有运行场景的激活结果不变。

## 明确未修改

- 未切换旧 `AgentSession` 和既有生产执行入口；
- 未删除旧 `write` Factory 或公共导出；
- 未改变用户可观察的描述、schema、保护提示、重定向提示或成功文本；
- 未修正旧实现用 `content.length` 表示“字节数”的历史语义；
- 未新增配置能力，也未引入 Zod。现有 Tool 接口使用 TypeBox，继续保持同一校验体系即可。

## 测试

- Write 行为合同：11 项通过；
- Runtime Tools 全量测试：16 个测试文件、166 项通过；
- CLI Composition Root 测试：9 项通过；
- Runtime Tools、Coding Agent build tsconfig 类型检查通过；
- 当前变更的 Biome 检查通过；
- `bun run check:quick` 通过；
- 根级 `bun run check`：Biome 和 guards 通过，仓库级类型检查仍被本阶段之前已存在的问题阻塞：
  `capability-runtime/test/registry.test.ts` 的 fixture 缺少新字段，
  `runtime-core/test/kernel/turn-pipeline.test.ts` 的事件联合类型未收窄，以及 Runtime Tools 既有差分测试的
  Tool 参数函数型变规则不兼容。本阶段新增的 Write 合同未出现在错误列表中。

覆盖内容包括定义与注册元数据、真实目录创建和 Unicode 原样写入、Operations 调用顺序、UTF-16 长度
兼容、模糊路径重定向、两类宿主路径保护、执行前取消、mkdir 后取消、mkdir/write 错误传播。

## 结果

`write` 已形成独立 Runtime 实现。Runtime 负责通用执行机制，宿主负责业务保护策略，真实文件系统由
Operations 隔离；CLI 的能力编排结果与旧实现一致。

## 下一步

按同样方法迁移剩余的 `edit`：先建立旧行为合同，再拆分编辑算法、文件系统 Operations 和宿主路径
策略，最后加入全场景 Profile 差分门禁。在切换生产入口前继续保留旧工具实现。
