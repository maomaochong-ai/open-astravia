# 参考项目分析

## Generative-Media-Skills

### 可借鉴的设计

该项目最有价值的不是脚本数量，而是 **Core Primitive / Expert Library / Workflow Recipe** 三层结构：

```text
Core
  media / edit / platform
       ^
Expert Library
  cinema-director / nano-banana / ui-design / ...
       ^
Workflow Recipes
  product-ad / social-pack / ugc-factory / ...
```

这一结构把“怎么执行”和“为什么这样做”分开：

- Core 提供少量稳定生成、编辑、上传和轮询原语。
- Expert Skill 负责摄影、品牌、UI 等专业决策。
- Recipe 声明输入、默认值、阶段、依赖、模型选择和 fallback。
- workflow discovery 先返回轻量目录，再读取候选 workflow 的详细输入合同。

几个具体模式值得采用：

1. **配方是产品能力，不是临时生成的图**。例如 product campaign 明确 hero、square crop、video、story、banner 等交付物。
2. **便宜探索与昂贵提交分阶段**。product ad 先生成 4 个 hero variant，用户选中后再 upscale 和 animate。
3. **人工选择是正常生产步骤**，不是 Agent 失败后的兜底。
4. **输入合同显式化**。recipe 会区分 required/default，而不是让模型在 operation 中临时猜值。
5. **fallback 写进配方**。视频失败可以退回高质量静帧等可交付结果。

### 不应照搬的部分

- MCP 模式会暴露 19 个工具，本身并没有解决工具上下文膨胀。
- 多个 recipe 写死第三方模型 ID 和供应商，容易随服务变化失效。
- 一些 shell wrapper 只是薄封装，输入校验、幂等、恢复和持久化弱于 Vetta 现有领域服务。
- 配方质量主要靠文字约定，没有系统化 evaluator 或 benchmark gate。
- 某些 recipe 会一次并行执行完整 campaign，未充分区分探索成本与最终成本。

对 Vetta 的正确映射是借用“三层能力模型”和“recipe 合同”，执行仍落在现有 Provider Registry、Generation Service、Artifact Store 和 command bus 中。

## visual-skills

### 可借鉴的设计

该项目对上下文问题的处理最直接：`SKILL.md` 刻意保持为路由入口，强制按顺序和任务形状读取 reference。

以 image Skill 为例：

1. 先判断任务是否真的是图片提示词任务。
2. 总是先读 `models.md` 选择模型家族。
3. 只读所选模型的专属文件。
4. 再读 universal golden rules。
5. 根据任务按需加载 editing、characters、storyboard、text rendering 或行业 pattern。
6. 复杂任务才读 creative direction 和 prompt framework。

这是一套清晰的渐进披露图，而不是把所有摄影、模型、行业知识塞进一个 system prompt。

其质量知识也比当前 preset 更可执行：

- 明确不同模型使用不同 prompt 结构，避免“通用提示词”稀释模型能力。
- 给出 banned vague words、positive framing、reference role、preserve list 等检查项。
- 视频要求每镜头至少包含环境压力、身体微动作、声音锚点或视觉母题。
- 限制每镜头一个主运镜，要求明确 ending image。
- 提供 continuity checklist、常见失败修复和 prompt compression 顺序。
- 输出协议区分 single prompt、multi-clip、storyboard、prompt audit 和 director treatment。

这说明“什么是好”不应只有一段角色提示词，而应拆成：路由、模型知识、任务 pattern、失败修复、输出合同和 checklist。

### 不应照搬的部分

- 它只写提示词，不负责真实生成、状态、费用、恢复和 artifact lineage。
- reference 体量很大，若 Vetta 在一次调用中全部加载，仍会重现上下文问题。
- 部分材料混用英语和俄语，不能直接成为 Vetta 面向模型的稳定资产。
- 模型规格会变化，需要从 Vetta capability registry 合并实时事实，不能把文档当唯一事实源。
- 许可证是 CC BY 4.0。若未来复制或改编具体文本、模板和例子，必须保留适当署名；本分析只抽象设计模式。

## ViMax

### 可借鉴的设计

ViMax 将复杂视频生产对 Agent 收敛为 3 个领域工具：

- `vimax_narrative_planning`；
- `vimax_novel_planning`；
- `vimax_render_video`。

领域内部则使用固定 DAG 和专职模块完成大量步骤：

```text
idea
  -> project brief
  -> characters
  -> script
  -> storyboard
  -> shot decomposition
  -> camera tree
  -> frame prompts
  -> keyframes
  -> clips
  -> final video
```

这体现了一个关键原则：**模型工具合同应描述用户级任务，繁重的阶段编排应由领域服务负责**。

ViMax 还有几项强实践：

1. `.working_dir/<session>/` 是 artifact authority，session index 只保存索引和摘要。
2. 每次 prompt 注入 artifact checklist；已存在的阶段不会只靠对话记忆判断。
3. 支持 session resume、stale 标记、原子保存、损坏索引备份、日志和上下文压缩摘要。
4. 阶段输出使用 Pydantic 结构约束，并对非法 character index 等模型错误做显式校验和重试。
5. 多个生成任务使用并行执行，但存在依赖的阶段仍按 DAG 顺序推进。
6. 生成多个候选图后，独立的视觉选择器比较人物一致性、空间一致性和描述准确性。
7. `vimax_benchmark` 包含 35 个跨单人、场景、多人物连续性的结构化故事样本，可作为回归语料的雏形。

### 不应照搬的部分

- ViMax 的完整 Agent 仍常驻 13 个通用工具和 3 个领域工具，并把轻量 tool manifest 额外写入 prompt；它不是工具渐进披露的完整答案。
- pipeline 比较固定，适合 Idea/Script/Novel to Video，不适合 Vetta 的开放画布和图片、社媒、品牌等多种交付物。
- 大量专业知识藏在单个 agent prompt 或 Python 模块中，不如 Skill/reference 资源图易维护和按需加载。
- benchmark 主要是样本集合，没有看到完整的自动评分、阈值、基线对比与发布 gate，不能把“有 benchmark 文件”视为已经建立 eval 系统。
- 视觉选择器返回一个最佳候选，但评分维度和置信度没有形成通用、可审计的 Evaluation artifact。

## 三个项目的互补关系

| 维度 | Generative-Media-Skills | visual-skills | ViMax | Vetta 应采用 |
| --- | --- | --- | --- | --- |
| 执行原语 | Core CLI/MCP | 不执行 | 3 个领域工具 + 内部 pipeline | 现有 command bus / generation service |
| 能力发现 | workflow catalog | Skill frontmatter 路由 | 固定三种 workflow | 轻量 recipe catalog + Skill 路由 |
| 知识加载 | 每个 recipe 独立 | 强制渐进 reference | 大 prompt + 专职 agent | 薄 Skill + task/model references |
| 工作流 | 丰富 recipe | 输出格式模板 | 可恢复阶段 DAG | recipe compiler + stage state machine |
| 质量 | 配方原则、人工选片 | rubric/checklist 很强 | 候选视觉选择 | 四层质量 gate |
| 状态恢复 | 较弱 | 无 | artifact authority/checklist | 延续现有 project/job/artifact，新增 stage/stale |
| Benchmark | 无系统基准 | 无 | 35 个结构化样本 | 自建可执行 eval suite |

组合后的正确方向是：

```text
Generative-Media-Skills 的能力分层和配方
  + visual-skills 的渐进专业知识和 rubric
  + ViMax 的阶段 DAG、artifact authority 和候选评审
  + Vetta 已有的安全命令总线、插件隔离、模型能力注册和确认卡
```

