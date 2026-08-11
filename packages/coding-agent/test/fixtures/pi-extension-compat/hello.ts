// @ts-expect-error Resolved by the explicit Pi compatibility loader facade.
import { Type } from "@earendil-works/pi-ai";
// @ts-expect-error Resolved by the explicit Pi compatibility loader facade.
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const hello = defineTool({
	name: "pi_hello",
	label: "Pi Hello",
	description: "Greet a person",
	parameters: Type.Object({ name: Type.String({ minLength: 1 }) }),
	promptSnippet: "Greet a known person by name.",
	promptGuidelines: ["Trim surrounding whitespace from names."],
	prepareArguments(input: unknown) {
		if (typeof input !== "object" || input === null) return input;
		return { name: String(Reflect.get(input, "name")).trim() };
	},
	executionMode: "sequential" as const,
	renderCall() {
		return undefined;
	},
	async execute(_toolCallId: string, params: { name: string }) {
		return {
			content: [{ type: "text" as const, text: `Hello, ${params.name}!` }],
			details: { greeted: params.name },
		};
	},
});

export default function (api: ExtensionAPI) {
	api.registerTool(hello);
	api.on("agent_end", () => {});
	api.registerShortcut("ctrl+x", { handler() {} });
}
