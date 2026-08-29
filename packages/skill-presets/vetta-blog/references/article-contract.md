# Vetta Blog 证据包与文章合同

## 推荐目录

```text
<output>/<slug>/
  article.md              # 正文，首行附近包含 <!-- vetta-blog: article -->
  evidence.json           # 事实与体验台账
  visual-brief.md         # 图片目标、构图、禁用项和提示词版本
  visual-review.json      # 实际图片审查结果
  revision-log.md         # 每轮修订与未解决风险
```

用户已有目录时尊重其路径；只要能通过 CLI 参数明确四个文件即可。

## `evidence.json` 最小结构

```json
{
  "observed_at": "2026-08-29",
  "article_type": "comparison",
  "audience": "已经使用 coding agent、需要可审查本地工作流的开发者",
  "claims": [
    {
      "id": "C1",
      "text": "Vetta 的 Skill hook 位于 SKILL.md 顶部 frontmatter 的 hooks 字段",
      "importance": "high",
      "status": "verified",
      "evidence_ids": ["S1"],
      "counterevidence_checked": true
    }
  ],
  "sources": [
    {
      "id": "S1",
      "kind": "first_party_code",
      "title": "skill-document.ts",
      "url": "https://github.com/openvetta/open-vetta/blob/dev/packages/coding-agent/src/resources/skills/skill-document.ts",
      "accessed_at": "2026-08-29",
      "supports": ["C1"],
      "notes": "源码读取 frontmatter.hooks 并创建 hook contribution"
    }
  ],
  "experiments": [
    {
      "id": "E1",
      "date": "2026-08-29",
      "environment": "Windows 11, Vetta dev checkout",
      "input": "带 PostToolUse hook 的 fixture Skill",
      "steps": ["invoke_skill", "执行 Write", "读取 hook additionalContext"],
      "observed": "hook 被注册并返回反馈",
      "result": "pass",
      "retries": 0,
      "claim_ids": ["C1"],
      "artifact_paths": ["packages/coding-agent/test/runtime-core/skill-hook-invocation.test.ts"]
    }
  ],
  "revision_log": [{ "issue": "初稿缺少 hook 失败边界", "change": "补充 fail-open 条件", "rechecked_claim_ids": ["C1"] }]
}
```

`status` 只能是 `verified`、`partial`、`unverified`、`contradicted`；中心结论对应的 high claim 不能是 `unverified`。正文在相关断言后放 `<!-- claim:C1 -->`，让发布门禁能确认正文与台账真的绑定。意见、预测和偏好标成 `opinion` 并从事实覆盖率中排除，不要伪装成已验证事实。发布候选至少有 3 个由 `first_party_code`、`first_party_test`、`first_party_docs` 或 `first_party_release` 来源支持的 Vetta 仓库事实。

比较/趋势文章还要有：`comparison_protocol`（共同任务、输入、标准、停止条件、交付物）；至少一个外部 `competitors` 条目；每个条目的 `source_ids` 与 `experiment_ids`；至少两个 180 天内访问的外部官方来源。易变的价格、版本、平台支持、星数等 claim 标 `volatile: true`，对应来源提供 `published_at` 或明确观察日期。

## `visual-review.json` 最小结构

```json
{
  "status": "approved",
  "path": "hero.png",
  "width": 1600,
  "height": 900,
  "checked_at": "2026-08-29",
  "pixel_checked": true,
  "brief_path": "visual-brief.md",
  "candidates": [
    { "id": "A", "path": "hero-a.png", "axis": "构图" },
    { "id": "B", "path": "hero-b.png", "axis": "构图" }
  ],
  "selected_candidate_id": "A",
  "selection_reason": "A 的标题留白和移动端焦点更稳定",
  "checks": {
    "article_thesis": "pass",
    "vetta_palette_roles": "pass",
    "title_safe_area": "pass",
    "mobile_crop": "pass",
    "legibility_and_artifacts": "pass"
  },
  "observations": ["珊瑚色只作焦点，米白底和墨绿文字在缩略图仍分离"],
  "revision_needed": false
}
```

`status=approved` 只能在实际像素被查看后使用。图片文章至少生成/检查两个只改变一个轴的候选；`path`、`brief_path`、候选文件、选择理由、尺寸和 `pixel_checked` 都必须与本地 artifact 一致。任何 `fail`、`unknown` 或缺字段都应为 `needs_revision`/`needs_input`，而不是“基本通过”。图像模型生成的 Logo、版本号、统计和 UI 文字默认不可信。

## 文章类型模板

### 产品/版本故事

开头给出用户痛点或可量化变化；解释为什么改变、它如何影响一条真实工作循环；只展开能帮助复现或理解取舍的实现；写平台/模型/迁移/失败边界；列今天可用的入口与文档。完整 changelog 放链接，不在正文逐项抄写。

### 实操指南

写清目标、读者、前置条件、版本和输入；每一步使用 Vetta 的真实入口并记录结果；至少包含一个失败恢复或“不适合这样做”的分支；结尾给验证清单和可撤销的下一步。没有亲自走通的步骤必须标 `unverified`。

### 竞品/选择指南

先定义混用的类别和共同任务；给出 3–6 个透明维度与权重/证据；每个产品写适合谁、强项、代价和不适用；披露 Vetta 立场；避免把不同交付物、不同权限或不同数据边界只用一个“综合分”抹平。

### 复盘/现实检验

按承诺 → 症状 → 环境与复现 → 根因（事实/推断分开）→ 临时办法 → 当前责任/issue → 防回归动作组织。不要把失败写成品牌姿态，也不要把 workaround 说成永久修复。

### 观点/趋势

先提出可争辩、可证据化的判断，再选近期材料；至少一个反例、一个 Vetta 场景和一个尚无结论的边界。趋势信息必须带日期，预测用“我判断/可能”而不是未来时态的断言。

## 语言与结构反模式

自动退回或重写：`我们很高兴/激动地宣布`、`无缝/赋能/解锁/行业领先/革命性/强大` 等空泛词；“不是 X，不是 Y，而是 Z”的连续三拍；“只需一句提示词”“就是这么简单”；只在开头和结尾有个人声音；`背景/架构/结果/结论` 这类没有信息的标题；没有证据的“显著/大幅/稳定/实时”；把竞品缺点写成必然结论；重复摘要三次。

中文优先短句、动词和具体名词；技术词只有在读者需要复现时出现。英文仍要 outcome-first，不从中文逐字硬译。破折号、夸张感叹和表格不可替代因果解释。

## 图片验收基准

- 文章 OG 头图默认 1200×630 以上，普通横图默认 1600×900；比例应适合目标页面且不依赖中心裁切。
- 一个视觉只承载一个隐喻和一个焦点；标题安全区至少保留约 35% 的干净面积，不把重要信息放在边缘。
- Vetta 色彩作为角色而非整块涂满：米白纸张、墨绿/近黑结构、珊瑚色强调；具体颜色以 `apps/docs-site/app/global.css` 当前 token 为准。
- 检查 320px 缩略图、暗/亮背景、压缩伪影、拼写、假 Logo、无意义电路/机器人装饰和与文章无关的“未来科技”场景。
- 若图片包含 UI，使用真实截图或明确标注为概念图；若包含文字，逐字检查，不能以模型“看起来对”代替人工/视觉审查。
