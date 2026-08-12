# Skills

按需加载的能力包（[Agent Skills](https://agentskills.io/specification)）。发现名称与描述进系统提示；模型用 `read` 或 `/skill:name` 加载全文。

## 发现位置

- 用户：`~/.vetta/skills/`、`~/.vetta/agent/skills/`、`~/.agents/skills/`
- 项目：`<cwd>/.vetta/skills/`、`<cwd>/.agents/skills/`（可沿祖先到 git 根）
- 包 / settings `skills` / CLI `--skill`
- `--no-skills` 关闭发现（显式 `--skill` 仍加载）

规则：目录下直接 `.md`，或子目录中的 `SKILL.md`（递归）。

兼容其他 harness：在 settings 里加路径，例如 `"skills": ["~/.claude/skills"]`。

## 结构

```text
my-skill/
  SKILL.md          # 必需
  scripts/ …        # 可选
```

```markdown
---
name: my-skill
description: 一句话说明何时使用
---
步骤与约定……
```

- `name` / `description` 建议符合规范；校验宽松，违规会告警。
- 可选：`agent_mode`（主推的工作模式；纯排序偏好，不会在其它模式下隐藏该 Skill）、`disable-model-invocation`。
- 安全：Skill 可指示执行任意操作，安装前审查内容。

## 调用

```text
/skill:my-skill
/skill:my-skill arg1 arg2
```

实现：`src/resources/skills/`。
