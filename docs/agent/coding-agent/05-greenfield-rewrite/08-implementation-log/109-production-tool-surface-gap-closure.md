# 第 109 轮：生产 Tool Surface 缺口闭合与动态能力激活

## 1. 目标

第 108 轮从真实 Provider 请求确认 Greenfield 生产候选组合缺少 8 项能力，并且最终 Tool 数组顺序与
Legacy 不一致。本轮在不改变工具名称、描述、Schema、执行语义和默认 Runtime selector 的前提下，闭合
这组模型可观察差异。

本轮成功标准：

1. Greenfield 组合能够提供 5 个文档/OCR Tool、`progress`、Session-local `invoke_skill` 和
   `kb_write_page`；
2. `agent_mode`、scope 和 capability 变化在下一次模型调用生效，不重编译 Runtime Snapshot；
3. 最终 Tool 顺序与 Legacy 产品顺序一致，未知 Plugin/MCP Tool 仍保持来源相对顺序；
4. Desktop 差分门禁不再维护“允许缺失能力”清单，而是比较完整 Tool 数组；
5. 默认 selector 和旧生产入口保持不变。

## 2. 实施边界

### 2.1 显式产品工具兼容边界

新增 `createCodingAgentGreenfieldProductToolRegistrations()`，只显式适配以下既有 Tool Factory：

- `doc_to_pdf`
- `html_to_pdf`
- `extract_text_from_pdf`
- `extract_text_from_img`
- `render_pdf_page`
- `progress`
- `kb_write_page`

该边界不会把 `createAllTools()`、`RuntimeManager` 或旧 Registry 注入 Greenfield，也不会复制一套简化执行
逻辑。每个工具被独立转换为 `CodingToolRegistration`，原有 TypeBox Schema、描述、结果、错误和副作用继续
由既有实现提供。这样先恢复生产功能等价，同时把尚未迁移的实现所有权限制在一个可替换的反腐层内。

这是一项迁移期取舍，不表示上述 7 个工具已经成为 Runtime-native 实现。后续仍需逐个把定义、TypeScript
描述和执行 Port 迁入 `runtime-tools/coding/tools/*`，届时删除对应适配项；不能把本兼容层扩展成新的工具
总入口。

### 2.2 Session-local `invoke_skill`

`invoke_skill` 没有通过静态工具适配器接入，而是新增 Session-local Feature：

```text
Prompt Resource Source
  -> refreshSkillsIfChanged()
  -> current Skill/Scene + agent mode filtering
  -> per-model-call Tool Contribution
  -> execution-time current Skill resolution
```

每次模型调用贡献前刷新资源并重新计算可见 Skill；执行时再次解析当前 Skill。用户新增、删除 Skill，切换
Agent Mode 或改变禁用状态后，不需要重建 Profile 或 Runtime Snapshot。已发送给模型的单次请求仍使用该次
调用开始时的 Schema，这是不可消除的 turn/model-call 物理边界。

### 2.3 通用 `agent_mode` 激活轴

`CodingToolRegistration` 增加可选 `agentModes`，`CodingToolScopeActivation` 增加当前 `agentMode`。Catalog
Snapshot 冻结该数组，模型调用时才读取当前 Session 配置并过滤。显式工具激活继续绕过 mode 过滤，与既有
scope/requires 的显式选择语义一致。

旧工具的 `agent_mode` 元数据由 Greenfield Tool Adapter 原样投影，因此文档/OCR、`progress` 等 Work Mode
工具不再因接入新组合根而扩大可见范围。

### 2.4 产品边界的确定性顺序

排序放在 `CodingAgentModelCallFrameComposer` 的最终产品组合边界，而不是通用 Runtime Core、Feature
Compiler 或 Provider Adapter。原因是顺序本身属于 Coding Agent 的 Legacy 产品合同，通用内核不应认识
`read`、`invoke_skill` 等产品工具名，Provider 也不应修改上游已经编译完成的 Frame。

已知内置工具使用 Legacy 顺序；不在该清单中的 Plugin/MCP Tool 排在内置工具后，并保持其来源相对顺序。
Ecosystem Hook 包装发生在排序之后，不改变 Map 顺序。

### 2.5 精确生产差分合同

Desktop Model Call Frame 差分测试删除 8 项允许缺失清单和差异分类器，改为直接比较 Legacy 与 Greenfield
最终 Provider `body.tools` 数组，包括：

- 数组顺序；
- Tool 名称；
- 完整描述；
- 完整 JSON Schema。

测试源码不再允许通过扩大白名单隐藏新增缺口。默认 Runtime selector 未改变。

## 3. TypeBox / Zod 判断

本轮没有新增外部协议、配置文件或持久化反序列化边界，因此不新增 Zod。兼容工具继续复用既有 TypeBox
Tool Schema；`agentModes`、模型调用激活状态和 Prompt Resource Source 都是进程内受信任的 TypeScript
合同，不重复增加运行时 Schema。

## 4. 测试与检查

已通过：

```text
runtime-tools 动态激活与 Catalog：2 files, 17 tests passed
coding-agent Tool Adapter、产品工具边界与最终排序：3 files, 12 tests passed
bun run check:quick: passed
bun run check: passed
```

完整检查首次发现并修复：

- 确定性顺序 Rank Map 因字面量元组推断导致普通 Tool 名称不能查询；
- Prompt Resource 测试夹具的 `getAgentsFiles()` 与 `refreshSkillsIfChanged()` 返回类型不符合真实 Port。

修复后，Biome、Monorepo `tsgo --noEmit`、CLI 类型检查、Desktop `tsc --noEmit`、Admin `tsc -b` 和质量
守卫全部通过。

Desktop 精确 Provider 差分测试的源码合同已升级，但本轮没有执行会刷新 workspace `dist` 的 Desktop 前置
构建；仓库规则禁止在该任务中运行 build，现有测试运行器会优先解析旧 `dist`。因此本轮不虚报该产物级
测试已执行，下一阶段应在标准产物验证流程中刷新前置包后运行它。

## 5. 明确未修改

- 未修改 Legacy Tool 的名称、描述、TypeBox Schema、结果文本或副作用。
- 未改变 `knowledgeMode`、scope、requires 或显式工具选择语义。
- 未改变 Legacy/Greenfield selector 默认值。
- 未把产品工具顺序放进 Runtime Core 或 Provider Adapter。
- 未删除旧 Tool Factory、旧 AgentSession 或公开兼容导出。

## 6. 下一步

下一阶段应作为一个完整的“Runtime-native 产品工具与产物门禁收口”阶段：

1. 为 5 个文档/OCR Tool、`progress` 和 `kb_write_page` 提取旧新参数化行为合同；
2. 将定义、TypeScript 描述和可移植执行逻辑迁入 `runtime-tools/coding/tools/*`，把 Desktop/文件系统/
   二进制能力收敛为窄 Host Port；
3. 每迁移一个工具就删除本轮兼容工厂中的对应适配项，最终删除整个产品工具兼容文件；
4. 刷新标准 workspace 前置产物并运行 Desktop 精确 Provider Frame 门禁；
5. 再把完整 Frame 门禁扩展到 CLI/RPC/IM。默认 selector 仍保持 Legacy，直到这些产物级门禁全部通过。
