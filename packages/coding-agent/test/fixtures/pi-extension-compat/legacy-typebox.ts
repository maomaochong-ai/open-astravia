// @ts-expect-error Resolved by the explicit Pi compatibility loader facade.
import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (api: ExtensionAPI) {
	api.registerTool(
		defineTool({
			name: "legacy_schema",
			label: "Legacy Schema",
			description: "Verify the legacy TypeBox specifier facade",
			parameters: Type.Object({ count: Type.Number({ minimum: 1 }) }),
			async execute(_toolCallId: string, params: { count: number }) {
				return { content: [{ type: "text" as const, text: String(params.count) }], details: undefined };
			},
		}),
	);
}
