import { describe, expect, it } from "vitest";
import {
	CODING_TOOL_SCOPES,
	createNodeCodingToolEnvironment,
	selectCodingToolsForScope,
} from "../../src/coding/index.js";

/**
 * A tool description that routes the model to another tool is only useful when that tool is
 * actually on the request. A dangling reference — a name left behind after the target's scope
 * list emptied — spends tokens teaching a tool the model cannot see and invites a call that
 * can only fail, which is exactly the drift this guard exists to catch.
 */
describe("coding tool description references", () => {
	const environment = createNodeCodingToolEnvironment({
		cwd: process.cwd(),
		commandExecutor: { execute: async () => ({ content: [{ type: "text", text: "" }] }) },
		executableResolver: { resolve: async () => undefined },
		editPathPolicy: { getRejectionReason: () => undefined },
		writePathPolicy: { getRejectionReason: () => undefined },
	});
	const everyToolName = environment.registrations.map(({ tool }) => tool.name);

	it.each([...CODING_TOOL_SCOPES])("only references tools that are visible in scope %s", (scope) => {
		const visible = selectCodingToolsForScope(environment.registrations, scope);
		const visibleNames = new Set(visible.map(({ name }) => name));
		const dangling: string[] = [];

		for (const tool of visible) {
			for (const candidate of everyToolName) {
				if (visibleNames.has(candidate)) continue;
				// Only a backtick-quoted mention is a routing instruction; prose that happens to
				// contain the word (for example "find" in an English sentence) is not.
				if (tool.description.includes(`\`${candidate}\``)) {
					dangling.push(`${tool.name} -> ${candidate}`);
				}
			}
		}

		expect(dangling).toEqual([]);
	});
});
