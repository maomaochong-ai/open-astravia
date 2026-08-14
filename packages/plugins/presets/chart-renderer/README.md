# 图表渲染（chart-renderer）

随 Vetta Desktop 发布的**系统插件**。Agent 调用 `render_chart` 工具传入标准
Chart.js `type` / `data`（或 `charts` 数组，最多 4 个），图表以卡片形式渲染在
当前工具调用下方（`ui.slot.tool-call`）。

- 随插件打包一个 `chart-renderer` skill（`skills/`），约束 Agent 的调用格式与图表选型。
- 文案走插件 i18n（`locales/zh.json`、`locales/en.json`，ADR-0033）；工具 name /
  description 面向 LLM，保持原文。

## 构建

从仓库根安装依赖，再在本目录构建：

```bash
cd ../../../..
bun install
cd packages/plugins/presets/chart-renderer
bun run build   # 生成 dist/ 与 release/chart-renderer-<version>.zip
```

Desktop 开发与打包消费该 zip：在 `packages/desktop-app` 执行
`bun run build:presets` 校验并解压到开发 staging 目录。
