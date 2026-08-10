# Generative-Media-Skills Library 全量融合

## 结论

本轮完整阅读了 `Generative-Media-Skills/library` 在本地提交 `03f13625d836ea0679abb5f174003d9f8bd60cb3` 下的 57 个 `SKILL.md`：1 个 edit、21 个 motion、7 个 social、27 个 visual 和 1 个 workflow。

此前只把 Library 概括为 Campaign 配方库是不充分的。它的真正价值有两层：

1. 通用导演层：镜头、时间码、引用素材角色、物理运动、声音和结尾状态。
2. 场景执行层：打斗、烹饪、UGC、商品组图、品牌系统、空间改造、长视频切片等各自不同的输入、阶段、闸门和失败回退。

Vetta 保留这两层，但不复制 MuAPI CLI、固定模型名、费用、供应商限制或未经 capability registry 声明的能力。融合采用原始改写和产品边界适配；参考仓库为 MIT 许可证。

## 为什么不创建 57 个顶层 Skill

57 个常驻元数据会重新引入用户最初指出的干扰问题，而且大量入口会在 `logo-creator` / `logo-generator` / `logo-branding`、`interior-design` / `interior-design-visualizer`、`ugc-video-factory` / `ugc-ads-workflow` 等近义场景上竞争触发。

本轮保持六个稳定入口，并把场景知识放在一层 references 中：

```text
develop-creative-concept
operate-content-workflow
direct-image-creation
direct-video-creation
review-content-quality
create-content-campaign
  -> task-shaped references loaded only for the selected scenario
```

这样模型先命中任务领域，再只读取一份或少量场景协议；工具面仍只有 `inspect`、`edit`、`run`。

## 全局能力融合

| 来源能力 | Vetta 实施 |
| --- | --- |
| Director Brief 与镜头语言 | 视频 `reference-role-and-timed-directing.md`，并复用现有 camera/light/sound 与 shot-card references |
| 多素材 `@image/@video/@audio` 分工 | 转成 capability 驱动的 reference manifest；不假设固定槽位或数量 |
| 时间段提示与单动作纪律 | 写入 timed directing、表演、动作、教程和质量 gate |
| 先便宜候选、用户选定、再昂贵生产 | Campaign stage gates、产品广告、品牌系统和 UGC 配方 |
| 并行 fan-out | 只在共享 authority 已通过且分支独立时并行 |
| 失败回退 | 保留成功上游、按 causal layer 修复、提供 still/plan/external-step fallback |
| 工作流发现、输入收集、执行和轮询 | `operate-content-workflow/references/workflow-discovery-and-execution.md` |
| 场景完成条件 | `review-content-quality/references/scenario-gates.md` |

## Edit 与 Workflow 映射

| Library Skill | 提取的能力 | Vetta 落点 |
| --- | --- | --- |
| `edit/ai-clipping` | 转录后候选跨度、8 类传播价值评分、重叠去重、平台裁切、少于目标数不补水 | 视频 `camera-social-and-clipping-video-recipes.md` + 质量 `scenario-gates.md` |
| `workflow` | 先发现/检查工作流、读取必填输入、复用或新建、确认、执行、监控、输出 | 操作 `workflow-discovery-and-execution.md`；以 Vetta 三工具和 revision/confirmation 合同替换 MuAPI CLI/MCP |

## Motion Skill 逐项映射

| Library Skill | 保留的场景机制 | Vetta 落点 |
| --- | --- | --- |
| `3d-logo-animation` | 先审核立体静帧，再做材质光扫/旋转并保留结尾 logo hold | `product-brand-and-logo-video-recipes.md` |
| `ai-fight-scene` | 人物 authority + 环境地理 + 16 格高剪辑密度分镜 + 先重试视频层 | `narrative-action-and-tutorial-video-recipes.md` |
| `animal-video-generator` | 先建立拟人角色，后做自拍式单人表演、对白和环境声 | `character-performance-and-ugc-video-recipes.md` |
| `award-ceremony-video` | winner/host 严格角色顺序、时间码事件链、姓名同时进入对白与屏幕 | `character-performance-and-ugc-video-recipes.md` |
| `cartoon-dance-animation` | 身份/服装风格化静帧 + 动作参考单独控制 choreography | `character-performance-and-ugc-video-recipes.md` |
| `character-story-video` | 中性角色锚点、顺序场景静帧、逐场动画、timeline 合成 | `narrative-action-and-tutorial-video-recipes.md` |
| `cinema-director` | 情绪到景别/运动/光线的映射、物理可执行相机、避免冲突运动 | 现有 `camera-light-sound-vocabulary.md` + `reference-role-and-timed-directing.md` |
| `drone-style-video` | reveal/orbit/flyover/top-down 四类路径及明确到达点 | `camera-social-and-clipping-video-recipes.md` |
| `freeze-effect-video` | 正常运动 -> 触发 -> 静止/静音 -> 主角证明 -> 恢复后果的音画弧 | `character-performance-and-ugc-video-recipes.md` |
| `giant-product-showcase` | 先证明尺度/接触/透视的静帧，再用相机运动强化尺度 | `product-brand-and-logo-video-recipes.md` |
| `jewelry-product-video` | hero + macro 分工、慢速镜头、材质/镶嵌/高光连续性 | `product-brand-and-logo-video-recipes.md` |
| `music-video` | keyframe 与音乐规划并行、镜头按节拍角色组织、连续性重复 | `narrative-action-and-tutorial-video-recipes.md` |
| `one-shot-video` | 可画出的连续路径、无冲突相机、内部节奏点、明确终点 | `camera-social-and-clipping-video-recipes.md` |
| `product-ad-cinematic` | 四个低成本 hero 候选、人工选片、再 upscale/animate/audio、静帧 fallback | `product-brand-and-logo-video-recipes.md` + Campaign gates |
| `product-showcase-video` | 商品 authority + 配料/组件爆炸静帧 + 单一分离/环绕/重组运动 | `product-brand-and-logo-video-recipes.md` |
| `product-video-ad-maker` | 商品重新布景静帧审核后，才做受控相机和环境微运动 | `product-brand-and-logo-video-recipes.md` |
| `seedance-2` | 引用角色表、Director Brief 顺序、时间码、原生音频、首尾帧、编辑/续写模式 | `reference-role-and-timed-directing.md`；所有模式都先 capability gate |
| `storyboard-to-cooking-video` | 原始人物锁身份 + 复合制作板锁环境/动作的双 authority | `narrative-action-and-tutorial-video-recipes.md` |
| `talking-baby-video` | 角色静帧审核、短对白、视线/表情/头部动作、lipsync fallback | `character-performance-and-ugc-video-recipes.md` |
| `ugc-lifestyle-try-on` | 先合身/使用证明，再做自然 UGC context，最后可交接视频 | 图片 `identity-fashion-and-social-effect-recipes.md` |
| `ugc-video-factory` | person + product 合成 hero、审批、短对白单镜头动画 | `character-performance-and-ugc-video-recipes.md` |

## Social Skill 逐项映射

| Library Skill | 保留的场景机制 | Vetta 落点 |
| --- | --- | --- |
| `instagram-post` | 两秒信息、单焦点 hero、caption 的 hook/body/CTA 结构 | 图片 `brand-and-publishing-recipes.md` |
| `product-campaign` | 共用商品与视觉 DNA 的 hero、视频和平台衍生 | Campaign `recipe-catalog.md` + `scenario-composition.md` |
| `rednote-cover` | 移动端生活方式证据、主题层级、文字安全区与多图扩展 | 图片 `brand-and-publishing-recipes.md` |
| `social-media-video` | 读取 brand/ICP/messaging、写 copy/storyboard、转换 Director Brief、平台审核 | 视频 `camera-social-and-clipping-video-recipes.md` |
| `social-pack` | 从一个已批准 master fan-out，但按平台重构层级而非盲裁 | Campaign `scenario-composition.md` + 图片 publishing recipe |
| `ugc-ads-workflow` | 双图合成、核实卖点、时间码脚本、动作与台词分离 | 视频 `character-performance-and-ugc-video-recipes.md` |
| `youtube-shorts` | 平台参数是 clipping 的薄 preset，复用排序、去重、裁切和完成条件 | 视频 `camera-social-and-clipping-video-recipes.md` |

## Visual Skill 逐项映射

| Library Skill | 保留的场景机制 | Vetta 落点 |
| --- | --- | --- |
| `action-figure-generator` | 身份、玩具比例/材质、服装主题、配件和包装分层 | `identity-fashion-and-social-effect-recipes.md` |
| `ad-creative` | 固定 offer/受众/品牌，按 persuasion hypothesis 生成并先选 copy 方向 | `brand-and-publishing-recipes.md` + Campaign |
| `amazon-product-listing` | 主图、生活方式、功能图、细节图各有明确 listing job | `commerce-product-and-spatial-recipes.md` |
| `blog-header` | 从文章论点提炼非陈词滥调的视觉隐喻、留标题区、交付 alt text | `brand-and-publishing-recipes.md` |
| `brand-kit` | logo 候选、色彩角色、字体角色、纹理/应用，组成一个系统 | `brand-and-publishing-recipes.md` |
| `brochures` | 先做内容架构和共享网格，再做 cover/inside/back，缺内容用占位而非造事实 | `brand-and-publishing-recipes.md` |
| `chibi-collage-effect` | 原图保持摄影真实，mini clone 从场景推断动作，保护人物主体区 | `identity-fashion-and-social-effect-recipes.md` |
| `color-analysis-board` | 编辑板的固定信息区和高分辨率布局，同时增加非测量结论免责声明 | `identity-fashion-and-social-effect-recipes.md` |
| `couple-grid-creator` | 双人分别建立 ledger，每格分配姿态/服装，逐格检查双身份 | `identity-fashion-and-social-effect-recipes.md` |
| `design-guide` | palette/type/UI/application 四类 proof 和书面 token/do-don't | `brand-and-publishing-recipes.md` |
| `fashion-try-on` | person 和 garment 分别锁定，先 fit proof，再可选运动 | `identity-fashion-and-social-effect-recipes.md` |
| `floor-plan-rendering` | 平面图作为结构 authority，3D 只改材质/家具/光，不改邻接和开口 | `commerce-product-and-spatial-recipes.md` |
| `interior-design-visualizer` | 无底图时先审批空房壳体，再做家具/风格层 | `commerce-product-and-spatial-recipes.md` |
| `interior-design` | 有底图时 Preserve/Change 合同，检查结构、尺度、动线 | `commerce-product-and-spatial-recipes.md` |
| `keyboard-art-maker` | literal string、换行/间距、正交构图、逐字符验收 | `interface-storyboard-and-layout-recipes.md` |
| `logo-branding` | 三种 logo 假设、选定后才扩展变体和应用 | `brand-and-publishing-recipes.md` + Campaign |
| `logo-creator` | 几何原语、负空间、小尺寸、单色、禁止 mockup 干扰选片 | `brand-and-publishing-recipes.md` |
| `logo-generator` | 单一快速 logo 的精简路径和拼写 gate | `brand-and-publishing-recipes.md` |
| `multi-angle-reshoot` | 不同相机角色、保持人物/服装/环境，未见区域视为创意重建 | `identity-fashion-and-social-effect-recipes.md` |
| `multi-angle-shots` | front/3-4/back/top/hero 分工和品类专属额外角度 | `commerce-product-and-spatial-recipes.md` |
| `nano-banana` | Subject/Action/Context/Composition/Lighting 的关系式 prompt、拒绝 keyword soup | 现有 `prompt-framework.md` / `model-prompt-profiles.md`，场景手册继续使用该结构 |
| `photo-pack-generator` | vision-first 但不重新文字描述身份、identity-first、逐张拒绝 drift | `identity-fashion-and-social-effect-recipes.md` |
| `selfie-with-celebrities` | 用户身份/服装/手机透视保持、共享光影与遮挡、连接视频的首尾帧思路 | `identity-fashion-and-social-effect-recipes.md` + 视频 timed directing |
| `storyboard` | premise 拆成完整 arc、并行关键帧、逐帧重复 continuity block | `interface-storyboard-and-layout-recipes.md` |
| `ui-design` | 从用户状态/组件/设计 token/可访问性出发，输出纯界面而非桌面设备照 | `interface-storyboard-and-layout-recipes.md` |
| `url-to-design` | 先检查真实页面/截图，桌面和移动端共享同一内容组件合同 | `interface-storyboard-and-layout-recipes.md` |
| `youtube-thumbnail` | 把标题转成可见 tension、最多两个焦点、3-5 词、缩略尺寸验收 | `brand-and-publishing-recipes.md` |

## 没有直接搬入的内容

- `muapi` 命令、MCP 工具、API key、endpoint 和轮询脚本。
- 写死的模型路由、tier、价格、时长、比例、参考数量和审查规则。
- 将 raster logo 称为矢量、将 AI floor plan 称为施工图、将 personal color board 称为测量结果等过度承诺。
- 无条件读取网页或用搜索结果生成广告卖点；Vetta 必须有可信来源并把未核实 claim 留给用户审批。
- 当前三工具和节点 schema 无法执行的自动转录、人脸跟踪、视频水印移除、训练角色等操作。相应 Skill 只保留可检查的计划和 capability gate。

## 新增文件结构

```text
agent/skills/
  direct-image-creation/references/
    scenario-routing.md
    brand-and-publishing-recipes.md
    commerce-product-and-spatial-recipes.md
    identity-fashion-and-social-effect-recipes.md
    interface-storyboard-and-layout-recipes.md
  direct-video-creation/references/
    scenario-routing.md
    reference-role-and-timed-directing.md
    product-brand-and-logo-video-recipes.md
    character-performance-and-ugc-video-recipes.md
    narrative-action-and-tutorial-video-recipes.md
    camera-social-and-clipping-video-recipes.md
  create-content-campaign/references/scenario-composition.md
  operate-content-workflow/references/workflow-discovery-and-execution.md
  review-content-quality/references/scenario-gates.md
```

## 后续边界

这轮增强的是模型的判断和工作流设计能力，不等于 Vetta 已经拥有参考项目中的全部执行器。若要让长视频自动切片、精确 motion transfer、角色训练或 Provider 原生 extension 直接运行，还需要在 capability registry、Provider adapter、领域 schema 和测试中实现对应合同；在此之前 Skill 必须诚实地产出计划、可执行上游和外部步骤说明。

