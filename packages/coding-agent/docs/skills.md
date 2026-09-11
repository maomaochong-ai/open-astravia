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
- 可选：`disable-model-invocation`。`agent_mode` 已废弃（ADR-0071）：容忍存在但无任何运行时语义，不排序、不过滤，请不要在新 Skill 里写它。
- 安全：Skill 可指示执行任意操作，安装前审查内容。

Desktop 产品界面允许 Skill 在 namespaced metadata 中显式声明图标；这是 Vetta 的呈现扩展，不改变 Agent Skills 的加载、身份或调用语义。值可以是 `solar:*` 图标名、HTTPS URL，或相对于 Skill 目录的 `.avif`、`.gif`、`.ico`、`.jpeg`、`.jpg`、`.png`、`.svg`、`.webp` 文件：

```yaml
metadata:
  vetta:
    presentation:
      icon: assets/icon.svg
```

## 调用

```text
/skill:my-skill
/skill:my-skill arg1 arg2
```

实现：`src/resources/skills/`。
