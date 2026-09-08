# ADR-0109：团队成员任务书是增量，不是分叉

## 状态

已接受（首期实现：职责摘要与团队内补充指令）

## 背景

Agent Profile 是智能体的本体：名称、人格（blueprint 或 `system-prompt.md` 覆盖）、能力勾选。团队通过 `TeamMember.binding` 引用它。

`TeamMember` 目前只有三个字段——`id`、`handle`、`binding`，而且 `UpdateTeamInput` 对已有成员**只允许改 `leader` 一个布尔值**。团队运行时用到的两项都直接穿透到本体：

- 全队可见的职责摘要 `responsibilitySummary` 取自 `profile.description`；
- 成员的角色提示词取自 `profile.systemPrompt ?? blueprint.systemPrompt`。

于是同一个 Agent 入不同团队后没有任何差异表达能力。现存的唯一出路是入团时选 `copy` 绑定：复制出一份 `scope: { kind: "team" }` 的独立 Profile，与本体**永久脱钩**——本体升级不再流入，副本要单独维护，智能体库里还多出一份影子档案。

也就是说只有 0%（完全跟随）和 100%（完全分叉）两档，缺少产品上最常见的那一档：**同一个 Review，在 A 团队盯安全边界，在 B 团队盯交付节奏，但人格底座、能力与后续升级仍然共享**。

## 决策

1. **增量挂在 `TeamMember` 上，`AgentProfile` 保持单一真相。** 新增可选的 `TeamMember.assignment`（任务书）。引用关系不断，本体的人格与能力升级继续自动流向每个团队。不引入第二种 Profile，不扩大 `copy` 的职责。

2. **首期两个字段**：

   ```ts
   interface TeamMemberAssignment {
     readonly responsibility?: string;  // 覆盖全队可见的职责摘要
     readonly instructions?: string;    // 追加在本体人格之后的团队内交待
   }
   ```

3. **`instructions` 是追加语义，不是替换。** 它作为独立的 `<team_assignment>` 段落拼在 `<agent_team_member_identity>` 之后，本体人格与 blueprint 的团队协作纪律（不得转移 Team 任务归属、subagent 不是团队成员等）原样保留。替换语义会让团队编辑者有能力在不知情的情况下冲掉协作契约。

4. **`responsibility` 的覆盖是全队可见的，不是私有备注。** 它进入 `buildTeamRosterSnapshot()` 的 `responsibilitySummary`，因而出现在每位成员的共享名册里——这正是目的：队友需要知道他在**这个**团队里负责什么，leader 才能据此分派。与之相对，`instructions` 只进入该成员自己的成员上下文，不进入共享名册，也不经 `team_list_members` 暴露。

5. **落盘遵循既有的「JSON 存索引、Markdown 存长文本」合同（ADR-0106）。** `responsibility` 是一句话，内联进 `team.json` 的成员条目；`instructions` 是长文本，落在团队目录下的 `members/<member-id>.md`，可独立 diff 与人工编辑。成员被移出团队时对应文件随之清理。

6. **空白即取消覆盖。** 空串、纯空白与字段缺省是同一种状态：回到本体。不允许把空串持久化——那会让下游 `?? profile.description` 的兜底失效（同 ADR 无关，但与 `system-prompt.md` 曾踩过的坑同源）。

7. **任务书变更计入 `team.revision`。** 成员运行时按既有的 revision 重配置机制刷新，不需要为任务书新增第二条生效路径。

## 后果

- 「入团做增量」有了正式表达，`copy` 绑定退化为「彻底分叉」这一少数场景；智能体库不再因为想改一句职责而被影子档案污染。
- `UpdateTeamInput` 的已有成员条目从「只能改 leader」放开到「可写任务书」，团队设置抽屉因此获得成员级编辑入口。
- 团队目录多出 `members/` 子目录；文件仓储需要在成员移除时清理孤儿文件，这是新增的持久化边界，必须有测试覆盖。
- 名册摘要不再等同于 Agent 描述。任何依赖「roster 摘要 == profile.description」的假设都会失效，需要改读 `resolveMemberResponsibility()`。

## 不在本决策范围

- **能力（技能 / MCP / 插件）的团队内收窄**。契约上留白，本次不实现：它需要一套「只允许收窄、不允许扩张」的编辑语义（本体为「继承全部」时如何展示、超出本体的选项如何禁用），属于独立的产品与交互问题。在这套交互定下来之前，不先把字段写进 schema——没有写入路径的持久化字段只会变成下一处死契约。想给团队里的成员加能力，仍然去改本体；想减，暂时只能用 `copy`。
- 成员 `handle` 的团队内改名（当前仍只在入团时确定）。
- 任务书的模板化、跨团队复制与市场分发。
