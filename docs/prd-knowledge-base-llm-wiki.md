# PRD: LLM Wiki 知识库

> 状态：ready-for-agent
> 范围：数据契约 + 摄入(raws→wiki) + 检索 + 后台加工会话 + desktop 设置
> 关联分支：`feat/knowledge-base`

## Problem Statement

用户在本地积累了大量原始资料（文档、PDF、图片、网页等），散落在文件系统里，无法被 agent 有效消费：

- 原始文件格式杂乱、体积大，直接喂给 LLM 既贵又噪声大；
- 没有结构化的、可检索的中间层，agent 每次都要从零读原文；
- 没有"知识地图"，agent 不知道库里有什么、该读哪一页；
- 缺少按主题/标签快速圈定相关内容的能力；
- 资料会增删改，但没有机制让加工结果增量跟随，且加工过程是黑盒，用户看不到 agent 到底做了什么。

## Solution

在 `~/.vetta/knowledges/` 下建立一套约定式的 LLM 知识库：

- 用户把原始文件平铺进 `raws/<source_name>/`（`<source_name>` 是 UI 层的来源分类）；
- 工程侧惰性轮询（默认 5 分钟，可配）检测 raws 变化，攒批后交给一个**后台 agent 会话**把原始文件加工成带 frontmatter 的 wiki markdown 页（1:1）；
- agent 按语义把 wiki 页组织成树形，维护 `indexes/` 语义导航层，并给页面打扁平标签；
- 检索是多模态的：标签捷径(`filter_by_tags`)、走 indexes 导航、渐进式探索(遍历树/读页/顺 `[[id]]` 链接)、全文搜索；
- 每一轮加工 = 一次可在 UI 回看的 agent 会话，过程透明不暗盒；
- 所有策略（轮询间隔、加工模型、手动触发）在 desktop-app「知识库设置」页可配。

对用户而言：把文件丢进 raws，过一会儿就能得到一个结构化、可被 agent 精准检索、可视化可回看的知识库；文件增删改后知识库自动跟随。

## User Stories

1. 作为用户，我想把任意格式的原始文件平铺放进 `raws/<source_name>/`，以便不用预先整理结构就能纳入知识库。
2. 作为用户，我想用 `<source_name>` 子目录给原始文件分类，以便在 UI 上按来源归类查看。
3. 作为用户，我想让系统自动把原始文件加工成结构化 wiki 页，以便不必手动整理。
4. 作为用户，我想要每个原始文件对应恰好一个 wiki 页(1:1)，以便溯源清晰、心智简单。
5. 作为用户，我想让 LLM 按语义自由组织 wiki 的树形目录，以便知识按主题而非按原始来源排布。
6. 作为用户，我想要每个 wiki 页顶部有固定字段的 frontmatter 元信息，以便机器可读、可检索。
7. 作为用户，我想要 wiki 页有一个与文件路径解耦的稳定 id，以便移动/重命名/重组目录都不断链。
8. 作为 agent，我想通过 `[[id]]` 在正文里交叉引用其他 wiki 页，以便渐进式探索时能顺链接跳转。
9. 作为用户，我想给 wiki 页打扁平字符串标签，以便后续按标签圈定内容。
10. 作为 agent，我想用 `filter_by_tags({all, any, none})` 做标签交/并/补过滤，以便快速命中相关页面。
11. 作为 agent，我想知道 `filter_by_tags` 只是捷径而非必经路，以便也能通过 indexes 或渐进式探索检索。
12. 作为 agent，我想读 `indexes/` 的语义导航地图（含摘要 + 指向 page id），以便先看地图再下钻、节省 token。
13. 作为 agent，我想遍历 wiki 树、按路径或 id 读页、全文 grep，以便在没有合适标签时也能检索。
14. 作为用户，我想让工程侧每隔 N 分钟检测 raws 变化而非实时，以便攒批加工、避免不必要的资源开销。
15. 作为用户，我想在「知识库设置」里把轮询间隔设为 3/5/10/30 分钟之一，以便按需平衡及时性与开销。
16. 作为用户，我想新增一个原始文件后，下一轮加工自动为它生成 wiki 页，以便无需手动触发。
17. 作为用户，我想移动一个原始文件（内容不变）时不触发重新加工，以便不浪费 token。
18. 作为系统，我想用内容 hash 作为原始文件的主身份，以便把"移动"和"内容变更"区分开。
19. 作为系统，我想在原始文件移动时只更新 wiki 页 frontmatter 的来源路径字段，以便纯元数据更新、不惊动 agent。
20. 作为用户，我想编辑一个原始文件（内容变更）后，对应 wiki 页就地更新而非新建，以便保住稳定 id 和创建时间。
21. 作为系统，我想在内容变更时由轮询器解析出旧页 id 一并交给 agent，以便写入工具按 id 就地覆盖。
22. 作为用户，我想删除原始文件后，对应 wiki 页先被标记为孤儿并记录孤儿时间，以便有抢救窗口而非立即丢失。
23. 作为系统，我想用 n+1 模式回收孤儿：第 N 轮标记、第 N+1 轮删除上一轮孤儿，以便给一轮宽限期防误判。
24. 作为 agent，我想在删除上一轮孤儿前先复判，把孤儿页的有价值内容或被引用关系合并迁移到别的页，以便不丢沉淀。
25. 作为用户，我想要孤儿不被手动删除、不按 TTL 删除，而是统一走 n+1 工程化回收，以便机制单一可预期。
26. 作为系统，我想以各 wiki 页的 frontmatter 为唯一真相源，以便缓存丢了也能重建、永不漂移。
27. 作为系统，我想把 `tags.json`(tag→id) 和 `manifest.json`(每页 {id, path, source_path, source_hash, orphaned_at}) 作为可重建缓存，以便加速检索与轮询 diff。
28. 作为用户，我想要一个"重建索引"操作，以便缓存损坏或外部手改后能从 frontmatter 重建。
29. 作为 agent，我想通过唯一的 `kb_write_page` 工具写 wiki 页，以便固定字段、自动分配 id、顺手刷新缓存，而不必手拼 YAML。
30. 作为系统，我想让 frontmatter 是封闭 schema（只允许约定的 10 个字段），以便缓存/检索/迁移都能依赖固定形状。
31. 作为系统，我想让 `kb_write_page` upsert：传入 id 就地更新（保留 id+created_at、刷新 source_hash+正文+updated_at），无 id 则按 source_hash 新建并分配 id。
32. 作为用户，我想让每一轮加工是一次 agent 会话，以便能在 UI 里回看 agent 当时做了什么，过程不暗盒。
33. 作为用户，我想让加工会话自包含在 `~/.vetta/knowledges/processing_records/` 下（仿 conversation 项目的 `.vetta/sessions` 布局），以便知识库整体可搬迁。
34. 作为用户，我想让加工会话照常出现在 sidebar 会话列表，以便像普通对话一样浏览。
35. 作为用户，我想要一轮加工(整批 diff + 上轮孤儿复判)装进一个会话，以便会话数少、上下文共享、成本低。
36. 作为用户，我想在「知识库设置」里选择加工使用的模型，以便后台加工用便宜/长上下文模型，与主对话模型区分。
37. 作为用户，我想要「立即扫描+加工」按钮，以便不等轮询周期就触发一次加工。
38. 作为用户，我想要「重建索引」按钮，以便手动从 frontmatter 重建 tags.json/manifest.json。
39. 作为用户，我想让「知识库设置」的配置落在 `~/.vetta/settings.json`，以便与现有 desktop 配置统一管理。
40. 作为开发者，我想把所有加工约定（frontmatter 规则、树组织、indexes 维护、孤儿抢救）写进一个 `kb-processing` skill，以便加工会话加载后行为一致。

## Implementation Decisions

### 目录布局与真相源
- 知识库根：`~/.vetta/knowledges/`。对 agent 是**单一全局库**；`raws/<source_name>/` 的 `<source_name>` 仅是 UI 层的来源分类，不是独立知识库。
- 布局：
  - `raws/<source_name>/*.*`：原始文件平铺。
  - `wiki/**/*.md`：加工产物，树形由 LLM 按语义自由组织。
  - `indexes/**/*.md`：LLM 维护的语义导航层（摘要 + 指向 page id）。
  - `tags.json`：缓存 `tag → [id]`。
  - `manifest.json`：缓存 每页 `{id, path, source_path, source_hash, orphaned_at}`。
  - `processing_records/.vetta/sessions/`：每轮加工的 agent 会话 jsonl。
- **唯一真相源**：各 wiki md 的 frontmatter。`tags.json` / `manifest.json` 是可随时从 frontmatter 重建的缓存。

### wiki frontmatter（封闭 schema，仅 10 字段）
- `id`：稳定、与路径解耦、不可变（创建时分配，如 uuid/短 hash）。
- `source`：来源分组名（对应 raws 的 `<source_name>`）。
- `source_path`：原始文件相对路径。
- `source_hash`：原始文件内容 hash，原始文件的主身份。
- `tags`：扁平字符串数组。
- `title`：页标题。
- `summary`：一句话摘要，供 indexes 导读引用。
- `created_at` / `updated_at`：时间戳，由工具维护。
- `orphaned_at`：孤儿标记，正常为 null。
- 跨页引用不入 frontmatter，写在正文 markdown 里（`[[id]]`）。
- raw ↔ wiki = **1:1**。

### 摄入：惰性轮询 + 后台 agent 会话
- 工程侧调度器（仿 `apps/desktop-app/src/main/scheduler/` 的 `ToadScheduler` 用法）每 N 分钟对 raws 算 hash diff，攒批。
- diff 非空则用无头会话 API（`createAgentSession({ cwd, model, skill })` + `session.sendPrompt()`，见 coding-agent SDK）起一个加工会话，cwd = `KB_PROCESSING_CWD`，prompt = 本轮 diff 批次 + 上轮孤儿复判清单。一轮一会话。
- diff 四态及后果：
  - **added**（新 path、新 hash、无 path 匹配）→ agent 新建页，`kb_write_page` 分配 id。
  - **moved**（同 hash、换 path）→ 工程侧纯元数据更新 wiki frontmatter 的 `source`/`source_path`，不惊动 agent。
  - **changed**（同 path、换 hash）→ 轮询器解析旧页 id 一并交付 → agent 调 `kb_write_page` 按 id 就地更新（保 id+created_at、刷 source_hash+正文+updated_at）。
  - **deleted**（path 与 hash 都消失）→ 工程侧给对应 wiki 页设 `orphaned_at`。
- **孤儿 n+1 回收**：第 N 轮标记 `orphaned_at`；第 N+1 轮加工时把上轮孤儿一并交 agent 复判（可合并内容/重指 `[[id]]`），处理完工程侧再物理删除仍为孤儿的页。孤儿不手动删、不按 TTL 删。

### 工具面（理念：尽量少）
- **`kb_write_page`**：唯一写 wiki 页入口。守封闭 frontmatter schema；upsert（有 id 就地更新，无 id 走 source_hash 新建）；分配 id；写规范 frontmatter；顺手刷新 `tags.json` / `manifest.json`。
- **`filter_by_tags({ all, any, none })`**：高频检索捷径。`all`=交（同时含）、`any`=并（含其一）、`none`=补（不含），三者同时生效取交集；`none` 相对全库。非必经检索路径。
- 其余复用现有工具：`dir_tree`/`glob`（列）、`read` + `extract_text_from_pdf`/`extract_text_from_img`/`doc_to_pdf`/`render_pdf_page`（读原文/OCR）、`grep`（全文搜 / 按 id 反查）、`write`/`edit`（写/维护 indexes）、`current_time`（时间戳）。
- 加工约定（frontmatter 规则、wiki 树组织、indexes 维护、孤儿抢救）全部写进 `kb-processing` skill，由加工会话加载，而非新增工具。

### 检索（多模态、无必经路）
- `filter_by_tags` 标签捷径；走 `indexes/` 导航；渐进式探索（遍历 wiki 树 + 读页 + 顺 `[[id]]`）；`grep` 全文搜索。

### 会话集成
- 新增常量 `KB_PROCESSING_CWD = ~/.vetta/knowledges/processing_records` 与 `KB_PROCESSING_SESSION_DIR = <cwd>/.vetta/sessions`。
- 在 `resolveSessionDirForCwd()`（desktop-app `main/ipc/session.ts`，现已处理 `DEFAULT_CONVERSATION_CWD`）注册该 cwd→sessionDir 映射，使加工会话自包含且在 sidebar 透明可发现。

### desktop-app「知识库设置」
- 注册进 settings `registry.ts` 的 `SETTINGS_SECTIONS` → 新建 `KnowledgeBaseSettings.tsx` → 接入 `SETTINGS_CONTENT`。
- 配置走 `vetta:config:get/set`（preload `system.ts`）落 `~/.vetta/settings.json`，扩展 `DesktopConfigData`。
- 设置项：轮询间隔下拉（3/5/10/30 min）、加工模型选择、手动按钮（立即扫描+加工 / 重建索引）。

### 深模块拆分
- `raws-differ`（纯函数，核心）：输入上一轮 manifest 快照 + 当前 raws 扫描结果，输出分类 diff（added/moved/changed/deleted，并为 moved/changed/deleted 解析出 page_id）。判定顺序：先按 hash 配对识别 moved，再按 path 配对识别 changed，剩余 new 为 added，剩余 old 为 deleted。孤儿 n+1 标记/回收判定并入此模块。
- `tag-filter`（纯函数）：`filter_by_tags` 的 all/any/none 集合运算。
- `frontmatter-schema` + upsert 解析器：封闭 schema 校验、id 分配、upsert 键判定、created_at 保留。
- `cache-rebuilder`：扫描 wiki frontmatter 重建 `tags.json` + `manifest.json`。
- 薄编排/IO 层（集成而非单测）：poller 调度服务、会话集成 glue、desktop 设置 UI + config、`kb-processing` skill 文档。

## Testing Decisions

好的测试只验证模块的**外部行为**（给定输入→期望输出），不耦合内部实现细节，以便重构不破测试。

需要单测的模块：

- **`raws-differ`**：系统中最易错、后果最重的纯逻辑，必须覆盖。用例至少包括——纯新增；纯删除→标孤儿；同 hash 换路径→moved（解析正确 page_id、不重加工）；同路径换 hash→changed（解析旧 page_id）；既改名又改内容→当作 added + deleted；上轮孤儿在本轮被回收 vs 本轮新孤儿被标记的 n+1 区分；移动文件回归（误删恢复）在宽限窗口内不丢页。
- **`tag-filter`**：all/any/none 的交/并/补语义；边界——空集、单条件、三者组合、`none` 相对全库、标签不存在、重叠标签。
- **`frontmatter-schema` + upsert**：封闭 schema 拒绝未知字段；缺必填字段报错；传 id→就地更新且保留 id+created_at、刷新 updated_at；无 id 且 source_hash 已存在→命中更新；无 id 且 source_hash 不存在→新建并分配 id。
- **`cache-rebuilder`**：从一组 wiki frontmatter 正确重建 `tags.json`（tag→id 聚合）与 `manifest.json`；含孤儿页、含重复 tag、空库等边界；重建结果与增量维护结果一致（幂等）。

测试 prior art：`packages/coding-agent/test/*.test.ts`（vitest），尤其 `frontmatter.test.ts`（frontmatter 解析）与 `agent-session-*.test.ts`（会话行为）。测试从包根运行：`bunx tsx ../../node_modules/vitest/dist/cli.js --run test/<name>.test.ts`。

## Out of Scope

- 实时文件监听（chokidar/fs.watch 即时触发）：明确采用 N 分钟惰性轮询攒批，不做实时。
- 向量/embedding 语义检索：本期检索为标签 + indexes + 渐进式探索 + grep 全文，不引入向量库。
- 多知识库（对 agent 暴露多个独立库）：对 agent 是单一全局库，多库不在本期。
- 命名空间/层级标签：本期标签为扁平字符串。
- frontmatter 扩展字段 / 开放 schema：本期为封闭 10 字段。
- 孤儿的 TTL 删除或手动删除按钮：统一走 n+1 工程化回收。
- 加工会话的并发/排队精细控制、失败重试策略：本期按现有后台会话能力承载，复杂调度策略另议。
- raws 之外的远程数据源接入（网盘、URL 抓取等）。

## Further Notes

- 设计核心张力已对齐：`source_hash` 既是变更探测器又是新建 upsert 键，但**不能**用作内容变更时的 upsert 键（内容变 hash 必变）；跨内容编辑稳定的锚点是 raw 路径，由轮询器在 changed 态解析出旧页 id 交给写入工具，以此保住稳定 id。
- 孤儿删除时正文里别处对其 `[[id]]` 的引用会变死链，由 n+1 的 agent 复判步骤负责重指或清理。
- 会话存储照搬 conversation 特殊项目的既有机制（`DEFAULT_CONVERSATION_CWD` = `~/.vetta/conversation`，sessions 落 `<cwd>/.vetta/sessions`），降低新机制风险。
- 加工模型设置直接映射到 `createAgentSession` 的 model 入参。
