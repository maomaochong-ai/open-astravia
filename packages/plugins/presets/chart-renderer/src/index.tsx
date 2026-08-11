import { definePlugin } from "@vetta-org/plugin-sdk";
import "./style.css";
import { ToolChartSlot } from "./ToolChartSlot";

export const CHART_CARD_TYPE = "chart-renderer.chart";

const CHART_TYPES = ["line", "bar", "pie", "doughnut", "polarArea", "radar", "scatter", "bubble"] as const;

const parameters = {
	type: "object",
	properties: {
		type: { type: "string", enum: CHART_TYPES, description: "Chart.js chart type（单图表：与 data 一起传）" },
		data: {
			type: "object",
			description: "标准 Chart.js data 对象，包含 labels 和 datasets（单图表：与 type 一起传）",
		},
		options: { type: "object", description: "可选的标准 Chart.js options 对象" },
		title: { type: "string", description: "图表标题" },
		description: { type: "string", description: "图表说明" },
		height: { type: "number", description: "单图表高度（像素），建议 220-520" },
		charts: {
			type: "array",
			minItems: 1,
			maxItems: 4,
			description:
				"多图表：最多 4 个，每项包含 type、data 和可选 options/title/description/height。单图表则改传顶层 type + data，两种形式必须且只能用其一。",
			items: {
				type: "object",
				properties: {
					type: { type: "string", enum: CHART_TYPES },
					data: { type: "object" },
					options: { type: "object" },
					title: { type: "string" },
					description: { type: "string" },
					height: { type: "number" },
				},
				required: ["type", "data"],
				additionalProperties: false,
			},
		},
	},
	// 「单图表 type+data」与「多图表 charts」的二选一只写进 description，不用顶层 anyOf：
	// Gemini 把每个 anyOf 分支当独立 Schema 校验，裸 { required: [...] }（无 type/properties）
	// 会让整轮请求 400，一个工具就能废掉整个会话。约束由下面的 handler 兜底并 retryable 返回。
	additionalProperties: false,
};

type SingleChart = {
	type: (typeof CHART_TYPES)[number];
	data: Record<string, unknown>;
	options?: Record<string, unknown>;
	title?: string;
	description?: string;
	height?: number;
};
type ChartInput = SingleChart & { charts?: SingleChart[] };

export default definePlugin({
	activate(ctx) {
		ctx.ui.registerToolCallSlot({
			id: "render-chart-tool-ui",
			toolName: "render_chart",
			component: ToolChartSlot,
		});

		ctx.agent.registerTool<ChartInput>({
			id: "chart-renderer",
			name: "render_chart",
			label: "渲染图表",
			description:
				"在当前对话消息下方渲染一个交互式 Chart.js 图表。传入标准 Chart.js data；不要用 Markdown 表格代替图表。",
			parameters,
			timeoutMs: 10_000,
			scope_use: ["conversation", "project"],
			handler: async ({ trigger: { input } }) => {
				try {
					const charts = input?.charts ?? (input?.data ? [input] : []);
					if (
						charts.length < 1 ||
						charts.length > 4 ||
						charts.some((chart) => !chart.data || typeof chart.data !== "object")
					) {
						return {
							ok: false,
							retryable: true,
							error: "图表数量必须为 1 到 4 个，且每个图表都必须包含 data。请按 chart-renderer skill 的格式重试。",
						};
					}
					const normalized = charts.map((chart) => ({
						...chart,
						height: Math.max(180, Math.min(560, Math.round(chart.height ?? 300))),
					}));
					return {
						ok: true,
						rendered: true,
						chartCount: normalized.length,
						summary: `已渲染 ${normalized.length} 个图表。`,
						cards: [],
					};
				} catch (error) {
					ctx.ui.notify({ message: ctx.i18n.t("error.renderFailed"), error });
					return { ok: false, retryable: true, error: error instanceof Error ? error.message : String(error) };
				}
			},
		});
	},
});
