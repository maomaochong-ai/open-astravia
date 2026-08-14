# 现状诊断

## 当前实现已经具备的可靠基础

当前实现并非只有一组简单工具。以下边界值得保留：

- UI 与 Agent 都通过 `ContentCreationWorkspace.dispatch()` 修改项目，项目 JSON 不是控制面。
- `expectedRevision`、一次性 preview token 和确认卡解决了并发修改与破坏性操作授权。
- 付费生成先 `prepareRun()`，用户确认后才执行；依赖按拓扑顺序运行，上游失败会跳过下游。
- `inspect(scope)` 已能分离 project、runtime、capabilities 和 diagnostics。
- Provider、模型能力、job、artifact 和项目持久化已有独立领域边界。
- Agent state 会移除画布坐标、私有存储 ID、预览 URL 和无关时间戳，说明实现已经意识到模型上下文需要语义化。

这些能力构成后续演进的底座。问题主要出在模型入口的粒度、创作知识组织和质量状态缺失，而不是项目仓库或命令总线本身。

## 工具面的具体问题

当前 `register-tools.ts` 常驻注册 7 个工具：

| 工具 | 主要问题 |
| --- | --- |
| `open_content_creation` | UI 副作用可以由 edit/run 成功后自动触发，作为独立模型工具价值有限。 |
| `content_creation_get_state` | 与 `content_creation_inspect(scope="all")` 重复。 |
| `content_creation_inspect` | 方向正确，但 `all` 仍可能一次返回完整项目、模型目录、运行态和诊断。 |
| `content_creation_preview_operations` | 与 apply 使用同一大型 operation schema，且把安全路径选择交给模型。 |
| `content_creation_apply_operations` | 同上；模型还需记住删除不能走此工具。 |
| `content_creation_prepare_generation` | 合理的高成本闸门，但“计划质量是否达标”尚未进入准备条件。 |
| `content_creation_get_run` | 与 inspect/runtime、消息卡片订阅存在状态读取重叠。 |

即使模型只调用其中一个，全部工具的名称、描述和 JSON Schema 仍会进入请求工具面。尤其 `CONTENT_AGENT_OPERATION_SCHEMA` 同时服务 preview 和 apply，包含 10 种 operation 与 30 余个可选字段，重复暴露了两次。

这产生四类成本：

1. **静态 token 成本**：每次模型调用都携带未使用工具的 schema。
2. **选择成本**：模型要区分 get-state/inspect、preview/apply、runtime/get-run 等近义入口。
3. **协议记忆成本**：模型必须记住“先 inspect、删除走 preview、生成走 prepare、确认后才算开始”等跨工具规则。
4. **错误恢复成本**：低层 operation 失败后，模型需要重新读取 revision、修复批次并再次提交。

## 隔离机制没有被使用

（注：`agent_mode` 硬闸已随 ADR-0071 整体废弃，插件在所有模式下常驻。）普通 Work 会话都会加载该插件的 tools、skills 和 system prompt。当前没有：

- `contributionMode.hardIsolation`；
- 与内容创作入口绑定的 hard-isolation input action；
- `registerSystemPromptProvider()` 的逐轮 `setToolEnabled`；
- `agent.tools.control` 权限；
- 插件 Tool 的 deferred discovery。

因此“内容创作”只是众多 Work 能力之一时，也会一直占据上下文。现有宿主已经支持前两类能力，短期无需修改 Agent 内核即可改善；插件 Tool 的通用 deferred discovery 则属于后续宿主级增强。

## Skill 的具体问题

当前两份 Skill 分工是：

- `operate-content-workflow`：规定安全操作循环。
- `direct-video-creation`：提供视频 brief、shot 与提示词原则。

它们解决了“怎么调用现有工具”，但没有完整回答“怎样产出好的内容”：

1. 没有图片创作、编辑、排版、产品图、社媒素材等独立专业 Skill。
2. 视频 reference 总量较小，缺少按模型、题材、失败类型加载的知识树。
3. 常见 workflow 只有四条拓扑示例，没有输入合同、阶段 gate、成本策略和 fallback。
4. 没有统一的输出协议，例如 `CreativeBrief`、director treatment、storyboard、prompt audit。
5. quality checklist 只在推荐重生成前要求阅读，没有成为生成前/后的可执行检查。
6. Skill 说明模型“保持一致性”，项目状态却没有 continuity bible 或跨镜头不变量。

## 领域模型仍偏“画布正确”，不够“生产正确”

当前项目能表达：节点、边、素材、生成任务和 deliverable。但以下信息没有成为一等对象：

- 用户目标、受众、发布渠道和成功标准；
- 视觉方向、禁用方向和品牌约束；
- 人物、产品、场景、服装、道具等 continuity anchors；
- 镜头功能、节拍、首帧、末帧、声音和转场；
- reference asset 的明确角色与忽略项；
- 探索稿、入选稿、最终稿之间的 lineage；
- 每个阶段的 rubric、评分、失败原因和修复建议；
- 已完成阶段与因上游修改而 stale 的下游阶段。

因此模型目前最容易做出的结果是“prompt -> generator -> output”的合法图，而不是有创意策略、连续性和验收依据的生产计划。

## 诊断只覆盖可执行性，不覆盖创作质量

`diagnoseContentProject()` 当前检查：

- generator 是否有有效 prompt；
- provider/model 是否可用；
- output 是否有输入；
- deliverables 是否定义；
- 最近生成是否失败。

这些是必要的执行前诊断，但还不是质量判断。系统无法发现：

- prompt 只有“cinematic, stunning, 4K”等空泛词；
- 一个 5 秒镜头堆叠多种冲突运镜；
- 多镜头人物服装、产品几何或光源漂移；
- image-to-video 重复描述静态画面却没有说明运动；
- reference 未声明用途，导致素材特征互相污染；
- 横屏 deliverable 使用竖屏计划；
- 成片缺少明确的 ending image 或行动结果；
- 生成结果虽然成功返回，但不符合用户目标。

## 当前流程的主要失败模式

### 失败模式一：模型很勤奋，但做的是低价值结构劳动

模型消耗大量 token 构造 node id、connection、operation 和 revision，却没有足够预算做创意推演、候选比较和质量审核。

### 失败模式二：一次生成承担了探索与交付两种职责

缺少“低成本多候选 -> 选择 -> 局部修订 -> 高质量最终稿”的状态。模型通常直接提交一个昂贵生成，失败后再盲目重试。

### 失败模式三：模型既创作又自我验收

同一个上下文用同一套含糊标准生成并宣布完成，容易产生确认偏差。系统没有独立 evaluator、像素检查或用户选片 gate。

### 失败模式四：Skill 与运行时能力可能漂移

Skill 提供一般规则，具体模型能力来自 `inspect(capabilities)`，但没有 model profile 将两者组合。模型必须临时完成知识与能力的 join，容易选择不可用参数或错用某模型的提示语法。

## 根因归纳

```text
常驻且重复的低层工具
  + 以画布 operation 为中心的模型合同
  + 创作知识不完整且没有渐进路由
  + 质量标准只存在于自然语言建议
  + 没有候选、评审、选择、修订的生产状态
  = 能搭工作流，但无法稳定交付好内容
```
