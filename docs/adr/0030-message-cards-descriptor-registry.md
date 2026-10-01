# 消息卡片改为「声明式描述符 + 按 type 动态渲染器注册表」

消息列表下方的插件卡片，从旧的「每条消息 mount 全部已注册 slot、各 slot 自己 `null` 自我隐藏」模型，反转为「host 持有每条消息真实的[[卡片描述符]]列表，按描述符的 `type` 在[[卡片渲染器注册表]]里查到组件再渲染」。注册表与现有 `pluginMessageSlotsAtom` 同机制（运行时 jotai atom，插件 `activate()` 注册、Disposable 卸载），只是改成按 `type` 查；`type` 命名空间化、由插件自己拥有，host 永不枚举或硬编码。应用内置卡片用同一 `registerCardRenderer` 接口平权注册。

## 为什么

旧模型有三个绕不过的硬伤：host 不知道某条消息到底渲染了哪几张卡片（slot 自我隐藏对 host 不透明），于是 **tab 收纳的可见性与标签都无从计算**；卡片只能来自插件、应用本地无路径；image-gen 还把 image refs 夹带在 tool **结果文本**里（`<astravia-images>` 标记），污染模型可见通道、解析脆弱。

描述符模型让 host 对「这条消息有哪几张卡片」有声明式权威认知——tab 可见性、标签（取描述符 `title`/`icon`）一并解决；插件卡片与（未来的）应用本地卡片走完全同一条渲染路径。

## 关键决定

- **契机走已有的 `details` 通道，不新发明。** 工具产物的 `content`（模型可见）之外，已有 `details`（模型永不可见，`extractToolImagePreview`/`extractToolUiDetails` 解析 diff/imagePreview/ask_user_question）。卡片描述符作为 `details.cards: CardDescriptor[]` 搭这条车，随 tool_call block 持久化进 jsonl、精确锚定到 `toolCallId`。取代 `<astravia-images>` 文本标记 hack。
- **描述符形状**：`{ type, key?, payload, title?, icon? }`。`payload` 存**稳定引用**（如 image id / rootId）而非内容快照，渲染器据此解析实时状态。跨 agent→desktop 边界序列化，故 `title` 是字符串、`icon` 是 [[icon symbol]] 式的符号串；注册默认值（插件 bundle 内）才可为 React 节点。
- **跨轮去重靠 `key`。** 同 `key` 跨轮出现 = 同一逻辑卡片，host 只在其**最新锚点**渲染（把今天的 `latestOwnerByRoot` 上升为通用能力）。无 `key` 的卡片退化为逐个独立。
- **标题/图标：描述符为主，注册默认兜底。** 描述符没填则取该 `type` 注册时的默认，再没有回退插件名。
- **生成中（pending、无 result）发预备描述符。** tool start 即在 tool_call block 上挂一个 `pending` 状态的描述符（骨架因此占一个 tab）；tool 完成后 `details.cards` 按 `key` 替换之。保持 host 始终权威。
- **应用本地命令式 push（`host.pushCard`）本期不实现**，仅由描述符/注册表模型预留——后续是加法，不改契约。

## 被拒方案

- **保留 slot 自我隐藏，只把 marker 换成 `details.cards`**：改动小，但 tab 可见性/标签/本地卡片问题原样存在，得用 DOM 测量等别的手段绕，不值。
- **不去重、每轮各显各的**：最简单，但 image-gen lineage 会出现重复图卡，与现产品行为冲突。

## 影响

- 插件 SDK：新增 `registerCardRenderer({ type, component, title?, icon? })`，`PluginMessageSlotContribution` 路径被其取代；新增顶层运行时导出需同步 plugin-protocol.ts 的 `astravia-host://plugin-sdk` shim。
- image-gen 需从 `<astravia-images>` 标记迁移到 `details.cards`，生成中骨架改走预备描述符。
- 收纳 UI（≥2 张卡片才出操作 area；tab 收纳为基本形态、列表平铺为不持久化的临时形态）建立在 host 已知卡片列表之上。
- 插件自注册工具（`ctx.agent.registerTool`）也可产卡片：handler 返回值里的 `cards` 字段由宿主 `createPluginTool` **提升**到 `details.cards` 并从模型可见文本剔除，故插件无需协同内置工具即可在消息下方渲染卡片（demo-map 的 `demo_map_focus` / `demo_map_present_regions` 即如此）。`registerToolCallSlot`（按 toolName 内联替换工具渲染）作为另一可选 UI 出口保留。
