import { createNodeCodingToolEnvironment } from "@vetta/runtime-node/coding";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_SCENARIOS } from "../../src/profiles/index.js";
import { selectCodingAgentToolRegistrations } from "../../src/runtime-contracts/index.js";
import { declareCodingAgentPlatformTools } from "../../src/tool-policy/platform-tool-declarations.js";

describe("Coding Agent tool description references", () => {
	const environment = createNodeCodingToolEnvironment({
		cwd: process.cwd(),
		commandExecutor: { execute: async () => ({ content: [{ type: "text", text: "" }] }) },
		executableResolver: { resolve: async () => undefined },
		editPathPolicy: { getRejectionReason: () => undefined },
		writePathPolicy: { getRejectionReason: () => undefined },
	});
	const declarations = declareCodingAgentPlatformTools(environment.registrations);
	const everyToolName = declarations.map(({ tool }) => tool.name);

	afterAll(() => environment.dispose());

	it.each([...ALL_SCENARIOS])("only references tools that are visible in scenario %s", (scenario) => {
		const visible = selectCodingAgentToolRegistrations(declarations, { mode: "scope", scope: scenario });
		const visibleNames = new Set(visible.map(({ tool }) => tool.name));
		const dangling: string[] = [];

		for (const { tool } of visible) {
			for (const candidate of everyToolName) {
				if (visibleNames.has(candidate)) continue;
				if (tool.description.includes(`\`${candidate}\``)) {
					dangling.push(`${tool.name} -> ${candidate}`);
				}
			}
		}

		expect(dangling).toEqual([]);
	});
});
