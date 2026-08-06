# TwitCanva Video Workflow 画布设计分析

## 结论

TwitCanva 是一个比 Open-AI Canvas 更轻、更直接的媒体生成工作流。它用少量固定节点和明确的类型连接，把“文本到图片、图片到图片、图片到视频、首尾帧视频、运动参考、编辑后继续生成”做成可视化链路。

它最值得 `content-creation` 参考的是节点内操作的低学习成本、模型能力矩阵和类型感知连接；最需要避免的是把模型与连接规则集中写死在前端，以及让单个节点控制组件承担过多模型特例。

## 分析范围

- 本地仓库：`C:\develop\github\TwitCanva-Video-Workflow`
- 分析提交：`9705b26`
- 许可证：Apache-2.0；本项目仍只参考设计，不复用代码和资产。
- 已核对界面：`public/day-mode-with-chat-window.png`、`public/workflow-sample-1.png`
- 排除：最终时间线与外部剪辑流程。

## 1. 画布范式与页面结构

TwitCanva 不依赖 React Flow，而是使用绝对定位 DOM 节点、自定义拖拽/框选/缩放，以及独立 SVG 层绘制贝塞尔连线。

页面主要区域为：

- 左侧胶囊式垂直工具栏：添加、工作流、素材、历史、工具；
- 画布中央：媒体缩略图节点与生成链路；
- 节点被选中后显示控制区和左右连接按钮；
- 工作流、素材、历史面板从左侧工具栏旁展开；
- Agent Chat 从右侧滑入；
- 图片编辑、视频编辑、分镜生成等重任务使用模态窗口。

视觉上大量节点只显示媒体内容，复杂参数在选中时出现，因此即使画布中存在很多结果分支，也仍然接近素材板而不是表单图。

## 2. 节点类型与状态

`src/types.ts` 定义固定节点集合：

| 节点类型 | 角色 | 主要输入/输出 |
| --- | --- | --- |
| `TEXT` | 提示词源 | 输出 prompt，可直接转图片或视频 |
| `IMAGE` | 图片生成/素材 | 接收文本或图片，输出图片 |
| `VIDEO` | 视频生成/素材 | 接收文本、图片、视频尾帧或运动参考，输出视频 |
| `AUDIO` | 音频占位 | 类型存在，但连接规则尚未支持 |
| `IMAGE_EDITOR` | 图片编辑结果 | 接收图片，保存画笔、箭头、文字、裁剪等编辑状态 |
| `VIDEO_EDITOR` | 视频裁剪结果 | 接收视频，保存 trimStart/trimEnd |
| `STORYBOARD` | 分镜管理 | 组织故事、角色与场景生成流程 |
| `CAMERA_ANGLE` | 视角变换 | 基于图像和旋转/倾斜/缩放参数生成新视角 |
| `LOCAL_IMAGE_MODEL` | 本地图像模型 | 选择本地 checkpoint/架构并生成 |
| `LOCAL_VIDEO_MODEL` | 本地视频模型 | 为本地视频推理预留 |

状态统一为 idle/loading/success/error。`NodeData` 同时保存画布位置、父节点 ID、生成结果、模型参数、媒体模式、编辑器状态、Kling 人脸/主体引用参数和本地模型信息。

与 Open-AI Canvas 相同，它也出现了共享数据结构逐渐膨胀的问题。Vetta 不应复制这种数据组织方式。

## 3. 节点内容与就地操作

节点空状态本身就是操作入口：

- Text 节点展示“自己写内容 / Text to Video / Text to Image”；
- Image 节点展示上传，以及选中后的 Image to Image / Image to Video；
- Video 节点有输入图时显示模糊背景和 “Ready to animate”；
- Loading 状态直接覆盖媒体区，成功后显示结果；
- 本地模型节点通过硬盘标记与云模型区分。

`NodeControls.tsx` 在节点下方提供：

- 提示词输入；
- 模型选择；
- 比例、分辨率、时长；
- 视频标准/首尾帧/运动控制模式；
- 参考图片与模型兼容性提示；
- Kling 人脸/主体引用及强度；
- 原生音频开关；
- 本地模型和 GPU 条件。

优点是用户不需要在画布和远端检查器之间来回切换。缺点是组件超过单一职责，模型列表、能力判断、表单、面部检测和生成按钮集中在同一文件。

对 Vetta 的合适折中是：节点内只保留 prompt 与 2—3 个高频参数，完整能力放到类型化检查器；二者读取同一个 schema，避免重复逻辑。

## 4. 连接设计

每个节点左右各有一个悬浮加号连接器。用户可以：

- 短按连接器打开“添加下一个节点”菜单；
- 拖到另一个节点的左侧，使对方接收当前输出；
- 拖到右侧，反向把对方作为当前节点的上游；
- 点击连线选择并删除。

连接实际存储在子节点的 `parentIds`，支持多个上游。SVG 层根据节点类型、媒体比例和实际内容估算节点尺寸，再绘制曲线。

`useConnectionDragging.ts` 中的主要规则是：

- Text 只能输出到 Image/Video，不能接收输入；
- Image 可到 Image/Video/Image Editor；
- Image Editor 可到 Image/Video/Image Editor；
- Video 可到 Video/Video Editor；
- Video Editor 可到 Video；
- Audio 暂不允许连接；
- Storyboard 暂时放开，尚未形成严格语义。

连接完成时还会同步 Text prompt，或将图片结果作为视频输入。相比单纯检查媒体类型，这是“连接产生领域行为”的例子。

问题在于规则直接依赖 `NodeType` 条件分支，新增类型或 Provider 特例会不断扩大。Vetta 应把兼容性放进端口定义，并把“连接后同步 prompt”等副作用做成领域命令处理器。

## 5. 画布与面板操作

### 全局工具栏

左侧工具栏将常用资源入口稳定放在同一位置：

- 添加节点；
- 我的工作流；
- 素材库；
- 历史；
- 工具下拉中的 TikTok 导入和 Storyboard Generator。

工作流面板支持我的/公开工作流、封面选择和加载；素材面板按类别浏览并可把图片/视频加入画布；历史面板保留生成记录；这些面板互斥打开，避免遮挡过多画布。

### 右键菜单

空白处提供上传、素材、添加节点、撤销/重做和粘贴；节点菜单提供创建素材、复制、重复和删除。连接器短按会复用添加节点菜单，使“创建并连接”与“空白创建”保持同一种选择体验。

### 框选与群组

自定义框选和 `SelectionBoundingBox` 支持多节点操作；`NodeGroup` 保存一组节点以及故事上下文，可用于分镜生成后的整体移动和管理。

### 专项编辑

图片编辑器保存画笔 canvas、箭头、文字和背景，重新打开时可继续编辑；视频编辑器关注裁剪；Camera Angle 用 3D 轨道控制器表达旋转和俯仰，再把参数转换为生成提示词。这些能力以专用工具存在，而不是塞进通用节点表单。

## 6. 模型与能力矩阵

模型列表目前主要定义在前端控制组件中。

### 图片

- OpenAI GPT Image 1.5；
- Google Nano Banana Pro（内部 ID `gemini-pro`）；
- Kling V1.5；
- Kling V2.1；
- 本地 Stable Diffusion、SDXL、Qwen、ControlNet、LoRA 等。

每个模型声明是否支持单图/多图、分辨率和比例。Kling V1.5 另有 subject/face 引用模式与强度。

### 视频

- Google Veo 3.1；
- Kling V2.1、V2.1 Master、V2.5 Turbo、V2.6 Motion；
- Hailuo 2.3、2.3 Fast、Hailuo 02；
- Fal.ai 用于 Kling V2.6 Motion Control。

模型记录文生视频、图生视频、多图、时长、分辨率和比例能力。UI 会根据标准、首尾帧或运动控制模式过滤可用模型，例如运动控制暂时只允许 Kling 2.6。

### 本地模型

`localModelService.ts` 提供模型目录扫描、GPU/显存检测、架构注册表和本地生成接口。架构可定义 pipeline、默认 steps/guidance/尺寸和分辨率。

这部分体现了正确方向：模型能力应该是数据。但它目前与 UI 文件绑定。Vetta 应将其提升为插件运行时注册表，并允许宿主或其他插件贡献 Provider 和模型。

## 7. 生成与素材回流

前端统一调用 `/api/generate-image` 和 `/api/generate-video`，后端代理不同供应商并保护密钥。生成完成后结果 URL 写回节点；工作流可以保存、加载和公开分享；结果可以保存到素材库并再次插入画布。

本实现的前端服务只等待单次响应，缺少统一的后台任务协议、持久化进度和刷新恢复。对长视频任务而言，这是 Vetta 不应沿用的部分。

## 8. 应吸收与应避免

### 应吸收

- 空节点直接给出下一步操作建议；
- 媒体结果主导节点视觉，参数在选中时出现；
- 短按端口添加下游、拖拽端口直接连接；
- 根据输入模式过滤模型；
- 首尾帧、运动参考、原生音频等能力以结构化字段表达；
- 专项编辑器与通用节点分离；
- 云模型和本地模型在同一用户流程内切换。

### 应避免

- 在 `NodeControls` 中维护所有模型和特例；
- 用 `parentIds` 代替具名、强类型端口；
- 由 SVG 层重复估算节点布局尺寸；
- 把节点类型、模型参数和编辑器状态全部塞进一个接口；
- 长任务只依赖一次 HTTP 请求。

## 9. 对 `content-creation` 的具体落点

1. 节点空状态提供类型化快捷入口，例如 Text 节点直接创建并连接 Image Generator。
2. 端口支持短按打开兼容节点菜单，拖拽则直接连接。
3. 先实现 prompt/image/video/audio/config 等具名端口和声明式兼容规则。
4. 模型描述符至少包含 text-to-media、image-to-image、image-to-video、multi-reference、first/last-frame、audio、duration、resolution 和 aspect-ratio 能力。
5. 节点内只展示 prompt、模型和一个关键参数，其余放在检查器/专项面板。
6. 本地模型未来作为 Provider Adapter 接入，不创建一套完全独立的节点协议。

## 证据文件

- `src/types.ts`
- `src/App.tsx`
- `src/components/Toolbar.tsx`
- `src/components/ContextMenu.tsx`
- `src/components/canvas/CanvasNode.tsx`
- `src/components/canvas/NodeContent.tsx`
- `src/components/canvas/NodeControls.tsx`
- `src/components/canvas/NodeConnectors.tsx`
- `src/components/canvas/ConnectionsLayer.tsx`
- `src/hooks/useConnectionDragging.ts`
- `src/services/generationService.ts`
- `src/services/localModelService.ts`
- `src/components/WorkflowPanel.tsx`
- `src/components/AssetLibraryPanel.tsx`
- `src/components/HistoryPanel.tsx`
