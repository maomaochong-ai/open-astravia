# Loomic 画布设计分析

## 结论

Loomic 不是节点工作流编辑器。它以 Excalidraw 原生自由画布为基础，把图片/视频生成器实现为带 `customData` 的矩形占位对象；用户选中对象后，对象下方出现生成面板，成功后占位对象被真正的图片或可播放视频替换。

它对 `content-creation` 的价值在于展示另一种低门槛交互：用户先在空间中放一个“我要在这里生成内容”的对象，再就地配置和替换；Agent 也直接检查和操作画布元素。但它没有端口、类型化连接和可重复执行的数据流，因此适合作为自由对象层和就地生成体验参考，不适合替代当前 React Flow 图内核。

## 分析范围

- 本地仓库：`C:\develop\github\Loomic`
- 分析提交：`875ff78`
- 仓库根目录未发现明确 LICENSE 文件，必须继续坚持只参考行为和架构，不复用实现。
- 已核对界面：`docs/images/canvas-image.png`
- 排除：时间线；该项目当前画布分析也不依赖时间线。

## 1. 画布范式与页面布局

核心编辑器动态加载 Excalidraw。页面结构是：

- 中央自由画布，支持 Excalidraw 的选择、矩形、椭圆、箭头、线、手绘、文字和图片等工具；
- 底部中央工具条，把 AI 图片和 AI 视频作为与常规绘图工具并列的动作；
- 左下角状态栏管理图层、文件、背景和缩放；
- 选中生成器占位对象后，在对象下方显示浮动生成面板；
- 右侧 Agent 对话面板可理解当前选择并操纵画布。

用户看到的是设计白板，而不是工作流。图片、形状和生成器可以自由摆放，没有执行方向和边。

## 2. 画布对象体系

Loomic 主要复用 Excalidraw 原生元素：text、image、rectangle、ellipse、diamond、line、arrow 和 embeddable 等。AI 能力通过两种特殊矩形表达：

### Image Generator

`customData` 保存：

- `type: image-generator`；
- idle/generating/completed/error；
- prompt、model、aspectRatio、quality；
- 可选 inputImages 和 errorMessage。

占位矩形按比例计算显示尺寸，默认创建在视口中心。比例改变时保持中心点并调整矩形宽高。

### Video Generator

`customData` 保存：

- `type: video-generator`；
- 状态、prompt、model、aspectRatio；
- duration、resolution；
- inputImages 和错误。

它同样以矩形占位，并在生成中显示视觉反馈。

这两个对象不是计算节点：没有输入/输出端口，引用图片保存在面板状态或 `customData` 中，生成后原占位对象被标记删除。

## 3. 就地生成面板

只有单选一个生成器对象时才打开对应面板；零选或多选会关闭。面板的位置根据元素画布坐标、滚动和缩放实时换算，锚定在对象下方。

### 图片面板

提供：

- 自动增高的提示词输入，Enter 生成、Shift+Enter 换行；
- 从服务端读取的模型列表、图标、可访问状态和 credit cost；
- 多参考图上传和缩略图；
- 1K/2K/4K 质量；
- 1:1、16:9、9:16、4:3、3:4 比例；
- 生成、加载和错误状态。

生成成功后下载结果、注册为 Excalidraw file，在原占位对象的位置和尺寸创建原生 image 元素，然后删除占位对象。

### 视频面板

提供：

- 首帧和尾帧图片；
- prompt；
- 比例、时长、分辨率；
- 动态模型列表及费用；
- 生成状态。

成功后在相同位置创建 Excalidraw embeddable，使用自定义 `renderEmbeddable` 在画布内直接播放视频。

这种“占位 -> 配置 -> 原位替换”非常适合单次创作，也能自然表达最终布局。缺点是替换后丢失可重新执行的生成器实体，生成参数主要留在媒体 `customData` 中，难以形成可重放的依赖链。

## 4. 状态、保存与生成反馈

`CanvasEditor` 对 Excalidraw onChange 做 1.5 秒防抖保存，并延迟生成缩略图。它特别处理初始化水合：在初始元素完整加载和规范化之前禁止自动保存，避免空场景覆盖已有内容。

生成对象的 loading 状态通过 `customData.status` 驱动闪烁/骨架覆盖层；覆盖层根据 zoom/scroll 和元素 bounds 同步。请求使用 AbortController，组件卸载或再次提交时取消前一个请求。

图片和视频成功后立即成为原生画布内容。Agent 生成的产物若没有指定坐标，会：

- 空画布时放在视口中心；
- 非空画布时放在最右侧对象右边，保留间距并垂直居中；
- Agent 显式提供 placement 时按指定坐标和尺寸插入。

智能摆放规则简单但稳定，适合 Vetta 的“生成变体自动排布”。

## 5. Agent 与画布协作

Agent 工具覆盖：

- inspect canvas：读取元素、选择或视口范围；
- manipulate canvas：创建、更新、删除和组织画布元素；
- screenshot canvas：获取视觉上下文；
- generate image/video：提交生成并返回可插入画布的产物；
- 项目搜索、品牌套件和文件持久化。

生成工具的 schema 会根据当前已注册模型动态构造枚举和说明。Agent 可先检查画布，再给出 placement；前端通过元素 ID、任务 ID和产物 URL把结果写回。

这说明 Agent 不必只操作节点图，它也可以对自由对象进行空间推理。但 Vetta 仍应让 Agent 通过领域命令而不是直接生成 Excalidraw/React Flow 内部 JSON。

## 6. Provider 与模型注册

服务端用图片/视频 Provider Registry 聚合可用模型，通过模型 ID解析 Provider。Provider 是否注册取决于环境中是否存在对应密钥或 Vertex 配置。

### 图片模型快照

- Google 官方 Gemini 2.5 Flash Image、Gemini 3.1 Flash Image Preview、Gemini 3 Pro Image Preview；
- Google Vertex 对应 Gemini 图像模型；
- OpenAI GPT Image；
- Replicate 上的 Imagen 4/3、GPT Image 1.5/1、Flux Kontext Pro/Max、Flux 1.1 Pro、Seedream 5 Lite/4.5/4、Recraft V3 等；
- Volcengine 图片 Provider。

### 视频模型快照

- Google API / Vertex 的 Veo 3.1、Fast、Lite、3.0、2.0；
- Replicate 的 Kling V3/V3 Omni/V2.6/O1；
- Seedance 1.5 Pro；
- Wan 2.6；
- Sora 2/2 Pro；
- Replicate 上的 Veo 3/3.1；
- Hailuo 2.3。

模型描述包含比例、输入图/输入视频、音频、时长、分辨率和费用分级。前端面板从 `/image-models`、`/video-models` 获取可用模型，而不是直接导入服务端列表。

### Agent LLM

Agent 使用 LangChain/LangGraph，支持 OpenAI、Google Gemini 和 Vertex 配置，默认策略可在没有 OpenAI Key 时回退到 Google。

## 7. 后台任务架构

共享任务协议定义 queued/running/succeeded/failed/canceled/dead_letter，任务类型包括 image_generation 和 video_generation。Payload 保存 prompt、model、比例、质量/时长/分辨率、输入媒体和音频开关，并关联 user/project/canvas/session/thread。

服务端通过 PGMQ 队列和 worker 执行生成：

- HTTP/Agent 提交任务；
- worker 按 Provider 生成并持久化产物；
- 任务结果可携带画布 element ID；
- Agent 等待超时后，worker 仍可继续；
- 前端通过轮询兜底接收迟到结果。

这部分比其前端直接生成面板更健壮。Vetta 应统一只走任务服务，避免“面板直调”和“Agent 队列”形成两套状态语义。

## 8. 应吸收与应避免

### 应吸收

- AI 工具与普通绘图工具并列，降低“搭工作流”门槛；
- 生成器占位对象与锚定面板；
- 比例变化时保持中心和视觉尺寸；
- 生成中状态覆盖层随视口同步；
- 产物的智能空间摆放；
- 图片使用原生画布对象、视频画布内播放；
- Agent 检查选择/视口并控制 placement；
- Provider 注册表与后台任务队列。

### 应避免

- 生成成功后完全删除可执行来源，导致不可重放；
- UI 直接等待长视频请求；
- 依赖 Excalidraw 内部对象 JSON作为领域协议；
- 没有端口和依赖图时，仅凭空间位置表达工作流；
- UI 与 Agent 使用不同的生成路径。

## 9. 对 `content-creation` 的具体落点

1. 保留 React Flow 执行节点，同时引入 `CanvasObject` 概念承载文本注释、形状、绘图和展示型媒体。
2. 生成节点可支持“画布占位模式”：先确定结果位置/比例，再打开锚定面板。
3. 成功后不要删除生成节点；可以隐藏生成参数层，同时创建或绑定 Artifact 展示对象。
4. 结果自动排布采用稳定策略：优先目标占位，其次来源节点右侧，再次视口中心。
5. Agent 的空间操作使用稳定领域命令和 placement，不暴露 React Flow 内部结构。
6. UI 与 Agent 统一提交 GenerationJob，由同一任务恢复机制更新节点和对象。

## 证据文件

- `apps/web/src/components/canvas-editor.tsx`
- `apps/web/src/components/canvas-bottom-bar.tsx`
- `apps/web/src/components/canvas-tool-menu.tsx`
- `apps/web/src/components/canvas/image-generator-panel.tsx`
- `apps/web/src/components/canvas/video-generator-panel.tsx`
- `apps/web/src/lib/canvas-elements.ts`
- `apps/web/src/lib/canvas-image-generator.ts`
- `apps/web/src/lib/canvas-video-generator.ts`
- `apps/server/src/generation/providers/registry.ts`
- `apps/server/src/generation/providers/register-all.ts`
- `apps/server/src/agent/tools/inspect-canvas.ts`
- `apps/server/src/agent/tools/manipulate-canvas.ts`
- `apps/server/src/agent/tools/image-generate.ts`
- `apps/server/src/agent/tools/video-generate.ts`
- `apps/server/src/features/jobs/job-service.ts`
- `packages/shared/src/job-contracts.ts`
