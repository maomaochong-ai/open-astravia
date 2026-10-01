# 通用 Agent Skill 作用域：Astravia 原生优先、只读保护、核心默认开

在 Astravia 专属 Skill 作用域之外，新增对通用 Agent Skill 约定目录的支持：全局 `~/.agents/skills/` 与项目级 `<cwd>/.agents/skills/`。从这两处加载的 skill 打来源标记 `agents-user`/`agents-project`，纳入 agent 发现范围，但**只读、不参与平台市场托管**。详见 [[通用 Agent Skill 作用域]]。

## 背景

Astravia 此前只从专属作用域（`~/.astravia/agent/skills/`、`<cwd>/.astravia/skills/`）发现 skill。用户希望让别的 Agent（按业界 `.agents/skills` 约定组织的）写好的 skill 原样可用，并能在 desktop「Agent配置 → 扩展功能」里以「适配通用 Agent Skill」开关控制（默认开、可关）。

接入时有三个非显然的取舍点：同名碰撞谁优先、agent 能否写这些目录、CLI 默认是否也开。

## 决策与理由

1. **Astravia 原生优先于通用**：通用 Agent Skill 目录在所有 Astravia 原生来源之后加载，加载顺序 `user → project → scene → agents-user → agents-project`，先加载者胜，故同名时 Astravia 专属 skill（含 scene）胜出。通用 Agent Skill 定位为补充，不得意外覆盖内置/受管 skill。

2. **只读保护**：两处 `.agents` 目录均加入 agent 路径保护（`isProtectedSkillOrScenePath`），禁止 agent 在任务中新增/修改——skill 目录按「只读 + 可执行」对待，与 Astravia 自家 skill 目录同等。

3. **核心默认开**：coding-agent 核心 `loadSkills` 的 `includeAgentsSkills` 缺省 `true`，CLI/独立调用也享受通用兼容；desktop 关开关时经 `SessionConfig.includeAgentSkills` 传 `false`。一处布尔贯穿，行为单一来源。

4. **发现规则只认子目录 `SKILL.md`**（不认根目录散装 `.md`），严格对齐业界 Agent Skill 约定，别的 Agent 的 skill 原样落入即可用。

5. **desktop 列表只读 + 仅全局**：`agents-*` 来源在 desktop 设置列表纯展示（无单项启停/卸载），且受全局设置作用域所限只显示 `~/.agents/skills`（与项目级 `.astravia/skills` 同样不进全局列表）。

## 考虑过的备选

- **通用优先于 Astravia 原生**（`agents-*` 盖过 `user/project`）：契合「外部约定优先」直觉，但会让通用目录里的同名 skill 意外遮蔽内置/受管 skill，违背「补充而非覆盖」。
- **按作用域分组排序**（`user → agents-user → project → agents-project`）：语义上「越全局越优先」，但打乱既有 `user→project` 结构，且收益不明。
- **可写 `.agents/skills`**（不保护）：允许 agent 在通用目录创建 skill，更灵活；但与「skill 目录只读」的统一纪律冲突，且易让任务误改共享约定目录。
- **核心默认关、仅 desktop 显式开**：语义更「这是 desktop 适配能力」，但 CLI/独立用户享受不到通用兼容，且要再引入一条 CLI 侧开关。

## 影响

难回退：用户依赖「Astravia 原生优先」与「`.agents` 只读」的预期后，反转优先级或放开写入都会让既有行为落空。未来读者若疑惑「为何 `.astravia` 同名 skill 总是赢过 `.agents`」「为何 agent 不能在 `.agents/skills` 建 skill」「为何 CLI 也扫 `.agents`」——本 ADR 即「为何如此」。
