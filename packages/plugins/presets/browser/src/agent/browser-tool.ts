import type { PluginContext } from "@vetta-org/plugin-sdk";
import { BrowserSessionBroker, type BrowserToolInput } from "./browser-session-broker";

export const BROWSER_TOOL_NAME = "browser_operate";

const profileId = {
	type: "string",
	pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$",
	description: "Stable account/profile id. Use a different id for each media account; defaults to default.",
};

const action = {
	oneOf: [
		{ type: "object", properties: { type: { const: "click" }, target: { type: "string" } }, required: ["type", "target"] },
		{
			type: "object",
			properties: { type: { enum: ["fill", "type", "select"] }, target: { type: "string" }, value: { type: "string" } },
			required: ["type", "target", "value"],
		},
		{
			type: "object",
			properties: { type: { const: "check" }, target: { type: "string" }, checked: { type: "boolean" } },
			required: ["type", "target", "checked"],
		},
		{ type: "object", properties: { type: { const: "press" }, key: { type: "string" } }, required: ["type", "key"] },
		{
			type: "object",
			properties: {
				type: { const: "scroll" },
				direction: { enum: ["up", "down", "left", "right"] },
				amount: { type: "integer", minimum: 1, maximum: 100000 },
			},
			required: ["type", "direction"],
		},
		{
			type: "object",
			properties: {
				type: { const: "wait" },
				milliseconds: { type: "integer", minimum: 0, maximum: 120000 },
				target: { type: "string" },
			},
			required: ["type"],
		},
		{ type: "object", properties: { type: { enum: ["back", "reload"] } }, required: ["type"] },
	],
};

const parameters = {
	type: "object",
	properties: {
		operation: { enum: ["status", "navigate", "snapshot", "read_text", "act", "close"] },
		profileId,
		url: { type: "string", description: "URL for navigate." },
		interactiveOnly: { type: "boolean" },
		maxChars: { type: "integer", minimum: 1, maximum: 1000000 },
		action,
		snapshotRevision: { type: "integer", minimum: 0 },
	},
	required: ["operation"],
	additionalProperties: false,
} as const;

export function registerBrowserTool(ctx: PluginContext, broker: BrowserSessionBroker): void {
	ctx.agent.registerTool<BrowserToolInput>({
		id: "browser-operate",
		name: BROWSER_TOOL_NAME,
		label: "%tool.browserOperate%",
		description:
			"Operate a real browser through a host-governed session. Use for pages that require interaction or login. " +
			"Use a stable profileId per account, take a snapshot before acting, pass snapshotRevision for element actions, " +
			"and ask the user before irreversible actions such as publishing, submitting, deleting, purchasing, or sending. " +
			"Do not use for ordinary public-web lookup when web search is sufficient.",
		parameters,
		timeoutMs: 180_000,
		scope_use: ["conversation", "project", "im-claw", "cli"],
		side_effect: "heavy",
		configuration: {},
		handler: ({ plugin, trigger }) => broker.execute(trigger.input, plugin.settings),
	});
}
