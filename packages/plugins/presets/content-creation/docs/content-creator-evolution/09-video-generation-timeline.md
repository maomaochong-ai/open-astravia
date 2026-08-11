# 视频生成时间线与分镜

## 目录

- 纠正后的定义
- 参考仓库中的真实模式
- 实施后的层级
- Prompt 时间窗合同
- 典型 Prompt 片段
- 本轮文件落点
- 已知边界

## 纠正后的定义

本轮用户所说的“时间线”是**写给视频生成模型看的 Prompt 内时间线**：在一次 5、10、15 或 30 秒生成请求中，用连续时间窗说明每一阶段的可见事件、镜头、声音和结束状态。

```text
视频生成节点
  prompt:
    全局身份/商品/环境/风格约束
    [00:00-00:03] 建立：进入状态 -> 一个事件 -> 结束状态
    [00:03-00:07] 发展：继承上窗 -> 一个事件 -> 结束状态
    [00:07-00:10] 收束：继承上窗 -> 最终画面与停留
```

## 参考仓库中的真实模式

### visual-skills

`visual-skills` 的视频 references 将时间码直接放在生成 Prompt 中：

- 短片可按建立、动作、转折、反应、高潮/hero 分配秒数；这些是一次生成内的事件预算。
- 较长生成把总时长拆成连续 stages，每段只承担一个主要状态变化，并声明可见结束状态。
- 时间范围约束模型在该阶段关注什么。
- 精确秒数用于关键交接，其他地方可用“门打开后”“物体落地时”等相对触发。
- 多镜头语法只在对应模型 Profile 明确支持时使用，不能把某个模型示例泛化为全局能力。
- 分镜先经过戏剧 beat、镜头职责和节奏三层规划，再翻译成 timecoded storyboard。

### Generative-Media-Skills/library

Library 的 ceremony、freeze effect、UGC、cooking、fight 和 `seedance-2` 等细分 Skill，价值在于把场景机制写成具体时间链：

- 颁奖：宣布 -> 获奖者反应 -> 走向舞台 -> 交接 -> hero hold。
- 时间静止：正常运动 -> 触发 -> 静止证明 -> 恢复 -> 后果。
- 教程：环境与工具建立 -> 单步动作 -> 下一状态 -> 完成结果。
- 打斗：地理建立 -> 威胁/防御 -> 反转 -> 冲击 -> 恢复或收束。
- UGC：hook -> 使用 -> 可见证据 -> CTA/商品 hold。

这些阶段需要映射为视频模型能执行的物理事件，而不是把阶段名称写进项目剪辑轨道。

### ViMax

ViMax 的主要启发仍是阶段化 DAG、artifact authority、候选评审与恢复。它帮助 Vetta 决定何时生成分镜板、何时验证高风险运动、何时扩展镜头。

## 实施后的层级

```text
Creative brief
  -> dramatic / information beats
  -> storyboard panels and shot cards
  -> generation mode decision
       continuous one-shot
       timestamped stages
       timestamped multi-shot (capability gated)
       independent ordered generations
  -> video-node prompt with generation timeline
  -> output review by time window / phase
```

分镜与生成时间线之间是一一可追踪的翻译关系：

| 分镜字段 | 生成时间线中的职责 |
| --- | --- |
| Panel/Shot ID | 连接计划、参考板、Prompt 与评审证据 |
| 镜头职责 | 说明该时间窗为什么存在 |
| 起始画面 | 定义进入状态与构图 |
| 峰值动作 | 限制为一个可见物理变化 |
| 结束画面 | 成为下一窗的交接状态 |
| 相机 | 景别、路径、速度与停靠点 |
| 连续性 | 身份、商品、道具、地理、运动方向、光线 |
| 音频提示 | 在能力支持时绑定对白、环境声、音效、音乐或静默 |

## Prompt 时间窗合同

每个时间窗使用以下信息合同，实际输出时可按模型语法压缩为自然语言：

```text
[00:00-00:03] <beat name / shot function>
Entry state: <进入时已经稳定可见的状态>
Primary event: <一个主要动作或状态变化>
Camera: <一个主要镜头运动及停靠点>
Physical evidence: <环境响应、身体或物体微动作>
Audio: <能力支持时的对白/环境声/音效/音乐/静默>
End state: <边界时必须可见的状态>
Carry forward: <下一窗必须继承的身份、位置、方向、光线、运动>
Avoid: <该阶段特有的失败形态>
```

硬约束如下：

1. 时间窗从零覆盖到请求总时长，连续且不重叠。
2. 每窗通常只有一个主要状态变化、一个主要主体动作和一个主要相机运动。
3. 时间窗是事件预算。
4. 每窗必须有可见结束状态，下一窗默认继承。
5. 抽象情绪必须翻译成视线、姿态、呼吸、动作迟疑、距离变化等物理表现。
6. 对不支持原生音频的模式，只输出同时间窗对齐的 cue sheet，不声称已生成或同步。
7. 对不支持单次多镜头的模式，拆成独立视频节点并返回顺序清单。

## 典型 Prompt 片段

```text
Duration: 10 seconds. One continuous tabletop camera path. No cuts.

[00:00-00:03] Establish — the sealed product stands on the counter; a hand enters from frame right. A slow lateral slide reveals the unchanged label.
[00:03-00:07] Demonstrate — the hand opens the cap and dispenses one drop; macro focus follows the drop while product geometry stays stable.
[00:07-00:10] Resolve — the hand exits; focus returns to the label. Camera settles into a stable hero frame for the final second.
```

该示例中 `00:03` 和 `00:07` 是给视频模型的阶段边界，整个文本保存为一个视频节点 Prompt。

## 本轮文件落点

- `direct-video-creation/references/generation-timeline-and-storyboard.md`：定义生成时间线、连续单镜头、多镜头、分镜映射和质量 gate。
- `direct-video-creation/references/generation-timeline-examples.md`：提供 5/10/15/20/30 秒的动作、商品、颁奖、时间静止、UGC、教程和情绪表演示例。
- `direct-video-creation/SKILL.md`：把所有 storyboard、timed sequence 和 pacing 请求路由到上述 references。
- Campaign 与细分视频 recipes：统一使用“有序生成清单”或“生成 Prompt 内时间窗”。

## 已知边界

- 示例秒数是结构范式，不是所有 Provider 的固定能力。
- Capability registry 仍是 duration、input slot、audio、multi-shot 与 first/last-frame 支持的事实源。
- 当前实现增强的是模型的规划和 Prompt 质量；转录、裁切或渲染仍以 capability registry 为准。
