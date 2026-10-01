import { definePlugin } from "@astravia-org/plugin-sdk";
import { CanvasPanel } from "./CanvasPanel";
import { setPluginContext } from "./pluginContext";
import "./style.css";

const TAB_ID = "canvas";
const OPEN_TOOL_ID = "open_cowart_canvas";

function CanvasIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<title>Cowart</title>
			<path
				d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<path
				d="M8 14.5 10.5 11l2 2.5L15.5 9 18 14.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx="9" cy="9" r="1.2" fill="currentColor" />
		</svg>
	);
}

export default definePlugin({
	activate(ctx) {
		setPluginContext(ctx);

		ctx.ui.registerActivityTab({
			id: TAB_ID,
			label: "%tab.label%",
			icon: <CanvasIcon className="h-4 w-4" />,
			component: CanvasPanel,
			scope_use: ["project", "conversation"],
		});

		ctx.agent.registerTool<{ projectDir?: string }>({
			id: OPEN_TOOL_ID,
			name: OPEN_TOOL_ID,
			label: "Open Cowart canvas",
			description:
				"Open the Cowart infinite-canvas (tldraw) activity panel in Astravia Desktop. Use when the user asks to open, launch, or show the Cowart canvas / infinite canvas. Pass the user project directory as projectDir when known; never the plugin install path. Canvas data lives under <projectDir>/canvas. Agent-side IO also uses Cowart MCP tools (get_cowart_canvas_state, insert_cowart_image, …).",
			scope_use: ["project", "conversation"],
			parameters: {
				type: "object",
				properties: {
					projectDir: {
						type: "string",
						description: "Optional absolute project directory. Defaults to the active conversation cwd.",
					},
				},
			},
			handler: async ({ trigger }) => {
				ctx.ui.openActivityTab(TAB_ID, { width: "max" });
				const projectDir = trigger.input?.projectDir?.trim() || null;
				return {
					ok: true,
					opened: "activity-tab:cowart-astravia:canvas",
					projectDir,
					hint: "Cowart tldraw canvas is open in the activity panel. UI persists via Astravia fs bridge to project/canvas; agent tools use plugin-scoped MCP.",
				};
			},
		});
	},
});
