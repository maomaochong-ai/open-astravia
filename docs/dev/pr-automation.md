# 贡献者 PR 的自动审查与合并

本页说明仓库里三个只服务贡献者 PR 的 workflow：它们把「PR 是否符合仓库约定」「是否可以自动合并」「dev 验证通过后如何进入 main」串成一条链路。日常质量门禁本身见 [质量门禁](./quality-gates.md)。

## 分工

| Workflow | 触发 | 作用 | 权限 |
|----------|------|------|------|
| [`pr-quality.yml`](../../.github/workflows/pr-quality.yml) | `pull_request_target`（opened / edited / reopened / synchronize / ready_for_review / converted_to_draft） | 只读检查 PR 约定，作为必需检查 `PR conventions` | `contents: read`、`pull-requests: read` |
| [`pr-automation.yml`](../../.github/workflows/pr-automation.yml) | `pull_request_target`（含 labeled / unlabeled）+ 「quality / desktop-packaged / im-gateway / kotlin / mobile-apple / docs-site」完成后 | `PR triage` 写标签与置顶评论；`Auto-merge` 在门禁全绿后合并 | triage：`contents: read`、`pull-requests: write`、`issues: write`；merge：`contents: write`、`pull-requests: write`、`checks: read`、`actions: write` |
| [`promote-dev-to-main.yml`](../../.github/workflows/promote-dev-to-main.yml) | 上述六个 workflow 在 `dev` 上完成后、每日 `schedule`、手动 `workflow_dispatch` | 把已验证的 `dev` 推进到 `main` | `contents: write`、`pull-requests: write`、`checks: read` |

三方职责互不重叠：**检查**只报告，**自动化**只写标签/评论并合并，**推进**只动分支。三者都不检出 PR 代码——`pr-quality` 与 `pr-automation` 在 `pull_request_target` 下检出的始终是 PR **base SHA**，PR 代码只通过 `GET /pulls/{n}/files` 读取文件清单，避免执行贡献者提供的脚本。

## 合并目标分支

- 贡献者 PR 的默认目标是 `dev`（集成分支）。`main` 是更慢的发布快照，只接受发布与热修。
- PR 打向 `dev` 或 `main` 都算合法；打向 `main` 且 `dev` 存在时，评论里会给出「本仓库在 `dev` 集成」的提示，但**不是**阻断项。
- `dev` 已建立在 `main` 当时的快照上（两者同起点）。若 `dev` 因故不存在：约定检查不会因此扣分，推进 workflow 直接空转，合并目标仍是 PR 自己的 base 分支。

## 分支保护

`dev` 与 `main` 都启用分支保护，必需检查就是脚本里的门禁名单：

| 设置 | 取值 | 说明 |
|------|------|------|
| 必需检查 | `PR conventions`、`check + quality tests`、`affected unit tests (ubuntu-latest)`、`affected unit tests (windows-latest)`、`Desktop packaging contract`、`Detect packaged smoke scope` | 前五项是既有的分支门禁，由 [`ci-gate.mjs`](../../scripts/quality/ci-gate.mjs) 的 `BRANCH_GATE_CHECKS` / `PULL_REQUEST_GATE_CHECKS` 定义 |
| 按路径触发的 `Windows/macOS/Linux packaged E2E` | **不**设为必需 | 无关变更时它们根本不运行，设为必需会让这类 PR 永远卡在「等待检查」；改由脚本判定「运行了就必须通过」 |
| 要求分支最新（strict） | 否 | 是否最新交给脚本按 `head.sha` 与测试合并提交判定，strict 只会带来反复 rebase |
| 要求 PR 审批 | 否 | 门禁是机械检查，受信任作者的 PR 要能自动合并；要人工拦截用 `do-not-merge` |
| 允许强推 / 删除分支 | 否 | `main` 只接受快进或合并提交，与 [`promote-dev-to-main.mjs`](../../scripts/quality/promote-dev-to-main.mjs) 的 `force: false` 一致 |
| 允许管理员绕过 | 是 | 发布与热修仍可直接落到 `main` |

改动门禁名单时要同步两处：脚本里的常量，以及 `dev`、`main` 的分支保护设置。只改脚本会让分支持续出现「同名检查未上报」的等待状态。
必需检查 `PR conventions` 只有在 `pr-quality.yml` 已存在于 base 分支（`dev` / `main`）时才会上报——`pull_request_target` 用的是 base 分支上的 workflow 定义。三个 workflow 文件尚未合入前，打向 `dev` / `main` 的 PR 会停在 `Expected — Waiting for status to be reported`，这种情形只有管理员能绕过（保护规则保留了管理员绕过）。

查看与撤销（需要仓库管理员权限，`gh` 需要 `repo` scope）：

```bash
gh api repos/maomaochong-ai/open-astravia/branches/dev/protection
gh api repos/maomaochong-ai/open-astravia/branches/main/protection
gh api -X DELETE repos/maomaochong-ai/open-astravia/branches/main/protection
```

## PR 约定检查（`PR conventions`）

`node scripts/quality/pr-quality.mjs --check` 读取 PR 元数据、文件清单和仓库里的 `.github/pull_request_template.md`，输出阻断项（violation）与提醒（warning）：

| 项 | 类型 | 判定 |
|----|------|------|
| base 分支 | 阻断 | 只接受 `dev` / `main` |
| 目标 `main` 提示 | 提醒 | 仅当 `dev` 存在时提示 |
| 模板章节 | 阻断 | `## Why`、`## Validation` 必须存在且有内容 |
| `What users will see` | 阻断 | 有内容，或在 `Surface area` 勾选「无用户可见变化」 |
| linked issue | 提醒 | 建议出现 `Fixes #N` |
| 体积 | 提醒 | 超过 40 个文件或 1200 行变更时打 `quality:large`，**不阻断** |
| 发布说明 | 提醒 | 产品代码变更未触碰 `.github/release-notes/v<当前版本>.md` 时提示 |
| 截图 | 提醒 | 勾选 UI 但 `## Screenshots` 为空时提示 |

受信任的机器人（`dependabot[bot]`、`github-actions[bot]`、`renovate[bot]`）与人工提交分开判定，只保留 base 分支、体积与发布说明三项，不要求它们填写人工模板。

结果通过同一个置顶评论（marker `<!-- astravia-pr-conventions -->`）反馈，内容不变时不会重复刷屏。CI 里的 `--check` 使用只读令牌，因此 fork PR 也能运行；写入标签与评论的 `--sync` 只出现在 `pr-automation.yml`。

## 角色与标签

| 标签 | 含义 |
|------|------|
| `automerge` | 人工/自动声明的合并意向；由受信任作者满足条件时自动添加，其他 PR 需维护者手动添加 |
| `do-not-merge` | 粘性停止开关，优先级最高 |
| `quality:blocked` | 约定检查未通过，由 `--sync` 添加，通过后自动移除 |
| `quality:large` | 体积偏大，仅提示；体积回落后自动移除 |

标签由脚本按需创建（`ensureLabels`），仓库初始化时不需要手工建标签。

`automerge` 由脚本添加后**永远不会被脚本移除**（`--sync` 只增不减），所以想叫停已经拿到该标签的 PR，正确做法是加上 `do-not-merge`。移除 `automerge` 标签不会有持久效果：下一次 `--sync` 会把受信任作者的 `automerge` 重新加回来。

作者角色按 GitHub 的 `author_association` 判定：`OWNER`、`MEMBER`、`COLLABORATOR` 与 `TRUSTED_BOT_LOGINS` 视为受信任。外部贡献者的 PR 只有在维护者显式加上 `automerge` 后才会进入自动合并。

## 自动合并（`Auto-merge`）

`node scripts/quality/pr-auto-merge.mjs` 只处理「带 `automerge`、不带 `do-not-merge`、未关闭」的 PR，并要求：

- 目标分支属于 `dev` / `main`，PR 不是 draft、无冲突、`mergeable` 不是 `null`（GitHub 仍在计算时会等待下一次触发）；
- 必需检查全部通过：`PR conventions`（本 PR 自己的约定检查）与分支门禁 `check + quality tests`、`affected unit tests (ubuntu-latest)`、`affected unit tests (windows-latest)`、`Desktop packaging contract`、`Detect packaged smoke scope`；
- 按路径触发的 `Windows/macOS/Linux packaged E2E` 要么通过，要么**根本没运行**；一旦运行且失败就阻断。

判定的关键点：

- 只统计 `github-actions` 这个 App 的 check run，CodeRabbit 等第三方审查的失败不会挡住合并，也不承担门禁职责；CodeRabbit 仍是配置里的第一轮 AI 审查，见 [`.coderabbit.yaml`](../../.coderabbit.yaml)。
- 检查结果同时从 `head.sha` 与测试合并提交（`merge_commit_sha`）读取，避免只看看其中一个而误判「检查缺失」。
- 检查名按「同名取最后一次运行」归并；仓库里旧分支遗留的同名失败不会干扰。
- 合并使用 `squash`，并锁定 `head.sha`，force-push 后不会把未验证的新提交合进去。
- 合并后删除同仓库的 head 分支（跨仓库 fork 不删），然后主动触发一次 `promote-dev-to-main.yml`。

评论策略（marker `<!-- astravia-pr-automation -->`）：合并成功、门禁明确阻断、以及 GitHub 拒绝合并（405/409/422，例如分支保护要求额外审批）三种情况都会更新置顶评论并说明原因；仅仅是「还在等检查」时不评论。

## `dev` → `main` 推进（`Promote dev to main`）

`node scripts/quality/promote-dev-to-main.mjs` 先取 `dev` 的最新提交，再用 `GET /compare/main...<sha>` 判定：

| compare 结果 | 动作 |
|--------------|------|
| `ahead` 且门禁全绿 | 直接 `PATCH /git/refs/heads/main` 快进（`force: false`） |
| `ahead` 但门禁未通过/未跑完 | 等待，下一次触发再试 |
| `ahead` 但该提交没有任何检查记录 | 开（或复用）`dev` → `main` 的 PR 交人工确认 |
| `diverged` | 开（或复用）`dev` → `main` 的 PR，正文要求用 **Create a merge commit** |
| `behind` / `identical` / 没有 `dev` | 什么都不做 |

快进被拒绝（409/422）时同样回退为 PR。PR 标题固定为 `chore(branch): 将 dev 推进到 main（N 个提交）`，正文列出待推进提交（最多 20 条），并用 marker `<!-- astravia-dev-promotion -->` 保证只有一个置顶评论/PR，不会每次触发都新开一个。

推进是**单向前进**：能用快进就用快进，需要合并的历史分歧交给人决定，脚本不会强推 `main`。

## GITHUB_TOKEN 的已知限制与一次性设置

用仓库自带的 `GITHUB_TOKEN` 合并 PR 时，GitHub 不会为这次合并触发新的 workflow 运行，于是「合并后自动推进」不能只依赖 `workflow_run`。脚本和 workflow 有三层兜底：

1. 合并成功后主动 `POST /actions/workflows/promote-dev-to-main.yml/dispatches`；
2. 每日 `schedule`（`23 3 * * *`）兜底；
3. 手动 `workflow_dispatch`（`dry_run` 输入可只评估不落盘）。

如果希望 `workflow_run` 链路完整可用（包括让 `main` 上的后续 workflow 按推送触发），在仓库里配置一个有 `repo` 与 `workflow` 权限的 PAT：

- Secret `ASTRAVIA_AUTOMATION_TOKEN`：存在时优先于 `GITHUB_TOKEN` 使用（两个 workflow 的 `env` 都是 `secrets.ASTRAVIA_AUTOMATION_TOKEN || secrets.GITHUB_TOKEN`）。

可选的开关：

- Repository variable `ASTRAVIA_AUTOMATION_ENABLED=true`（默认视为开启）：仅在字面值为 `false` 时停用 `pr-automation.yml` 与 `promote-dev-to-main.yml` 的全部 job。`pr-quality.yml` 是只读检查，不受该开关影响，避免有人借关开关绕过必需检查。

## 排障

- **PR 一直不合并**：看置顶评论里的原因；`waiting for required checks` 表示还有必需检查没报告，`failing required checks` 会点名具体检查与结论。
- **PR 卡在 `Expected — Waiting for status to be reported`**：某个必需检查从未上报过。检查对应 workflow 是否被停用（例如 `pr-quality.yml` 被禁用），或分支保护里写了脚本不认识的检查名。
- **fork PR 拿不到 `automerge`**：符合预期，需要维护者手动加标签。
- **`dev` 推进 PR 长期存在**：说明 `main` 有 `dev` 之外的提交（热修）。按 PR 正文提示用 merge commit 合并，或把热修回合到 `dev`。
- **本地试跑**：`node scripts/quality/pr-quality.mjs --check|--sync`、`node scripts/quality/pr-auto-merge.mjs --dry-run`、`node scripts/quality/promote-dev-to-main.mjs --dry-run`。脚本只依赖 Node 内置模块与 `GITHUB_TOKEN`/`ASTRAVIA_AUTOMATION_TOKEN`，不需要 Bun，也不需要 `gh` CLI。

## 相关文件

- 三个脚本：[`pr-quality.mjs`](../../scripts/quality/pr-quality.mjs)（约定检查）、[`pr-auto-merge.mjs`](../../scripts/quality/pr-auto-merge.mjs)（合并）、[`promote-dev-to-main.mjs`](../../scripts/quality/promote-dev-to-main.mjs)（推进）
- 共享件：[`ci-gate.mjs`](../../scripts/quality/ci-gate.mjs)（检查名单与判定）、[`github-rest.mjs`](../../scripts/quality/github-rest.mjs)（REST 客户端、幂等评论、标签同步）
- 合同测试：[`pr-quality.test.mjs`](../../scripts/quality/pr-quality.test.mjs)、[`pr-auto-merge.test.mjs`](../../scripts/quality/pr-auto-merge.test.mjs)、[`promote-dev-to-main.test.mjs`](../../scripts/quality/promote-dev-to-main.test.mjs)。改动这三个 workflow 会通过 `test:impact` 自动选中对应测试。
