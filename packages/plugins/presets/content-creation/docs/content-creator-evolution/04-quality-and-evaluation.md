# 质量与评测

## “好用”的可操作定义

一个真正好用的 content creator 至少要同时满足五个结果：

1. **意图正确**：交付物、受众、渠道和核心信息与用户目标一致。
2. **生产正确**：计划可执行，模型参数、reference、依赖、成本和恢复路径有效。
3. **创作质量**：画面或视频有明确主题、构图、动作、节奏、连续性和结束状态。
4. **交互效率**：用户不必理解节点协议，也不需要反复纠正模型选错工具。
5. **可解释与可改**：失败能定位到 brief、计划、prompt、模型或生成结果，并能局部修复。

“生成成功”只证明第二项的一部分。

## 四层质量 gate

### Gate 1：确定性结构检查

无需模型即可执行，失败时禁止进入下一阶段：

- schema 与必填字段；
- deliverable 和 surface 是否匹配；
- 图无非法连接、循环或孤立输出；
- model/mode/input/ratio/duration/resolution 来自 capability registry；
- reference role、preserve 和 ignore 是否明确；
- stage dependency 是否存在且非 stale；
- generation plan 是否绑定当前 revision；
- 付费调用是否有确认；
- workspace path、artifact lineage 和状态是否合法。

这类检查应返回稳定 code、severity、target 和 repair hint，不能只有自然语言错误。

### Gate 2：创作计划 rubric

在实际生成前评审 brief、storyboard 和 prompt。建议按 0-4 评分：

| 维度 | 关键问题 |
| --- | --- |
| Intent fit | 是否直接服务目标、受众、渠道和 message？ |
| Visual specificity | 是否使用可见、可拍、可生成的具体事实，而非空泛形容词？ |
| Composition | 主体层级、空间关系、画幅和文字安全区是否清楚？ |
| Motion clarity | 动作、环境运动、主运镜、节奏和 ending state 是否明确？ |
| Continuity | 人物、产品、场景、光源、道具状态是否有稳定锚点？ |
| Reference discipline | 每个素材的角色与忽略项是否明确，有无互相冲突？ |
| Model fit | 提示结构是否符合所选能力 profile，复杂度是否超出时长/模型容量？ |
| Platform fit | 时长、比例、字幕/文字区、信息密度和 CTA 是否适配渠道？ |
| Editability | 后续是否能定位并只修改一个主要变量？ |

阻断条件不应只看平均分。例如 continuity、model fit 或 intent fit 为 0 时直接阻断；其余维度可用总分阈值。

### Gate 3：生成结果评审

结果评审必须读取真实像素或视频抽帧，不能只看 prompt、文件名和 provider success。

图片最小检查：

- 主体与核心信息是否出现；
- 产品几何、人物身份和 reference 一致性；
- 构图、文字、裁切、手部和明显伪影；
- 颜色、光源和风格是否符合 brief；
- deliverable 尺寸和渠道安全区。

视频最小检查：

- 首帧、关键中间帧、末帧；
- 身份、服装、物体状态、场景和光源跨帧连续性；
- 动作链是否完成，是否出现融化、跳变、克隆或物体凭空出现；
- 运镜是否遵循一个主运动，剪辑是否符合 shot plan；
- 音频、对白、口型和字幕约束；
- duration、节奏和 ending image。

评审输出应是 `Evaluation` artifact，而不是一段聊天结论：

```ts
interface Evaluation {
  targetArtifactId: string;
  rubricVersion: string;
  scores: Record<string, number>;
  blockingIssues: Array<{ code: string; evidence: string }>;
  repairActions: Array<{
    kind: "edit-prompt" | "change-reference" | "change-model" | "regenerate" | "manual";
    target: string;
    instruction: string;
  }>;
  verdict: "pass" | "revise" | "reject" | "user-choice";
  confidence: number;
}
```

### Gate 4：人工选择与最终验收

以下节点应默认由用户决定：

- 多个创意方向之间的选择；
- 低成本候选中选择 hero/keyframe；
- 高费用 final/upscale/video generation；
- 会覆盖已确认产物的修订；
- evaluator 置信度低或候选差异是主观审美时；
- 最终交付前的 accept/revise。

用户选择应写入 lineage，后续生成继承被选中的 artifact，而不是只留在聊天文本中。

## 推荐生成闭环

```text
Brief
  -> Plan rubric
  -> low-cost candidates (N=2..4)
  -> visual evaluation
  -> user or evaluator selection
  -> one-variable revision
  -> final generation
  -> final evaluation
  -> accept / targeted repair
```

关键约束：

- 方向不确定时先探索，方向已由 reference 锁定时不机械生成 4 个候选。
- 每次修订只改变一个主要变量，才能判断修复是否有效。
- evaluator 不得把“与 prompt 一致”等同于“与用户目标一致”。
- 低置信度评审应升级给用户，而不是假装自动选择可靠。
- 失败重试要区分 transient provider error、content rejection、bad plan 和 bad output。

## Prompt 与镜头的基础检查

可先把以下规则机械化或半机械化：

### 图片

- 操作意图明确：create/edit/transform。
- 主体、环境、构图、光线、材质、palette 和用途至少覆盖任务需要的部分。
- 图片含文字时保存 exact text、位置、层级和安全区。
- 编辑任务有 `change/preserve/constraints`。
- 避免只使用“cinematic/stunning/masterpiece/4K”等不可验证词。
- reference 有一一对应的 role。

### 视频

- 每个 shot 有环境压力、身体微动作、声音锚点或视觉母题中的必要组合。
- 每个 shot 只指定一个主运镜。
- 情绪通过可观察动作表达。
- 有明确首帧状态、动作结果和 ending image。
- 多 clip 重复 continuity anchor。
- image-to-video 重点写运动，不冗余复述已固定的静态画面。
- 时长与 beat 数匹配，不能把 30 秒叙事塞进 5 秒。

## Benchmark 设计

### 用例集合

第一版建议 20-30 个固定任务，覆盖：

- 单张图片：产品 hero、人物海报、带文字社媒图、图片编辑；
- 图片系列：多角度产品、角色一致性、campaign 多比例；
- 单镜头视频：text-to-video、image-to-video、产品 reveal；
- 多镜头视频：人物连续性、物体状态连续性、简单对白；
- 工作流编辑：复用已有节点、改变交付物、替换 reference；
- 恢复与失败：provider 不可用、revision 冲突、中途取消、resume；
- 安全与费用：破坏性操作、昂贵生成、用户拒绝确认；
- 路由负例：普通问答不应加载 content-creation 工具。

每个 case 保存：用户输入、初始项目、可用能力、期望阶段、结构不变量、rubric 和允许的结果范围。不要保存单一“黄金 prompt”作为唯一正确答案。

### 指标

#### 上下文与工具效率

- 首轮/全程 tool schema token；
- 激活工具数量；
- Skill/reference 加载 token；
- 平均工具调用轮数；
- 重复 inspect 比例；
- unknown/invalid tool input 比例；
- revision conflict 后无效重试比例。

#### 任务与交互

- brief 一次通过率；
- 无用户协议知识情况下的任务完成率；
- 用户澄清次数；
- 用户返工次数和返工目标层级；
- 从请求到首个可评审候选的时间；
- 从请求到最终验收的时间与费用。

#### 质量

- 结构 gate 通过率；
- rubric 各维度分布；
- identity/product/scene continuity；
- 候选选中率与 evaluator/user 一致率；
- 最终 accept、revise、reject 比例；
- 同一 case 跨版本的盲评胜率。

### 基线与发布 gate

先记录当前 7-tool 实现基线，再比较每个阶段：

1. hard isolation；
2. 3-tool surface；
3. brief/plan compiler；
4. progressive Skill；
5. candidate/evaluator loop。

建议发布 gate：

- 非内容任务中插件 tool schema token 必须为 0；
- 内容任务首轮激活工具不超过 2 个；
- 结构合同与安全 gate 100% 通过；
- invalid tool input 和重复 inspect 相比基线显著下降；
- 固定 benchmark 的完成率不下降；
- 人工盲评质量胜率达到预设提升，并报告费用变化；
- 任何质量提升不能以静默增加付费生成次数换取。

## 评测实现注意事项

- evaluator prompt、rubric 和版本必须可追踪。
- 自动 judge 只作为一个信号，定期用人工盲评校准。
- creator 与 evaluator 使用不同 prompt block，最好是独立模型调用。
- 对供应商随机性至少重复运行若干次，报告均值和方差。
- 将 prompt/metadata 评测与真实像素评测分开，禁止用前者替代后者。
- benchmark 默认使用 mock provider 或受控低成本配置；真实付费回归需要显式授权。

