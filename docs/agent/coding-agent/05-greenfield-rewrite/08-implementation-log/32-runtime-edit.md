# 阶段 32：Runtime Edit

## 目标

在不改变 `edit` 功能的前提下，把剩余的默认文件编辑工具迁移为独立 Runtime Tool。两种编辑模式、
错误文本、文件副作用、路径保护和取消语义均以旧实现为 Oracle。

## 实施内容

### 1. 独立 Edit Tool 目录

在 `@vetta/runtime-tools/coding/tools/edit` 下按职责新增：

- TypeScript 工具描述；
- TypeBox schema；
- Tool 执行编排；
- 锚点批量编辑引擎；
- 精确文本变换与 diff；
- Operations、PathPolicy 和 details 合同；
- Catalog registration 与公共导出。

入口文件只负责导出，Registration 只负责 Coding scope/category，Tool 只负责模式分派与副作用编排。

### 2. 锚点引擎

Runtime 共享锚点模块在既有 hash/render 能力上补齐 parse、全文件 hash 查找、漂移校验和区域回执。
`anchor-edit` 作为纯变换模块保留：

- 完整锚点与唯一纯 hash 输入；
- ±20 行漂移找回及重复候选 stale；
- 批量编辑原子性、范围和同一行冲突；
- 替换、范围删除、`insert_after` 与行号增量补偿；
- 结构关闭行保护；
- 修改后新鲜锚点、diff 与 firstChangedLine/appliedEdits。

### 3. 精确文本引擎

`edit-text` 保留精确优先与旧模糊归一化规则、唯一性检测、无变化错误、BOM 和换行恢复，以及原有
diff 格式。Runtime Tools 直接声明 `diff` 与类型依赖，不从 Coding Agent 取得传递依赖。

### 4. 文件与宿主边界

`EditOperations` 只提供 `access/readFile/writeFile`，默认实现使用 Node.js 文件系统。远程、沙箱或
测试场景可以替换该 Port，而编辑算法本身不依赖文件系统。

`EditPathPolicy` 是必需依赖，只向 Runtime 返回可选拒绝原因。Coding Agent Host Adapter 复用旧
Skill/Scene 和 Knowledge Wiki 判断及原有错误文本；Runtime 不包含这些业务名称或判断逻辑，也不
提供默认放行策略。

### 5. Composition Root

CLI 过渡 Composition Root 注册独立 edit，并显式注入宿主 PathPolicy。旧 Profile 继续由旧
`createEditTool` 作为 Oracle，全部 7 个场景的最终工具集合保持一致。

## 明确未修改

- 未切换旧 `AgentSession` 或正式 CLI/桌面入口；
- 未删除旧 `createEditTool`、`editTool` 或包根兼容导出；
- 未改变工具描述、TypeBox schema、scope、错误文本、成功回执或 details；
- 未修正旧模糊匹配会归一化整段命中内容的历史行为；
- 未把协作式取消升级为底层可中断文件系统操作；
- 未引入 Zod。现有 Tool 输入体系已统一使用 TypeBox，不需要第二套 schema 系统。

## 测试

- Edit 旧/新差分合同：22 项通过；
- 旧锚点测试：29 项通过；
- 旧 tools 测试中的所有 edit、模糊匹配、BOM/换行用例通过；同文件另有 6 项与 edit 无关的既存
  Windows/图片/文档提示失败；
- Runtime Tools 全量测试：17 个测试文件、188 项通过；首次与其他套件并行运行时 task_stop 用例
  超时，单独重跑全包后全部通过；
- CLI Composition Root：9 项通过；
- Runtime Tools、Coding Agent build tsconfig 类型检查通过；
- `bun run check:quick` 通过；
- 根级 `bun run check` 的 Biome 和 guards 通过，仓库级类型检查仍被本阶段之前已存在的问题阻塞：
  `capability-runtime/test/registry.test.ts` 的 fixture 缺字段、
  `runtime-core/test/kernel/turn-pipeline.test.ts` 的事件联合类型未收窄，以及 Runtime Tools 既有差分测试的
  Tool 参数函数型变规则不兼容。新增 Edit 源码和合同已通过目标包类型检查，且不在最终错误列表中。

## 结果

当前默认 Coding Tools 已全部具备独立 Runtime Definition、Registration 和全场景 Profile 差分。
`edit` 的复杂行为被保留为可测试的纯编辑引擎，文件系统与业务路径保护通过 Port 隔离。

## 下一步

停止继续增加平行 Tool 实现，转向生产接入 Gate：先审计实际 CLI/桌面入口如何创建旧 AgentSession、
订阅事件和恢复会话，再设计最小 Composition Root 切换点。切换前补齐流式 text/thinking/tool progress、
输入排队/steering、旧会话导入和 Photon WASM 产物验证；任何缺项都继续阻止删除旧入口。
