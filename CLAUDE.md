# 交付与提交约束（Delivery & Git Commit Discipline）

> **最高约束层级与继承关系（Mandatory）**：
> 0. 提交代码时不要携带`Co-Authored-By`和`Claude-Session`信息
> 1. **全局主控**：`AGENTS.md` 是全局 **Vibe Coding 的最高统领约束**，具有顶层效力，所有 Agent 必须无条件全量遵守。
> 2. **局部特化**：本 `CLAUDE.md` 是专门针对 **Claude Code** 场景的补充与强化约束。
> 3. **冲突裁决**：若本文件与 `AGENTS.md` 存在细节冲突，以 `AGENTS.md` 为准；两者均未冲突时，必须同时满足两者的全部要求。任何违背均判定为任务失败。

---

### 一、原子化提交与风险预防

**核心准则**：一次提交仅做一件事（Single Responsibility Principle）。
**自动提交**：在任务完成后，自动提交相关改动。

**禁止混合多业务提交的风险警告**：
- **精准回滚失效**：若业务 A 存在缺陷需要回退，与业务 B 混杂的提交将导致无关功能被迫陪葬。
- **定位追踪瘫痪**：彻底破坏 `git bisect` 等二分排错工具的效能，大幅增加线上追凶成本。
- **审查负担激增**：将业务逻辑、格式调整与代码重构混为一谈，会严重干扰 Code Review 视线，埋下隐蔽隐患。

**执行拆分边界**：
- **重构与新功能**：绝对拆开。先提交重构（确保行为与原有测试一致），再提交新功能。
- **Bug 修复与杂项（Chore/Typo）**：绝对拆开。即便只是改动 1 个错别字，也必须单独立项提交。
- **功能代码与测试用例**：可同属一个提交，但禁止“只提交功能实现、缺失配套测试”。
- **判断标尺**：若该改动在生产环境可能需要被单独撤销（Revert），它就必须是一个独立的 Commit。

---

### 二、提交前强制动作序列（Pre-commit Checklist）

在执行任何 `git commit` 命令前，必须按顺序执行以下审查，严禁凭推测提交：
1. **检查暂存区**：执行 `git status` 确认待提交变动范围。
2. **逐行校验 Diff**：执行 `git diff --staged`，逐一排查是否存在无关文件、临时调试代码或意料外的格式化。
3. **同步历史风格**：执行 `git log -5 --oneline`，观察仓库最近的提交前缀与消息风格，严格对齐。

---

### 三、Commit Message 编写规范

- **Header**：简短精炼，严格遵循仓库现有语义化前缀规范（如 `feat(auth): ...`）。
- **Body**：**重点阐述“为什么改（Why）”而非“改了什么（What）”**（具体变动已由 Diff 呈现）。
- **篇幅**：控制在 1-3 句内，讲清改动动机、上下文及影响面。
- **关联引用**：关联外部任务或 issue 时，统一遵循 `owner/repo#123` 格式。

---

### 四、操作绝对禁区（Zero-Tolerance Rules）

- **严禁 `git commit --amend`**：除非用户在当前对话中明确要求“amend”。修补上一提交必须追加独立的 fix/refactor commit。
- **严禁 `--no-verify`**：Pre-commit Hook 失败时必须从根本修复问题，严禁使用参数绕过。
- **严禁强制推送**：绝不允许对 `main` / `master` 或共享分支执行 `git push --force`。
- **严禁未经授权 Push**：在用户未明确下达 push 指令前，严禁执行 `git push`。本地 commit 零成本，推送带全局副作用。

---

### 五、发布说明补充（Release Notes，强制执行）

**核心准则**：代码改完不等于任务完成，发布说明写完才算。

**写入位置**：`.github/release-notes/v<版本号>.md`，一个版本一个文件。版本号以 `apps/desktop/package.json` 的 `version` 字段为准，文件不存在时直接新建。该文件会被 `desktop-release` 流水线直接用作 GitHub Release 正文，写法规范见 `.github/release-notes/README.md`。

**强制触发条件**：以下任意一项完成后，必须在同一次任务内把对应条目写入当前版本的发布说明，严禁留作后续工作：

- **新增**：任何新功能、新能力、新配置项。
- **修正**：任何缺陷修复。
- **改动**：任何对既有行为的调整，含性能、交互、文案层面用户可感知的变化。
- **解决 PR**：合并任何 Pull Request。
- **Close Issue**：关闭任何 issue。

**书写要求**：

- 按 `## 新增` / `## 改进` / `## 修复` / `## 其他` 归类，无内容的小节直接省略。
- 站在用户视角描述影响与代价，严禁复述 diff 或罗列函数名。
- 关联 PR 或 issue 时统一使用 `owner/repo#123` 格式（如 `openvetta/open-vetta#8`）。
- 无用户可感知影响的纯内部改动（内部重构、测试、开发文档）仍需在「其他」留一条一句话记录。
- 已发布版本的说明文件严禁修改；`apps/desktop/CHANGELOG.md` 自 0.5.58 起冻结，不再追加。

**违规后果警告**：

- **发版直接失败**：缺失对应版本文件时，`desktop-release` 的 quality 阶段即以 `node scripts/release/release-notes.mjs --check` 报错中止。
- **补救窗口关闭**：流水线由 tag 推送触发，tag 一旦推出即开始构建，此时再补写已无法进入本次发布。

---
### 六、Commit 报告规范（强制执行）

1. **触发条件**：
   - 仅当在**当前对话中实际执行了 `git commit` 并成功生成提交**时，才必须在最终回复的最底部输出提交记录。
   - 若本轮对话未执行提交（如仅提供排查建议、代码走查或尚未生成提交），**严禁**输出任何 Hash 或编造提交记录。

2. **输出格式**：
   - 无论产生单个还是多个提交，统一在回复的最底部使用 Markdown 无序列表列出。
   - 格式强制规范为：`- \`<short_hash>\`: <commit summary>`（短 Hash 统一固定为 7 位）。
   - 内容须严格提取自实际执行的 Git Commit 第一行标题，严禁自由发散与虚构。

**输出示例**：
- `a1b2c3d`: feat: add user authentication middleware
- `e4f5a6b`: test: add unit tests for token validation

---
### 七、移动端 i18n 与测试（强制执行）

移动端（`apps/mobile/client-apple`、`apps/mobile/client-android`）与桌面端同等对待，具体规则见 `AGENTS.md`「TypeScript 与 UI」「测试与验证」：

1. **i18n**：新增或修改任何用户可见文案，必须同时写英文与简体中文，跟随系统语言；严禁在视图里写死中文或英文字面量。iOS 在 `L10n` 加键、在 `Localizable.xcstrings` 加两种译文。
2. **测试**：移动端改动不因“只是 UI”而免测。iOS 至少跑 `swift test --no-parallel`；改动界面或流程时同步更新 `VettaUITests` 并运行 `scripts/ui-test.sh`，失败时如实报告，不得跳过。
