# 内容创作（content-creation）

Vetta 的系统 preset 插件，用节点画布组织提示词、素材生成与处理流程，并通过可扩展编排工作区完成内容创作。
图片与视频是首批内容能力，不作为插件的产品边界。

## 当前范围

- 创作画布：提示词、图片生成、视频生成、素材、输出节点。
- 编排工作区：首批提供视频轨、音频轨、片段添加、移动和裁剪的领域协议。
- 项目存储：写入 `<cwd>/.vetta/content-creation/project.json`，带 schemaVersion 与 revision；无工作目录时回退到插件私有存储。
- Agent：打开画布、读取状态、批量应用结构化操作。
- 内容生产与导出：本阶段仅预留 Asset、GenerationJob 和 Provider/Renderer 边界，不调用真实服务。

## 架构边界

```text
React UI ─┐
          ├─ ContentCreationWorkspace ─ Command reducer ─ ProjectRepository
Agent ────┘
```

UI 与 Agent 都只能通过 `ContentCreationWorkspace.dispatch()` 修改项目。领域命令保持纯函数，
供应商适配、内容处理和导出渲染将在后续阶段作为独立模块接入，不进入组件。

## 设计分析

下一阶段的画布、节点、操作面板、模型注册和生成任务设计，以 [docs/README.md](./docs/README.md) 为分析入口。该目录分别记录 Open-AI Canvas、TwitCanva、Nodetool 和 Loomic 的参考结论；时间线暂不在本轮分析范围内。
