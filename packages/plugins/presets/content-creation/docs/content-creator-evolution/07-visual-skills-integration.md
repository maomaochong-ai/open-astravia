# visual-skills 融合记录

本轮完整阅读 `visual-skills` 的 `image`、`video` 两个 `SKILL.md` 以及全部 34 份 reference。融合不是复制成一个常驻超级 Prompt，而是保留其“薄入口、强制基础读取、任务形状加载、模型专属语法”的方法，并适配 Vetta 的 capability registry、节点工作流、确认卡和三工具控制面。

来源：Serge Shima 的 [smixs/visual-skills](https://github.com/smixs/visual-skills)，本地快照 `3c55471`，许可证 CC BY 4.0。本项目内容经过重新组织、改写和能力边界适配；署名同时保留在相关 Skill 中。

## 顶层 Skill 映射

| visual-skills | Vetta | 融合方式 |
| --- | --- | --- |
| `image` | `direct-image-creation` | 保留 route-first、模型 Profile、通用规则、任务 reference 和交付前质量检查；输出改为节点 Prompt 与引用计划。 |
| `video` | `direct-video-creation` | 保留导演/编剧/剪辑复合角色、戏剧检查、模型语法、镜头卡、连续性和失败修复；接入工作流与 timeline。 |
| 外置 `creative-director` 依赖 | `develop-creative-concept` | 在 Vetta 内补齐策略、Big Idea、treatment、beat spine 和概念选择，不让模糊想法直接进入生成。 |

## Image reference 覆盖

| 原 reference | Vetta reference |
| --- | --- |
| `models.md`、`gpt-image.md`、`nano-banana.md` | `model-routing.md`、`model-prompt-profiles.md` |
| `golden-rules.md`、`prompt-framework.md` | `prompt-framework.md`、`production-prompt-skeletons.md` |
| `editing.md`、`characters.md` | `editing-and-continuity.md`、`fashion-portrait-and-character-patterns.md` |
| `text-rendering.md` | `text-and-information-design.md` |
| `creative-direction.md` | `prompt-framework.md`、`visual-decomposition.md` |
| `vision-decomposer.md` | `visual-decomposition.md` |
| `structural.md`、`dimensional.md` | `structural-and-dimensional-control.md` |
| `storyboards.md`、`multi-panel.md` | `multi-panel-and-sequential.md`、视频 `animatic-keyframes.md` |
| `slides.md` | `presentation-visuals.md` |
| `patterns/ecommerce.md`、`patterns/food-beverage.md` | `commerce-and-food-patterns.md` |
| `patterns/fashion-editorial.md`、`patterns/portrait-cinema.md`、`patterns/character-design.md` | `fashion-portrait-and-character-patterns.md` |
| `patterns/poster-illustration.md`、`patterns/ui-social.md` | `poster-ui-and-social-patterns.md` |

## Video reference 覆盖

| 原 reference | Vetta reference |
| --- | --- |
| `dramaturgy.md` | `dramaturgy-and-shot-design.md`、`shot-cards-and-rhythm.md` |
| `universal-rules.md` | `prompting.md`、`continuity-and-references.md`、`quality-checklist.md` |
| `seedance.md`、`seedance-25.md`、`kling.md`、`veo.md` | `model-prompt-profiles.md`、`production-prompt-skeletons.md` |
| `role-modes.md` | `role-modes-and-output-contracts.md` |
| `patterns-and-genres.md` | `genre-and-montage-patterns.md` |
| `fixes-and-skeletons.md` | `failure-repairs.md`、`production-prompt-skeletons.md` |
| `camera-lighting-vocabulary.md` | `camera-light-sound-vocabulary.md` |
| `animatic-keyframes.md` | `animatic-keyframes.md`，并交接到图片 Skill 生成静帧 |
| `race-and-speed.md` | `kinetic-speed.md` |

## 适配原则

### 保留

- 模型 Profile 决定提示词结构，通用 Prompt 不强行抹平模型差异。
- 图片使用明确 operation、正向表达、参考角色和单变量迭代。
- 图片编辑使用 `Change / Preserve / Constraints` 合同。
- 视频使用场景公式、每镜三细节、镜头职责、动机相机、节奏阶梯、五个 anchor 和 final image。
- 多素材逐个绑定角色并声明忽略项；更多素材不等于更多控制。
- 先低成本候选/证明镜头，再做高成本最终资产。
- 失败必须映射到 brief、reference、structure、capability 或 stochastic 层，而不是无限重抽。

### 不直接复制

- 模型价格、发布时间、营销描述和快速变化的版本能力。
- Vetta capability descriptor 未声明的参考数量、音频、对白、首尾帧、partial re-render、native extension 和 Provider UI 开关。
- Provider CLI flags；duration、ratio、resolution 等放入节点字段而不是 Prompt。
- 参考项目中互相矛盾或过度泛化的固定限制，例如把所有长视频都固定拆成 5 秒片段。
- 只能由专业 CAD、事实校验或后期系统保证的准确性声明。

## 运行时读取顺序

图片任务：

```text
inspect capabilities
  -> model-prompt-profiles + prompt-framework
  -> 一个或少量 task-shaped references
  -> production-prompt-skeletons（需要直接模板时）
  -> quality review
```

视频任务：

```text
inspect capabilities
  -> dramaturgy-and-shot-design + prompting + model-prompt-profiles
  -> role / shot-card / genre / animatic / edit / speed 中的相关 reference
  -> production-prompt-skeletons
  -> rendered-frame review
```

这样可以尽可能吸收 visual-skills 的专业内容，同时避免把 34 份 reference 重新变成每轮常驻上下文。
