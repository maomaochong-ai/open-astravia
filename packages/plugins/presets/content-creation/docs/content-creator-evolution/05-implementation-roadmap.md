# 实施路线

## 总体策略

保留现有 workspace、command、provider、job、artifact、revision 和卡片机制，在其上逐层增加隔离、领域合同和质量闭环。不要先重写画布或 Provider。

## Phase 0：建立可量化基线

目标：先知道上下文和行为成本，再改工具。

工作项：

- 为 7 个当前工具记录名称、描述、schema 字节数和估算 token。
- 建立 10 个无关 Work 请求与 10 个内容请求的 smoke set。
- 记录激活工具、工具调用序列、invalid input、重复 inspect 和最终 project state。
- 给现有两个 Skill 加资源加载 trace，确认实际加载哪些文件。
- 固化安全用例：删除必须 preview、生成必须确认、revision conflict 不得覆盖。

验收：有可重复命令生成机器可读报告；不调用真实付费 Provider。

## Phase 1：零内核改动减少上下文

目标：无关会话不再携带 content-creation 贡献。

工作项：

- `plugin.json` 增加 `contributionMode.hardIsolation`。
- 注册显式内容创作 input action，并与贡献模式同步。
- 保留 `agent_mode: ["work"]` 与 `scope_use`。
- 删除 `content_creation_get_state`，统一使用 inspect。
- 把打开 Activity Tab 合并到 edit/run 成功结果或 UI action，删除 `open_content_creation` 模型工具。
- 将 prepared run 纳入 inspect/runtime 或 run/status，删除独立 get-run。

预期结果：工具从 7 个降至 4 个；未进入内容创作模式时为 0 个。

验证：

- 插件 hard-isolation UI 与 runtime 合同测试；
- tool registration 快照；
- 现有 Agent service 安全测试全部保留；
- 非内容 Work 会话不出现 tool、Skill 或 system prompt。

## Phase 2：收敛为三个领域工具

目标：减少近义工具和模型协议记忆。

工作项：

- 合并 preview/apply 为 `content_creation_edit`。
- 在 AgentService 内增加 `classifyEditRisk()`，由领域规则决定 apply 或 preview。
- 合并 prepare/status/resume/cancel 为 `content_creation_run`。
- inspect 默认 summary，详细 view 明确选择。
- operation schema 改为真正的 discriminated union，避免所有 action 共享几十个可选字段。
- 使用 TypeBox 或仓库现有结构化 schema 事实源，同时生成运行时校验和工具 schema，避免双份合同。
- 增加动态 system prompt provider 和 `agent.tools.control`，按轮启用 inspect/edit/run。
- 给动态 provider 固定本插件工具 allowlist，拒绝切换任何宿主或其它插件工具。

验收：

- 内容任务首轮最多暴露 2 个插件工具；
- 模型无需知道 destructive operation 对应哪个工具；
- 同一 safety 测试集行为不变；
- schema token 相比 Phase 0 明显下降。

## Phase 3：引入 brief、plan 与 graph compiler

目标：模型从“直接搭节点”转为“制定生产计划”。

工作项：

- 新增版本化 `CreativeBrief`、`ContinuityBible`、`ProductionPlan`。
- 项目持久化升级并提供 migration；旧项目可推导空 brief/plan，不破坏 graph。
- 建立 `RecipeRegistry`，首批只做 3 个高价值 recipe：
  - product hero image；
  - cinematic product ad；
  - social campaign pack。
- 新增 `GraphPlanCompiler`，把 recipe/plan 转成现有 node command。
- 实现 stage 与 stale dependency propagation。
- edit 工具优先接受 `set-brief/apply-recipe/revise-stage`，低层 `edit-graph` 保留给高级自由操作。

验收：

- 三个 recipe 都能从 brief 稳定生成同构、合法、可编辑的 graph；
- 修改 reference/ratio 会准确标记相关下游 stale；
- 旧项目迁移后 UI、生成与 Agent inspect 行为兼容；
- compiler 使用当前 Node Definition Registry 和能力合同，不写死 Provider。

## Phase 4：专业 Skill 资源图

目标：让模型按任务获得足够专业知识，而不是扩大常驻 prompt。

工作项：

- 将当前 system prompt 缩为不可信数据、安全门槛和入口路由。
- 新建 image、video、quality-review Skill。
- 按 universal/model/task/failure 拆 reference。
- recipe Skill 只声明输入、阶段、gate、fallback 和交付物。
- 为每个 Skill 建立触发正例、负例和读取顺序测试。
- model reference 只使用 capability profile 名称；具体可用值运行时 join。

验收：

- 图片任务不加载视频 reference；
- 单图任务不加载 campaign 或 storyboard 全库；
- 未指定模型时先查 capabilities 再读匹配 profile；
- Skill 输出符合 CreativeBrief/ProductionPlan 合同；
- 资源 token 有上限并纳入 benchmark。

许可证注意：若改编 visual-skills 的具体文字或模板，需要履行 CC BY 4.0 署名；更稳妥的方式是依据 Vetta 自有 rubric 重新撰写，并记录参考来源。

## Phase 5：候选、评审与修订闭环

目标：质量成为运行时行为。

工作项：

- generation plan 支持 draft/final、candidate group 与 budget。
- 生成卡显示候选数量、质量档、预计调用数和后续 gate。
- 新增 `Evaluation` artifact 与 rubric registry。
- 图片接入像素评审；视频先用首/中/末抽帧与 metadata，后续加入音视频检查。
- 候选比较卡支持用户选择、拒绝和定向修订。
- 选中结果写入 lineage；final 只消费已选且非 stale 的候选。
- repair action 转为明确的 stage revision，而不是无限 regenerate。

验收：

- 不确定方向的 recipe 先出低成本候选；
- 已有明确 reference 的简单编辑不会被强制扩成多候选；
- evaluator 能指出 evidence 与 repair target；
- 用户选择可恢复，刷新或会话压缩后不丢失；
- 没有用户确认不会进入高成本 final。

## Phase 6：可执行 benchmark 与宿主级 deferred tools

目标：形成长期质量门禁，并把渐进披露推广到插件工具目录。

工作项：

- 建立 20-30 个固定 benchmark case 和 mock capability/provider。
- 产出 context、tool、task、cost、quality 指标报告。
- 引入有限人工盲评并校准自动 judge。
- 在 Coding Agent 层评估把现有 MCP deferred controller 抽象为 catalog-source-neutral。
- plugin tools 超过阈值时使用同一 `tool_search` 会话激活语义，不在 content-creation 内另造搜索工具。

验收：

- benchmark 可在不访问真实 Provider 的情况下稳定运行结构和工具评测；
- 真实媒体质量评测单独显式执行并记录费用；
- deferred 激活保持 session 隔离，同一 tool loop 下一模型调用可见；
- 不改变显式工具白名单与现有 MCP 行为。

## 建议的首个实施切片

最值得先做的不是完整 pipeline，而是一个可端到端验证的 product hero vertical slice：

```text
开启内容创作模式
  -> 收集 Product Hero CreativeBrief
  -> recipe 生成 3 个低成本方向
  -> graph compiler 生成可编辑节点
  -> 用户确认生成
  -> 图片候选像素评审
  -> 用户选中
  -> 局部修订或高质量 final
  -> 最终 Evaluation + output
```

这个切片能同时验证 hard isolation、3-tool surface、brief、recipe、compiler、candidate、evaluation 和 lineage，而不必先完成长视频、音频和 Timeline。

## 风险与决策点

| 风险 | 建议 |
| --- | --- |
| dynamic tool router 误判 | 显式模式与 stage 优先，关键词兜底；inspect 作为安全默认，不调用分类模型。 |
| 领域工具参数变得过大 | 分 action 使用 discriminated union；必要时按阶段 gate，而不是回到多个近义工具。 |
| plan 与 graph 双真源 | ProductionPlan 是创作意图真源，graph 是可编辑执行投影；人工 graph 编辑记录 override。 |
| evaluator 过度自信 | 保存 confidence/evidence，低置信度转用户选择，定期用盲评校准。 |
| 成本因多候选上升 | 只有方向不确定时探索；候选使用低质量档；generation card 显示调用数。 |
| Skill 文档再次膨胀 | 强制薄入口、任务形状读取和资源 token 测试。 |
| 模型知识过时 | 参数与可用性只信 capability registry；model reference 只写策略与已验证行为。 |
| 旧项目迁移复杂 | 新字段版本化、可空、可推导；保留现有 graph/job/artifact 合同并写 migration test。 |

## 不建议做的事情

- 不要把 7 个工具简单改写成 7 个 Skill；副作用仍需要可信执行合同。
- 不要一次引入几十个 recipe；先用少量高价值垂直切片验证 registry 与 compiler。
- 不要把三个参考项目的 prompt 全部复制进一个超级 Skill。
- 不要先重写 React Flow、Provider 或持久化底座。
- 不要用“自动 judge 分高”替代用户验收。
- 不要为了降低 token 把复杂路由藏进无法审计的自由文本 prompt。
