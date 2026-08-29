# Vetta Blog 研究与参考笔记

本文件是设计依据，不是要逐字复制到博客的模板。外部页面访问日期应在实际运行时重新记录；下面的链接用于复核来源和防止把一次观察误当成永久事实。

## OpenDesign 博客的可迁移技巧

抽样阅读了 OpenDesign 中文博客列表以及以下文章：

- [博客列表](https://open-design.ai/zh/blog/)
- [2026 年最佳 AI 设计 Agent](https://open-design.ai/zh/blog/ai-design-agents/)
- [用 Google Stitch 做 vibe design](https://open-design.ai/zh/blog/vibe-design-with-stitch/)
- [BYOK 现实检验：5 件会出问题的事](https://open-design.ai/zh/blog/byok-reality-check-5-things-that-break/)
- [OpenDesign 0.15.0](https://open-design.ai/zh/blog/open-design-0-15-0-cost-less-ship-faster/)
- [OpenDesign 0.19.1：DeepSeek Harness](https://open-design.ai/zh/blog/open-design-0-19-1-design-with-deepseek-harness/)
- [Claude PPT 技能指南](https://open-design.ai/zh/blog/claude-ppt-skills/)

反复出现且值得迁移的结构：

1. **先拆热词，再给选择框架。** “AI 设计 agent”被拆为创意素材、任务/工作流、设计到代码三类，先问最终拿到什么、能否上线，再谈价格和集成。Vetta 文章可用同样方式拆“AI Agent 桌面端”“本地优先”“自动化 Skill”等混杂标签。
2. **比较不是总榜。** 记分卡按输出、归属、适用时机等维度并列，随后写每类“没人写出的那一段”和“不需要它的情况”。这比堆 logo、星数和“最佳”更能支持决策。
3. **诚实披露立场。** Stitch 文章先承认作者做开放路线，再具体称赞 Stitch 的速度和质量，之后指出导出单向门、设计系统不成为事实源、Labs 可用性会变。Vetta 文章必须同样披露产品立场，并写竞品真实优点。
4. **把体验写成可复现的观察。** BYOK 文章按症状、原因、变通办法、谁在修组织，并给出 issue、版本、平台和边界。Vetta 的故障/指南应保留输入、环境、等待或错误，而不是“体验很好”。
5. **产品更新写影响链。** 0.15.0 没有逐条抄 changelog，而是把 token、首个响应、交付摩擦和失败恢复串成一条工作循环，再给不同读者“今天能做什么”。
6. **下一步具体且克制。** 结尾链接到下载、文档、源码或 issue；不以泛泛的“期待你的创造”收束。

需要主动避免的 OpenDesign 风险：内部产品宣传占比过高；用“截至撰写本文时”却没有检索日期；竞品数据（星数、价格、兼容性）容易过期；同一判断在开头、正文、结尾重复；版本文章可能把未验证的实现细节包装成稳定合同。`vetta-blog` 将这些变成证据日期、claim 状态和限制段落，而不是禁止所有产品观点。

## skills.sh 参考与取舍

通过 `skills find` 找到并阅读/抽取了以下候选：

- [getsentry/skills blog-writing-guide](https://skills.sh/getsentry/skills/blog-writing-guide)：问题/结论开场、读者问题结构、数字而非形容词、代码需运行、系统图、明确局限、真实署名和“会不会分享”测试；其禁止企业套话和典型 AI 句式尤其适合 Vetta。
- [composiohq content-research-writer](https://skills.sh/composiohq/awesome-claude-skills/content-research-writer)：把研究、提纲、草稿、逐节反馈放在同一循环；Vetta 采用其阶段性工作法，但增加项目事实和可复现体验合同。
- [jamditis fact-check-workflow](https://skills.sh/jamditis/claude-skills-journalism/fact-check-workflow)：断言提取、主来源优先、证据/矛盾/响应记录、发布前状态；Vetta 采用 claim ledger 和 untrusted-content 边界，不要求把意见强行评级为真/假。
- [aaron-he-zhu content-quality-auditor](https://skills.sh/aaron-he-zhu/aaron-marketing-skills/content-quality-auditor)：将发布准备度拆为证据覆盖、未知项、veto 和修复计划；Vetta 采用“未知不等于通过、硬失败优先”的精神，但使用本地轻量脚本，不引入其外部评分运行时。

`find-skill` 的结果是候选线索而非权威规范；安装前仍应审查来源、许可证、权限和实际 `SKILL.md`。本 Skill 不自动安装第三方 Skill。

## Vetta 的事实锚点

首选仓库内事实源：

- 产品范围与用户价值：`README.md`、`README.zh-CN.md`、`docs/user-facing-copy.md`
- Skill 发现/调用：`packages/coding-agent/docs/skills.md`、`packages/coding-agent/src/resources/skills/`
- Skill hook 合同：`packages/coding-agent/src/resources/skills/skill-document.ts`、`packages/coding-agent/test/runtime-core/skill-hook-invocation.test.ts`、`packages/ecosystem-adapter/src/claude-code/hooks/`
- 扩展与内容工作流：`packages/plugins/README.md`、`packages/plugins/presets/content-creation/agent/skills/`
- 质量门禁：`docs/dev/quality-gates.md`
- 视觉品牌：`apps/docs-site/app/global.css`、`apps/docs-site/lib/seo/social-image.tsx`、`docs/assets/`

事实写作时记录 commit/版本、读取日期和路径。`README` 适合稳定定位；源码/测试适合实现合同；CHANGELOG 适合某次发布；issue/日志只能支持带日期的观察。

## 文章值不值得发布：独立基准

发布候选必须同时满足：

- 能说清一个 Vetta 用户的决定或动作，且不是把仓库目录翻译成散文；
- 至少三个不同的第一方事实锚点，至少一条真实操作/故障/测量记录；
- 中心结论和关键数字可从 claim ledger 追到来源，未知项显式保留；
- 诚实写出不适用场景、成本、锁定、失败或仍未完成的部分；
- 读者可在文章结尾执行下一步，且链接/命令/路径经过核对；
- 图片作为实际 artifact 被查看过，视觉审查记录与正文主题一致。

“像 OpenDesign”只意味着清楚的框架、具体的取舍和愿意承认边界，不意味着复制其标题、句式、结论或比较对象。
