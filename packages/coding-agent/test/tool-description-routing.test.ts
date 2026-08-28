import { describe, expect, it } from "vitest";
import { createCurrentTimeTool } from "../src/features/current-time/index.js";
import { PROGRESS_TOOL_DESCRIPTION } from "../src/features/progress/index.js";
import { TODO_TOOL_DESCRIPTION } from "../src/features/todo/index.js";
import { CODING_AGENT_READ_TOOL_DESCRIPTION } from "../src/tool-policy/platform-tool-descriptions.js";

describe("product tool description routing", () => {
	it("limits progress to substantive multi-step tool work", () => {
		expect(PROGRESS_TOOL_DESCRIPTION).toContain("multi-step work");
		expect(PROGRESS_TOOL_DESCRIPTION).toContain("Skip it for a single trivial lookup");
		expect(PROGRESS_TOOL_DESCRIPTION).toContain("regardless of the user's technical level");
		expect(PROGRESS_TOOL_DESCRIPTION).not.toContain("NOT a developer");
	});

	it("distinguishes an execution todo from an informational plan", () => {
		expect(TODO_TOOL_DESCRIPTION).toContain("execute and track the work");
		expect(TODO_TOOL_DESCRIPTION).toContain("without executing it");
	});

	it("states the current-time timezone limitation", () => {
		const description = createCurrentTimeTool().description;
		expect(description).toContain("host system's current local date and time");
		expect(description).toContain("does not include a timezone identifier");
	});

	it("owns product routing for platform reads", () => {
		expect(CODING_AGENT_READ_TOOL_DESCRIPTION).toContain("line:hash→content");
		expect(CODING_AGENT_READ_TOOL_DESCRIPTION).toContain("PDF text: use `extract_text_from_pdf`");
		expect(CODING_AGENT_READ_TOOL_DESCRIPTION).toContain(
			"exact skill name shown in the current available-skills list",
		);
		expect(CODING_AGENT_READ_TOOL_DESCRIPTION).not.toContain('invoke_skill(name="docx")');
	});
});
