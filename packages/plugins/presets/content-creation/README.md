# 内容创作（content-creation）

Vetta 的系统 preset 插件，用节点画布组织提示词、素材生成与处理流程，并通过可扩展编排工作区完成内容创作。
图片与视频是首批内容能力，不作为插件的产品边界。

## 当前范围

- 创作画布：提示词、图片生成、视频生成、素材、输出节点。
- 编排工作区：首批提供视频轨、音频轨、片段添加、移动和裁剪的领域协议。
- 项目存储：语义化 schema v6 文档写入 `<cwd>/content-creation.json`；视频媒体输入统一保存为带业务角色的 `mediaSources`（首帧、尾帧、参考图片、参考视频或参考音频），画布布局及其用户/自动所有权单独放在 `view`，jobs、宿主任务句柄、最多 100 个领域历史快照与临时状态保留在插件私有存储，renderer 刷新后会恢复活跃宿主任务与兼容的撤销/重做历史；无工作目录时整体回退到插件私有存储。
- Agent：插件启用后贡献内容创作 Prompt、Skill 与 `inspect`、`assets`、`edit`、`run` 四个领域工具；输入栏不再提供“内容创作”开关，动态路由按当前意图收窄工具面。`assets` 将宿主已授权路径中的本地媒体复制进受管素材存储并返回稳定节点/素材 ID；创建、编辑、删除、导入与连线均不要求用户确认，生成计划在全局弹窗确认后才会执行。
- Agent Skill：内置创意概念、工作流操作、图片创作、视频创作、内容质量审查和多资产 Campaign 六个 Skill；运行时依据最近的用户意图确定性加载对应 Skill 正文与必要参考资料，不再依赖模型主动发现。高层 `configure_video_shot` 会从明确的开场、结尾和参考控制需求选择文生视频、单图动画、首尾帧、全能参考或视频转换；首尾帧分别使用静态 `image-keyframe` 计划，全能参考使用带别名、语义角色和指令的素材清单，均不会静默退化为单图动画。
- 内容生产：支持 OpenAI Images、Replicate、Gemini/Veo 与 NewAPI 视频适配器；用户导入素材保存在插件私有素材存储中，生成素材写入工作区 `output/`。
- 导出：本阶段仅预留 Renderer 边界。

## 架构边界

```text
React UI ─┐
          ├─ ContentCreationWorkspace ─ Command reducer ─ ProjectRepository
Agent ─ Agent service ─┘
```

UI 与 Agent 都只能通过 `ContentCreationWorkspace.dispatch()` 修改项目。领域命令保持纯函数，
供应商适配与素材存储位于独立 generation 模块，不进入组件；导出渲染将在后续阶段接入。

Agent 返回的是去除画布视图、时间戳、预览 URL 和私有存储 ID 的语义文档，同时补充节点/任务状态、
当前可用模型能力、语义连接、连通分量、孤立节点、可运行/阻塞节点和可执行诊断。`content_creation_edit`
携带 `expectedRevision` 原子提交完整批次。每类 operation 使用独立的判别式 Schema；普通拓扑边统一使用
`sourceNodeId`、`targetNodeId`、可选 `edgeId` 和语义 `targetInput`。Agent 视频媒体输入由 `configure_video_shot`
唯一拥有并编译为模型实际支持的模式与输入角色；低层 `configure_generation` 仅用于兼容和角色修复，失败会返回稳定错误代码和能力上下文。
本地文件或目录必须先经 `content_creation_assets` 发现并导入；工作流只保存受管 `blobId`，不保存外部绝对路径。目录默认要求 Agent 明确选择一个文件，批量场景才显式使用 `directoryMode="all"`。
图片/视频生成通过依赖排序的运行计划执行，准备阶段不调用供应商、不消耗生成额度，并通过插件全局弹窗授权运行。
Agent 只提交语义节点和连接，不接触画布坐标；编辑服务会在完整批次上执行确定性的增量拓扑布局，优先保留用户节点，只整理新增节点、自动节点及空间不足时必要的下游走廊。
UI 与 Agent 的每次原子领域编辑共用同一个撤销边界；撤销/重做会创建新的单调 revision。生成任务进度、任务结果与外部文件不进入普通历史，历史恢复也不会取消或移除活动生成任务。
`inspect` 同时返回每个视频节点当前实际采用的生成策略与来源角色，并诊断首尾帧复用提示词、关键帧误用视频提示词、全能参考缺少语义清单以及已连接 Prompt 被本地文本遮蔽等方法问题。高层视频配置会把动态 Prompt 节点内容与编译后的导演计划显式组合，保证画布连接和实际请求一致。

## 设计分析

下一阶段的画布、节点、操作面板、模型注册和生成任务设计，以 [docs/README.md](./docs/README.md) 为分析入口。该目录分别记录 Open-AI Canvas、TwitCanva、Nodetool 和 Loomic 的参考结论；时间线暂不在本轮分析范围内。
