# 内容创作（content-creation）

Vetta 的系统 preset 插件，用节点画布组织提示词、素材生成与处理流程，并通过可扩展编排工作区完成内容创作。
图片与视频是首批内容能力，不作为插件的产品边界。

## 当前范围

- 创作画布：提示词、图片生成、视频生成、素材、输出节点。
- 编排工作区：首批提供视频轨、音频轨、片段添加、移动和裁剪的领域协议。
- 项目存储：语义化 schema v4 文档写入 `<cwd>/content-creation.json`；画布布局单独放在 `view`，jobs、宿主任务句柄与临时状态保留在插件私有存储，renderer 刷新后会恢复活跃宿主任务；无工作目录时整体回退到插件私有存储。
- Agent：可打开画布，按项目/运行时/能力/诊断读取语义状态，自动布局并批量修改工作流；删除类操作先以对话卡片预览并由用户确认，生成计划也需确认后才会执行。
- Agent Skill：内置工作流操作与高质量视频创作两个 Skill，分别约束安全操作流程和视频提示词、参考素材、模型能力与质量检查方法。
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
当前模型能力和可执行诊断。非破坏性修改可携带 `expectedRevision` 直接提交；删除节点或连接必须先生成
一次性预览令牌并在对话卡片确认，若期间项目版本变化则拒绝提交。图片/视频生成通过依赖排序的运行计划
执行，准备阶段不调用供应商、不消耗生成额度。

## 设计分析

下一阶段的画布、节点、操作面板、模型注册和生成任务设计，以 [docs/README.md](./docs/README.md) 为分析入口。该目录分别记录 Open-AI Canvas、TwitCanva、Nodetool 和 Loomic 的参考结论；时间线暂不在本轮分析范围内。
