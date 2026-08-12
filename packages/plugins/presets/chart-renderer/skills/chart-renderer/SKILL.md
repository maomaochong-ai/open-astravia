---
name: chart-renderer
description: 创建适用于图表渲染插件的 Chart.js 图表。当用户要求把数据做成图表、可视化趋势、比较分类或展示占比时使用。
---

# Chart.js 图表渲染

## 目标

把用户提供的数据整理成一次 `render_chart` 工具调用，让图表出现在当前 MessageList 消息下方。不要只输出 Markdown 表格来替代图表。

## 工具参数

必须传：

- `type`: `line`、`bar`、`pie`、`doughnut`、`polarArea`、`radar`、`scatter` 或 `bubble`
- `data`: 标准 Chart.js data 对象

可选传：

- `options`: 标准 Chart.js options 对象
- `title`: 简短中文标题
- `description`: 一句话说明统计口径或时间范围
- `height`: 180 到 560 之间的数字，默认 300
- `charts`: 可选的图表数组，最多 4 个；使用 `charts` 时每一项都必须包含自己的 `type` 和 `data`

优先使用一次 `render_chart` 调用中的 `charts` 数组生成多图表。单图表也可以继续直接传 `type` 和 `data`，以兼容旧调用。

如果用户同一轮需要多个图表，必须尽量合并到一次工具调用中，不要连续调用多次 `render_chart`。最多 4 个图表，超过 4 个时按用户最重要的指标合并或分批，并先说明限制。

## 布局规则

- 每个图表都占满整行宽度，单列自上而下排列，顺序即传入顺序
- 不要为了排版重复图表
- 多个指标需要分别展示时，使用一个 `charts` 数组调用，不要连续调用工具

## 数据格式

分类图表使用：

```json
{
  "labels": ["一月", "二月", "三月"],
  "datasets": [
    {
      "label": "销售额",
      "data": [120, 180, 240],
      "backgroundColor": "#2563eb",
      "borderColor": "#2563eb"
    }
  ]
}
```

折线图和柱状图可以有多个 datasets。饼图和环形图通常使用一个 dataset：

```json
{
  "labels": ["华东", "华南", "华北"],
  "datasets": [{
    "label": "订单占比",
    "data": [45, 30, 25],
    "backgroundColor": ["#2563eb", "#16a34a", "#f59e0b"]
  }]
}
```

## 选择图表类型

- 时间趋势：`line`
- 分类对比：`bar`
- 构成占比：`doughnut` 或 `pie`
- 多维指标：`radar`
- 两个数值变量关系：`scatter`
- 三个数值变量关系：`bubble`

## 约束

1. 只传 JSON 可序列化值，不传函数、Date、undefined、DOM 节点或自定义类实例。
2. `charts` 数量必须在 1 到 4 之间；每个图表都必须有合法的 `type` 和 `data`。
3. `labels` 和 `datasets[].data` 的长度应一致；不要混用中文标签和缺失数据。
4. 数值缺失时使用 `null`，不要使用 NaN 或字符串数字。
5. 工具调用失败时，读取返回的 `error` 和 `retryable` 字段，立即修正参数并重试一次；不要结束当前任务。
6. 多图表需求只调用一次工具，使用 `charts` 数组，不要为每个图表分别调用工具。
7. 如果用户没有提供足够数据，先说明缺少哪些字段，不要编造数值。
