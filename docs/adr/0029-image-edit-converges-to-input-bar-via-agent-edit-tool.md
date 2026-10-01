# 图像编辑从活动面板收敛到 AI 输入栏，改走 agent `edit_image` tool 并成为会话轮次

ADR-0028 把图像能力拆成两条入口：会话里 agent 调 `generate_image`[[生成轮次]]，以及活动面板里对单图直调 IPC 做[[图改图]]（[[编辑谱系]]，**不经 agent、不写会话历史**）。实际落地时 `edit_image` agent tool 从未实现——编辑只活在面板里。

现在要把编辑也收敛进 AI 输入栏，让「生成 / 编辑」共用同一个输入口，并让 agent 自感知本轮该生成还是编辑。这需要重新决定编辑走哪条路、图像如何传给 agent、产物如何在消息流里呈现。

决定：

1. **删除活动面板「图像编辑」选项卡**，编辑统一从 AI 输入栏触发。`generate_image` / `edit_image` 两个内置 tool 都接到[[主进程图像服务]]（`editImage` 后端已存在，只差 agent 侧 tool 包装与 6+ 注册点），[[图像模式]]开启时**两个 tool 都对模型暴露**，agent 自行择一。

2. **agent 自感知生成 vs 编辑**：图像模式开、无 attach 时，隐藏指令让 agent 按 prompt 语义判断——全新主题调 `generate_image`，「在原图上改」调 `edit_image`（source 取上下文 `<astravia-images>` 标记里最近一张图 id）。

3. **显式编辑走 id 引用、强制 source**：[[图像预览 swiper]] 里点某图「编辑」icon → [[图像编辑 attach]]，发送时注入 `metadata.editImageId`。pipeline 见到它就强制本轮调 `edit_image` 并以该 id 为 source；**只传 id、图像字节不进 LLM 上下文**（承袭 ADR-0028 的 out-of-band 原则）。attach 一次性，编辑轮发出即释放。

4. **编辑成为正式[[生成轮次]]、写会话历史**（逆转 ADR-0028「编辑路径不写会话历史」）。每次编辑是一条新 assistant 消息。为避免同一谱系在多条消息下重复出 swiper，**只在最新一条产出该 `rootId` 的消息下渲染卡片**，旧卡自隐——marker JSON 带上 `rootId` 供 host 去重绑定 `imageRefs`。编辑是追加（v2→v5），不替换。

## Considered Options

- **保留活动面板编辑（ADR-0028 原方案）**：编辑不污染会话历史、不消耗 agent 轮次。被否：用户要「所有生成/编辑入口都在一个 AI 输入栏」并要 agent 自感知，面板是独立的第二入口、与该目标冲突；且面板编辑绕过 agent，无法做「按 prompt 决定生成还是编辑」。

- **编辑由插件 renderer 继续直调 IPC、但入口移到输入栏**：省去新增 agent tool。被否：绕过 agent 就拿不到「agent 优化 prompt + 自感知择路」，与本 ADR 第 2 点的核心诉求相悖；且会留下「生成走 agent、编辑不走」的割裂。

- **把被编辑图像作为多模态字节注入 user 消息**：让模型真的「看到」再编辑。被否：base64 入上下文违反 ADR-0028 out-of-band 原则、受 image-budget 裁剪；img2img 由后端按 id 取字节即可，模型无需看到。

- **每条编辑消息都挂完整 lineage swiper，不去重**：实现最简。被否：编辑几次就有多个几乎一样的 swiper 堆在消息流里，体验差。

## Consequences

- coding-agent 新增 `edit_image` 内置 tool，按既有约定扫齐 `tools/index.ts` 等 6+ 注册点；`ImageToolBackend` 接口加 `edit`，desktop `imageBackend` 补 `edit` 实现（转调 `editImage`）。
- `input-pipeline` 的图像分支扩展：`editImageId` 存在 → 注入「强制编辑 id=X」指令；仅 `imageMode` → 注入「自感知生成或编辑最近图」指令。`editImageId` 存在即视为图像轮次（无需另开 toggle）。**（软隔离修订：不再按 `imageMode`/`editImageId` 对本轮剥离图像 tool；工具常驻，metadata 只负责隐形意图提示。）**
- plugin-sdk 新增 `ui.setEditImageAttachment(ref | null)`：插件点编辑 icon 时写入 host 新 atom；InputBar 顶部胶囊区据此渲染缩略图胶囊；`useSessionManager` 发送时读 atom 注入 `metadata.editImageId`，发送后清空。
- `generate_image` tool-result 的 `<astravia-images>` marker 增加 `rootId` 字段；host 据此做谱系去重、只给最新消息绑 `imageRefs`；生成中的消息透传 in-flight `editImageId` 以便骨架卡直接挂在目标谱系 swiper 最前。
- 移除 image-gen 插件的 `ui.slot.activity-tab` 权限与 `registerActivityTab` 注册、删除 `ImageEditorPanel`。
- 编辑进会话历史后，重载恢复不再依赖「面板按基准图 id 重新拉谱系」，而是与生成同路——消息携带轻量引用、host 重建 `imageRefs`。
