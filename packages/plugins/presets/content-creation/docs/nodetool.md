# Nodetool 画布与节点架构分析

## 结论

Nodetool 是四个项目中节点内核最完整、可扩展性最强的实现。它把节点、属性、端口、模型、Provider、执行器和输出渲染都做成注册式体系，并用 React Flow 承担画布交互。节点不是有限枚举，而是由多个 node pack 提供的元数据和执行实现。

对 `content-creation` 而言，Nodetool 最适合作为“内部架构标杆”，但不应直接复制其面向专家的节点数量和 UI 密度。Vetta 应采用其强类型端口、schema 属性、Provider 注册和消息流执行，同时在产品层保持 Open-AI Canvas/TwitCanva 那样的创作语义与精选节点集。

## 分析范围

- 本地仓库：`C:\develop\github\nodetool`
- 分析提交：`4311310a6`
- 许可证：AGPL-3.0，只参考设计和边界。
- 已核对界面：节点连接、节点库、检查器等视觉回归截图。
- 排除：多轨视频编辑器与时间线属性。

## 1. 画布定位与整体布局

Nodetool 将工作区定义为可执行的创意 AI 图。典型页面包括：

- 左侧全局功能栏；
- 顶部工作流标签；
- 中央 React Flow 图编辑器；
- 底部 Agent/运行输入条和 Play 操作；
- 最底部 Logs、Queue、Workers、Versions、Workspace、Trace 等运行面板；
- 可打开的节点库、命令菜单、节点信息与检查器。

它的视觉中心仍是节点图，但比另外三个项目更强调“工作流正在执行”。节点上直接显示输入表单、实时输出、状态、错误、执行时间和日志入口。

## 2. 节点不是枚举，而是定义注册表

仓库将能力拆成大量包：core、base、image、video、audio、text、document、LLM、FAL、Replicate、KIE、MiniMax、ElevenLabs、Transformers.js 等。每个 pack 注册节点元数据和执行逻辑。

节点元数据描述：

- namespace、名称、说明和图标；
- 属性列表及数据类型、默认值、可见性和校验；
- 输出槽位及类型；
- 是否为输入/输出/Agent/动态节点；
- 所需运行时和 API 密钥；
- 动态输入/输出能力。

前端的 `BaseNode` 不关心每个业务节点的表单细节，而是组合 Header、Inputs、Content、Status、Errors、Progress、ExecutionTime、ToolButtons、ResizeHandle 等通用部件。特殊节点只在确实需要专用体验时提供独立组件，例如：

- Agent、Workflow/Subgraph；
- Preview/Output；
- Sketch；
- Compare Images；
- 动态 FAL、Replicate、KIE 和 Comfy schema 节点；
- Comment、Group、Reroute。

这是 `content-creation` 应采用的核心：大多数节点由定义和通用渲染器产生，只有富媒体编辑或复杂交互才写专用 React 组件。

## 3. 属性 schema 与控件解析

`PropertyInput.resolver.tsx` 根据属性类型选择控件。覆盖：

- string/text/integer/float/bool/enum/list/dict/json；
- image/video/audio/model3d/document/file/folder/asset；
- 颜色、字体、DataFrame、Collection、Workflow、Tools；
- Sketch、Script、ImageSize；
- Language/Image/Video/TTS/ASR/Music/Embedding 等模型选择；
- media aspect ratio、resolution、duration、strength 等语义化字段。

连接后的属性会显示 Connected 状态，属性可暴露、隐藏或动态增加。这样同一份元数据同时驱动节点内表单、连接端口和验证。

Vetta 不需要一开始覆盖这么多类型，但必须先建立 `PropertyDefinition -> Editor` 的解析层；否则每新增生成节点都会产生新的手写检查器。

## 4. 端口、连接与快速创建

Nodetool 的连接是强类型槽位，不只是节点之间的一条边。输入/输出 handle 的颜色反映数据类型，编辑器阻止不兼容连接。

关键交互包括：

- 双击画布搜索并添加节点；
- 从连接拖到空白区域，显示与当前输出/输入兼容的节点；
- 输入和输出的右键菜单可搜索匹配连接；
- 支持控制流专用 handle；
- Agent 节点有独立控制输出；
- 支持动态输入、动态输出和重路由节点；
- 多选后出现 Selection Action Toolbar；
- Subgraph 将一组节点封装为可复用工作流。

`NodeStore` 负责连接校验、动态属性类型推导和节点图更新，React Flow 组件主要负责交互和显示。这个职责划分优于在事件处理器里直接写业务规则。

## 5. 节点库与发现机制

节点库不是简单下拉菜单，而是完整的能力发现界面：

- 搜索；
- 输入/输出数据类型过滤；
- Local/API/Output 以及 Image/Text/Audio/Video/Number 等快捷过滤；
- namespace 树；
- 收藏和最近使用；
- 快捷能力卡片，如 Text to Image、Image to Video、Upscale、Remove Background、Relight、Lip Sync；
- Provider 分类与可选 node pack；
- 搜索结果的节点说明。

截图中的节点总量达到数千，因此搜索、过滤、收藏和最近使用不是附加功能，而是可用性的前提。

Vetta 初期节点更少，不需要复制全部复杂度，但应从第一版保留：类别、搜索、兼容过滤、最近使用和简洁/专业模式。这样节点增加后无需重做入口。

## 6. 节点操作与运行反馈

选中单个节点时，React Flow `NodeToolbar` 在节点上方显示 `NodeToolButtons`。节点内部组合：

- 标题和 Provider/类型标识；
- 输入属性和连接端口；
- 实时内容/输出渲染；
- 运行状态、进度、错误、缺失 API Key、缺失运行时；
- 执行耗时；
- 日志、历史、终端；
- 调整大小；
- Bypass、运行单组或选中节点。

输出渲染器按类型显示文本、Markdown、图片、音频、实时 PCM、图表、JSON、DataFrame、工具调用、Agent 状态等。生成结果不是只保存 URL，而是进入统一的运行消息与输出值体系。

这对 Vetta 的启示是把“节点执行状态”和“生成任务状态”区分开：前者属于工作流运行，后者属于可能跨页面持续的外部任务。媒体生成节点需要把外部任务消息桥接为统一节点输出。

## 7. 模型与 Provider 架构

Nodetool 同时支持：

- OpenAI、Anthropic、Gemini、Groq、Mistral；
- FAL、Replicate、KIE；
- ElevenLabs；
- Hugging Face 与推理 Provider；
- Ollama、MLX、GGUF、Transformers.js 等本地能力；
- 其他独立 node pack。

Provider onboarding 使用能力而不是固定页面判断：`generate_message`、`text_to_image`、`text_to_video`、`text_to_speech`、`automatic_speech_recognition`、`text_to_music`、`generate_embedding`。

模型选择体系包含：

- Language/Image/Video/ASR/TTS/Music/Embedding 等独立选择器；
- Provider 开关与密钥可用性；
- 收藏、最近使用和默认模型；
- 推荐下载和本地模型管理；
- 模型菜单的 Provider 筛选。

动态 FAL、Replicate、KIE 节点会从远端 schema 生成属性和端口，减少为每个模型手写节点的成本。

Vetta 应吸收“能力注册 + 模型描述 + 动态 schema”，但需要在插件层增加稳定的领域参数映射，避免供应商 schema 直接成为项目文件格式。

## 8. 执行与消息流

后端将 Graph、NodeRegistry、ProcessingContext、WorkflowRunner 和传输层分开。可移植的 `runWorkflow` 接收图、注册表、存储、缓存、环境变量、密钥解析器和 AbortSignal，并以 AsyncGenerator 实时输出 `ProcessingMessage`。

执行层支持：

- 工作流级取消；
- 实时节点状态与输出；
- 浏览器内运行和服务器运行；
- HTTP/WebSocket/SSE 传输；
- 运行结果与消息统一；
- 输入流继续推送；
- 存储和缓存适配；
- Subgraph 与工作流复用。

这比在 React 组件中直接调用 Provider 更适合作为长期基础。Vetta 可以先实现较小的 `ExecutionService`，但接口应保持 UI 无关、可取消、可监听消息、可恢复外部任务。

## 9. Agent 与图构建

Agent 既可以作为图中的节点运行，也有图规划器、Graph DSL、节点搜索、图构建和提交工具。这意味着 Agent 生成的不是不可解释的 UI 操作，而是能被验证和执行的工作流图。

对于 `content-creation`，无需一开始开放任意数千节点给 Agent。更合适的是让 Agent 面向与 UI 相同的精选 `NodeDefinitionRegistry`，生成领域命令并通过端口类型验证；专业模式再逐步开放底层节点。

## 10. 应吸收与应避免

### 应吸收

- 节点包、定义注册表、通用节点渲染器和专用节点组件分层；
- 属性 schema 驱动 UI；
- 强类型、具名端口与兼容节点搜索；
- Provider onboarding 与模型能力分类；
- 动态 Provider schema；
- 执行内核与 React/传输/存储解耦；
- 实时输出、错误、日志和取消；
- Subgraph/Workflow 作为复用边界。

### 应避免

- 初期向内容创作者暴露数千个底层节点；
- 让每个节点卡片承载全部高级参数和运行诊断；
- 把通用工作流工具的术语直接用作内容创作产品语言；
- 让远端 Provider schema 直接决定持久化格式。

## 11. 对 `content-creation` 的具体落点

1. `NodeDefinitionRegistry` 成为下一阶段第一优先级。
2. `PropertyDefinition`、`PortDefinition`、`NodeRenderer`、`NodeExecutor` 分离。
3. React Flow 节点只读取定义和实例，连接校验由领域层完成。
4. 节点库支持类别、搜索、输入/输出兼容过滤和最近使用。
5. Provider、Model、Executor 使用注册接口；项目只保存稳定模型引用和领域参数。
6. 运行服务通过事件流更新节点，外部生成任务由 GenerationJob 适配。
7. UI 默认只展示精选创作节点，专业模式才展示处理器和底层集成。

## 证据文件

- `README.md`
- `ARCHITECTURE.md`
- `web/src/components/node_editor/NodeEditor.tsx`
- `web/src/components/node/ReactFlowWrapper.tsx`
- `web/src/components/node/BaseNode.tsx`
- `web/src/components/node/NodePropertyForm.tsx`
- `web/src/components/node/PropertyInput.resolver.tsx`
- `web/src/components/node_menu/NodeMenu.tsx`
- `web/src/components/node_menu/NodeLibrary.tsx`
- `web/src/components/context_menus/ConnectableNodes.tsx`
- `web/src/stores/NodeStore.ts`
- `web/src/stores/NodeMenuStore.ts`
- `web/src/stores/ModelMenuStore.ts`
- `web/src/components/provider_onboarding/providerOnboardingCatalog.ts`
- `packages/kernel/src/graph.ts`
- `packages/workflow-runner/src/run.ts`
- `packages/execution/src/session.ts`
