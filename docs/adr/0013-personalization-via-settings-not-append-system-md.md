---
status: accepted
---

# 个性化走 settings.json 结构字段 + 独立懒重建，不复用 APPEND_SYSTEM.md

[[个性化]]（设置页「Agent配置」最上方的 [[人设]] 选择 + [[自定义指令]] textarea）本质是「往系统提示词末尾追加文本」。coding-agent 已存在一条同语义的机制：`~/.astravia/agent/APPEND_SYSTEM.md`（及项目级 `.astravia/APPEND_SYSTEM.md`），由 `resource-loader` 发现后注入 `buildSystemPrompt({ appendSystemPrompt })`。直觉上个性化可以直接把「人设+自定义指令」拼成文本写进该文件，零新增注入管线。

但两点否决了复用：① `APPEND_SYSTEM.md` 只在 session 初始化和显式 `reload()` 时读盘，**没有 per-prompt 懒重载**（prompt 入口只懒重载了 skills/MCP/image budget）；个性化要求「应用后下一轮 prompt 即生效」，复用也得新增懒重载逻辑，省不掉。② 文件是无结构纯文本，UI 无法可靠反推「当前选中哪个人设」，且会与用户手改该文件相互覆盖。

## 决定

个性化独立成一套，不碰 `APPEND_SYSTEM.md`：

- **存储**：写 `~/.astravia/agent/settings.json` 的 `personalization` 块 `{ personaId, customPrompt }`，与 `image budget` 的 `maxRecentImages` 同文件不同字段。人设正文不进 settings——settings 只存 `personaId`。
- **人设来源**：coding-agent `src/core/personas/*.md` 为唯一编辑来源（一人设一个 md，frontmatter 存 `id/label/description`、正文存提示词）。构建期 `scripts/generate-personas.mjs` 内联成 `personas-data.ts`，`personas.ts` 合成注册表——**运行时零文件系统依赖**（coding-agent 被 desktop 打进 bundle，`__dirname` 读盘会失效，曾先用读盘导致 desktop 只显示「默认」）。desktop 经 IPC 拉清单渲染选择器，改预设对存量用户自动生效。`default`（no-op、无正文）不落 md、在代码里合成并置顶。
- **注入**：在 `buildSystemPrompt` 拼到系统提示词末尾，顺序 `APPEND_SYSTEM.md → 人设 → 自定义指令`（recency 最高）。`personaId="default"` 且 `customPrompt` 为空时一字不加，行为与未开启完全一致。
- **生效**：[[个性化懒重建]]。desktop 写盘后**不** fan-out 重建；coding-agent 在 `prompt()` 入口对 `personalization` 块做签名比对（缓存上次签名，相等走 fast-path、无副作用），变化才重建系统提示词。语义复刻 MCP 懒重建。

## 关键取舍

**用结构字段换掉「复用现成文件」的省事。** 复用 `APPEND_SYSTEM.md` 看似零新增管线，但它给不了懒重载（仍要补）、给不了结构（UI 反推选中人设困难）、且与用户手改文件抢同一份内容。改用 settings.json 结构字段后：懒重载复用 `image budget` 已验证的「prompt 入口读 settings + 签名比对」同构路径；UI 能精确回显；人设/自定义指令/手改文件三条来源各自独立、互不覆盖。代价是 coding-agent 多一个 `personalization` 读取点与一段注入逻辑，以及一条新 IPC 通道（下发人设注册表）。

**人设正文放后端而非前端。** 可选方案是 desktop 前端常量存人设，选中时把解析后的正文一并写进 settings，后端零注册表。否决：会把预设措辞**冻结**在用户 settings 里，改预设不触达存量用户，且前后端各存一份 id 易漂移。后端注册表 + IPC 下发是唯一来源，多一次 IPC roundtrip 的成本可接受。

**刻意与 MCP 懒重建对齐而非另起范式。** 个性化、MCP、image budget 现在共享同一个心智模型：写盘不 fan-out，每个 session 在下一个 prompt 入口按需 diff-reload，fast-path 近零成本。新读者理解一处即理解三处。

## 后续若改变主意

- 若个性化需要项目级覆盖（当前仅全局），按 MCP/SYSTEM.md 的双层模型加 `.astravia/` 项目级 settings 覆盖，注入顺序与签名比对相应扩展，不影响本 ADR 的全局层；
- 若人设数量增长到需要用户自定义人设（而非仅选预设），注册表可扩展为「内置 + 用户自定义」两源，settings 仍只存 `personaId`，注入路径不变。
