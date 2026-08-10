import type { PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import type { ContentCreationAgentService } from "../src/agent/service";
import {
	CONTENT_EDIT_TOOL_NAME,
	CONTENT_INSPECT_TOOL_NAME,
	CONTENT_RUN_TOOL_NAME,
	registerContentCreationTools,
} from "../src/plugin/register-tools";

describe("content creation tool registration", () => {
	it("registers only the three domain tools", () => {
		const registered: Array<{ name: string }> = [];
		const ctx = {
			agent: {
				registerTool: (tool: { name: string }) => registered.push(tool),
			},
		} as unknown as PluginContext;

		registerContentCreationTools(ctx, {} as ContentCreationAgentService);

		expect(registered.map((tool) => tool.name)).toEqual([
			CONTENT_INSPECT_TOOL_NAME,
			CONTENT_EDIT_TOOL_NAME,
			CONTENT_RUN_TOOL_NAME,
		]);
	});
});
