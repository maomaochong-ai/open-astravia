# Changelog

## [Unreleased]

### Added

- 内容创作 Agent 会按最近用户意图确定性加载匹配的 Skill 与场景参考资料；视频提示词新增结构化 `promptPlan` 编译、实际生效提示词质量门禁和可操作诊断，避免模型跳过专业方法后提交泛化镜头描述。
- 创作画布左上角新增项目菜单，集中展示当前工作区的节点、素材、可用模型与生成任务，并提供内容定位、默认缩放和插件生成服务设置入口。
- Agent 创建和插入工作流节点时新增确定性增量拓扑布局：只整理受影响连通分量，优先保留用户位置，在空间不足时最小平移相关下游走廊，并保持锁定节点不动。

### Fixed

- 活动栏品牌图标改由宿主按 `plugin.json#icon` 注入（省略 `registerActivityTab.icon`），不再 `import` 包内 png 或拼宿主协议，避免 `/icon.png` 误解析为应用图标。
- `content_creation_edit` 不再由 JSON Schema 提前拒绝旧版或直觉式 `targetInput`；解析器会按目标节点归一化并返回可重试的领域错误。`configure_generation` 新增明确的 `targetNodeId`，错误会列出可用视频生成节点并提示将来源放入 `sources[]`。
- 新增 `content_creation_assets` 本地素材桥接工具：可发现宿主已授权文件/目录、导入受管素材并返回可供 `configure_generation` 使用的节点和素材 ID；缺少 `animate-still` 图片来源时返回明确的恢复建议。

### Changed

- 项目文档升级到 schema v6，在独立 `view` 中记录节点布局所有权；旧项目位置迁移为用户所有，Agent 与本地素材工具创建的节点标记为自动布局，用户拖动、缩放或手动排列后重新取得所有权。
- `content_creation_edit` 不再向 Agent 暴露或接受画布坐标；语义操作与布局位置在同一 revision 中原子提交。
- `content_creation_edit` 现在对创建、修改、删除与连线批次执行 revision-safe 原子提交，不再创建会话预览卡或要求用户确认。
- `content_creation_run(action="prepare")` 的授权入口从会话卡片迁移为插件全局确认弹窗；准备阶段仍不调用供应商，只有用户确认后才开始生成。
- Agent 视频工作流改为意图驱动的 `configure_generation`：区分文生视频、单图动画、首尾帧插值、多模态参考和视频转换，原子写入实际模型模式、来源引用及首帧/尾帧/图片/视频/音频角色；机械媒体连线与只有集合边、没有具体素材引用的图会被诊断并禁止运行。
- 项目文档升级到 schema v5，视频输入由旧的 `startImages` / `referenceVideos` 分组迁移为可扩展的带角色 `mediaSources`，保留旧项目的来源与角色信息。
- Agent 普通工作流操作继续使用 `targetInput` 语义输入，图片素材使用 `bind_assets`，不再要求模型猜测内部端口 handle。
- `inspect` 新增 `graph` 与 `readiness` 视图，返回语义连接、连通分量、孤立节点、可运行/阻塞节点及工作流状态。
- 暂时去掉 `contributionMode.hardIsolation` 与输入栏硬隔离：活动栏「内容创作」默认上栏（`initiallyVisible: true`），Agent skills/tools 在插件启用后始终贡献；输入栏开关仅作软显隐与 prompt 装饰。
- 原 7 个画布工具收敛为 `inspect`、`edit`、`run` 三个领域工具，并按当前用户意图动态启用最小集合。
- Agent Skill 扩展为创意概念、工作流操作、图片创作、视频创作、质量审查和多资产 Campaign 六个渐进式入口；完整融合 visual-skills 的模型 Prompt Profile、提示词骨架、文字信息设计、视觉拆解、多面板、行业配方、镜头戏剧性、角色模式、Animatic、视频编辑/延长与速度场景方法。
- 完整审阅并融合 Generative-Media-Skills Library 的 57 个 Skill：新增品牌与发布、电商与空间、身份与试穿、UI 与分镜、产品视频、UGC 与表演、动作与教程、社媒与切片等按需场景手册，并补齐引用角色、时间码、工作流发现执行和场景质量闸门。
- 视频生成 Prompt 补齐连续时间窗、连续单镜头、多镜头、分镜映射和 5-30 秒场景示例。
- Activity panel tab icon now uses the plugin's own `icon.png` instead of a generic lucide glyph.
- MiniMax H3 视频输入改为能力驱动的三种创作模式：文本生成无需参考素材，首尾帧显示独立的首帧/尾帧槽并跟随输入比例，全能参考接受模型声明的图片、视频和音频数量；切换模式会保留非当前模式素材，但生成时只提交当前模式输入。
- Selected nodes are now named one by one on the input bar instead of collapsing into a single "N nodes" capsule, matching the host's new attachment strip.

### Fixed

- 内容创作运行时、媒体/设置订阅、快捷键桥接与运行审批队列现在绑定到具体插件 activation；热更新释放旧实例时不再清空新实例，避免 Activity Tab 启动时报 `content-creation runtime is not initialized`。
- 连线失败现在区分端口不存在、类型不匹配、目标端口占用、自连接与成环，并返回可操作的错误代码和上下文，不再统一报错 `node ports are incompatible or would create a cycle`。
- 未配置所需 API Key（或必要 endpoint/model）的 Provider 模型不再出现在模型列表；设置变化后画布模型选项会即时刷新。
- Generated video nodes now preserve a playable video MIME type and preload metadata instead of rendering an unusable `0:00` player.
- Generated video nodes now use compact custom playback controls; the video surface remains available for dragging the React Flow node while controls stay interactive.
- Image and video generation nodes now persist their host job handle, resume status/progress polling after a renderer refresh, and finish artifact persistence instead of remaining stuck in the last saved running state.
- Missing host jobs now become retryable generation failures instead of being polled indefinitely after recovery.
- Video generation now follows the first input image's aspect ratio by default, including legacy assets without persisted dimensions, preventing portrait MiniMax H3 frames from being stretched into a landscape canvas while preserving explicit ratio choices.
- Generator option menus and video settings now use consistent non-modal DropdownMenu/Popover interaction with shared borderless triggers and a canvas-aware capture boundary, preserving outside hover and reliable blank-area dismissal without event-order coordination; the grouped panel also consistently bounds aspect-ratio previews, removes duplicate inline controls, and filters stale model options.
- Video aspect-ratio chips stay on one row without vertical overflow: ratio icons use a fixed visual budget, and the settings popover is height-capped with scroll when space is tight.
- Strengthened the multi-node selection group outline: more visible primary fill, dashed border, and 12px inset spacing from selected cards (plus a clearer marquee while dragging).
- Kept node editors hidden during dragging and delayed a newly selected node's editor until drag end, while preserving already mounted editor state.
- Deferred generation-control option trees until their dropdown opens, avoiding a large first-frame mount when dragging an unselected generator node.
- Prevented React Flow position updates from rerendering the selected node's full generation editor during canvas dragging.
- Restored asset and generated-image previews after switching away from and back to the content-creation activity tab.
- Scoped generation failures to their originating node job instead of repeating them in the node editor, panel banner, and host notification.
- Kept node-bound editors mounted outside the card viewport and constrained long prompt inputs to internal scrolling.
- Preserved active prompt drafts across stale parent refreshes, removed colored node-card top accents, and raised placeholder contrast to a readable subdued level.
- Unified generator `@` suggestions across connected prompts and compatible media, including inline media previews and bindings.
- Centralized node editor interaction boundaries so future panels keep inputs editable while non-interactive panel areas remain draggable and text stays non-selectable.
- Reduced node editor placeholder contrast so empty prompts no longer compete with entered content.
- Restored `@` media suggestions for valid element-boundary carets, expanded candidates beyond connected nodes, and rendered image thumbnails in the picker and inline tokens.
- Restored focus and caret placement in node editors by excluding their interactive panels from React Flow canvas panning.
- Box selection now includes nodes that partially intersect the selection rectangle instead of requiring full containment.
- Restored primary-button canvas panning while keeping box selection available through Control-drag.
- Restored the “drop connection on empty canvas → create compatible node” menu: the pane click that follows `onConnectEnd` no longer immediately dismisses it.
- Node resize: disabled forced aspect ratio so corners and edges can free-resize width/height independently; edge controls are invisible hit strips (no outer frame gap) with quiet corner grips instead of a second primary border.

### Changed

- Migrated host media generation to the generic `media.submit`, `jobs`, and `artifacts` APIs so the same runtime can later consume composition Providers without depending on a specific render engine.
- The content-creation activity tab now expands to the host's maximum available panel width whenever it is activated, while remaining user-resizable afterward.
- Reworked visible project JSON as a self-describing schema v4 workflow document with explicit goals, deliverables, node purposes, typed inputs/results, semantic assets, and separate canvas layout; jobs and transient statuses remain in plugin storage, with toolkit-managed migration and TypeBox validation.
- Moved workspace project persistence to the visible root `content-creation.json`; legacy hidden projects are copied forward, and generated media now lives under the workspace `output/` folder with relative project references.
- Content assets now persist stable blob IDs and resolve host media URLs at runtime; schema v1 projects migrate automatically to schema v2.
- Limited asset preview URL resolution to eight concurrent host lookups and evicted cached references outside the current project.
- Restyled the multi-node selection outline with subdued theme colors, a thin solid border, and matching corner radii instead of React Flow's prominent default blue dotted frame.
- Replaced hand-authored plugin and node SVG icons with a consistent Lucide Iconify set, inlined static icon classes at their use sites, and corrected dock hover centers to match the rendered item widths.
- Restricted the plugin to Work mode via manifest `agent_mode: ["work"]` (hidden in Coding; ADR-0046).
- Node quick toolbar is icon-only (no inline rename) and sits 8px above the card to match the generation composer gap; identity header hides while the toolbar is open.
- Canvas Delete / Backspace now use the host plugin shortcut stack (`usePluginShortcutScope`) instead of React Flow `deleteKeyCode`, so they participate in scope priority, skip locked nodes, and stay inactive while the activity tab is hidden or focus is in an editable field.

- Node surface copy and placeholders scale with the card size (container query units) so image/video empty states stay proportional when resized.
- Softened bottom dock hover magnification (lower peak scale, narrower influence, smoother easing) to reduce visual dizziness.
- Reorganized the package by feature folders (`panel` / `canvas` / `node` / `timeline` / `project` / `generation` / `plugin` / `shared`) instead of a catch-all `domain` + flat `components` layout; split React Flow and node styles into per-area CSS files under `styles/` + feature modules.
- Removed the content-creation panel header (title, path, revision, graph/timeline switch) so the canvas uses the full tab area; timeline workspace remains in the package for later re-entry.
- Collapsed typed port capsules into one centered connection handle per card side; the UI now infers compatible logical ports while persisted edges keep their typed semantics.
- Added a Mac Dock–style magnification hover effect on the bottom node-creation dock (with reduced-motion fallback).
- Kept node bodies as zoomable content previews and mounted per-node editors in a non-scaling `NodeToolbar`, so controls remain usable at low canvas zoom.
- Polished content-creation canvas UX: node chrome, themed React Flow controls, and broader `@vetta/ui` usage (Button / Select / DropdownMenu / Slider / Spin).
- Activity tab「内容创作」默认不上栏（`initiallyVisible: false`）；由 `open_content_creation` 或用户从「+」添加后再显示。
- Replaced the permanent node inspector with content-first media nodes, persistent canvas sizing, node-bound generation composers, contextual creation menus, and a compact bottom dock inspired by Open-AI Canvas and Loomic.
- Added multi-selection alignment and layouts, lock-aware canvas geometry, drag alignment guides, viewport-clamped context menus, inline node naming, larger connection hit targets, and detailed generation job feedback.
- Simplified the canvas chrome by removing the minimap, dot background, and React Flow attribution, and separated node interaction overflow from the clipped content shell.
- Moved node identity into an external header, added hover-discoverable quick actions, simplified content surfaces, and memoized node rendering while keeping full generation settings selection-bound.

### Added

- Added an agent-native content workflow service with semantic state inspection, model capabilities, actionable diagnostics, automatic node placement, revision-safe edits, a global generation approval gate, dependency-ordered execution status, and bundled workflow/video creation Skills.
- Added a structured, persistent input-bar context for the current canvas selection so the agent receives selected node IDs, current semantic node data, adjacent connections, and safe asset summaries without canvas layout, jobs, timestamps, previews, or private storage IDs.
- Added input-bound, opt-in prompt optimization through host-managed AI models with reusable node-specific profiles; successful results replace the effective prompt while preserving the structured original.
- Added host media-provider discovery and image generation through the plugin media capability, with generated artifacts persisted as visible workspace output files.
- Added structured multimodal prompt documents with compact inline media tokens and mixed `@` prompt references, preserving editable local text while carrying referenced media into generation model compatibility checks.
- Upgraded asset nodes into scalable image, video, and audio collections with recursive file or folder drop, host-side zero-Base64 import, canvas drop-to-create, compact summaries, incremental management, and model-compatible selection from connected generation nodes.
- Added explicit select and hand tools to the canvas dock with visible active state.
- Added the initial content-creation canvas and multitrack composition preset foundation.
- Added reference-project design notes, a schema-driven node registry, typed ports, connection validation, compatible-node creation, and node workflow tests.
- Added secure plugin credentials, provider/model registration, a real OpenAI-compatible image adapter, generation jobs, artifact return, and fully mocked tests.
- Added capability-based OpenAI Images, Replicate, Gemini/Veo, and configurable NewAPI video adapters with the Loomic media model catalog.
- Added model-declared image/video reference slots, persistent reference imports, shared compatibility resolution, and multimodal Provider request mapping.

### Fixed

- Replaced controlled React Flow node and edge props with internal transient canvas state plus one-way project snapshot synchronization, preventing drag and ResizeObserver updates from feeding back through the StoreUpdater passive effect.
- Fixed typed connection ports being clipped by the node content container; ports now remain discoverable and reveal their labels on hover or selection.
