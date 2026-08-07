import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DOC_TO_PDF_TOOL_AGENT_MODES,
	DOC_TO_PDF_TOOL_CATEGORY,
	DOC_TO_PDF_TOOL_SCOPES,
	EXTRACT_TEXT_FROM_IMAGE_TOOL_AGENT_MODES,
	EXTRACT_TEXT_FROM_IMAGE_TOOL_CATEGORY,
	EXTRACT_TEXT_FROM_IMAGE_TOOL_SCOPES,
	EXTRACT_TEXT_FROM_PDF_TOOL_AGENT_MODES,
	EXTRACT_TEXT_FROM_PDF_TOOL_CATEGORY,
	EXTRACT_TEXT_FROM_PDF_TOOL_SCOPES,
	HTML_TO_PDF_TOOL_AGENT_MODES,
	HTML_TO_PDF_TOOL_CATEGORY,
	HTML_TO_PDF_TOOL_SCOPES,
	KB_WRITE_PAGE_TOOL_CATEGORY,
	KB_WRITE_PAGE_TOOL_REQUIRES,
	KB_WRITE_PAGE_TOOL_SCOPES,
	type KbWritePageOperations,
	PROGRESS_TOOL_AGENT_MODES,
	PROGRESS_TOOL_CATEGORY,
	PROGRESS_TOOL_SCOPES,
	RENDER_PDF_PAGE_TOOL_AGENT_MODES,
	RENDER_PDF_PAGE_TOOL_CATEGORY,
	RENDER_PDF_PAGE_TOOL_SCOPES,
} from "@vetta/runtime-tools/coding";
import { afterEach, describe, expect, it } from "vitest";
import { createCodingAgentProductToolRegistrations } from "../../src/composition/tool-surface/product-tools.js";
import type { Skill } from "../../src/resources/skills/index.js";
import { createCodingAgentInvokeSkillFeature } from "../../src/resources/skills/invoke-skill-feature.js";
import type {
	CodingAgentPromptResourceSource,
	CodingAgentRuntimeToolRegistration,
} from "../../src/runtime-contracts/index.js";

describe("Coding Agent product tool surface", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		for (const directory of temporaryDirectories.splice(0)) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("assembles the complete runtime product tool definitions and activation metadata", () => {
		const cwd = process.cwd();
		const knowledgeOperations = createKnowledgeOperations();
		const registrations = createCodingAgentProductToolRegistrations({
			cwd,
			knowledgePageWriter: knowledgeOperations,
		});
		expect(registrations.map(runtimeActivationDefinition)).toEqual([
			toolContract("doc_to_pdf", DOC_TO_PDF_TOOL_SCOPES, DOC_TO_PDF_TOOL_CATEGORY, DOC_TO_PDF_TOOL_AGENT_MODES),
			toolContract("html_to_pdf", HTML_TO_PDF_TOOL_SCOPES, HTML_TO_PDF_TOOL_CATEGORY, HTML_TO_PDF_TOOL_AGENT_MODES),
			toolContract(
				"extract_text_from_pdf",
				EXTRACT_TEXT_FROM_PDF_TOOL_SCOPES,
				EXTRACT_TEXT_FROM_PDF_TOOL_CATEGORY,
				EXTRACT_TEXT_FROM_PDF_TOOL_AGENT_MODES,
			),
			toolContract(
				"extract_text_from_img",
				EXTRACT_TEXT_FROM_IMAGE_TOOL_SCOPES,
				EXTRACT_TEXT_FROM_IMAGE_TOOL_CATEGORY,
				EXTRACT_TEXT_FROM_IMAGE_TOOL_AGENT_MODES,
			),
			toolContract(
				"render_pdf_page",
				RENDER_PDF_PAGE_TOOL_SCOPES,
				RENDER_PDF_PAGE_TOOL_CATEGORY,
				RENDER_PDF_PAGE_TOOL_AGENT_MODES,
			),
			toolContract("progress", PROGRESS_TOOL_SCOPES, PROGRESS_TOOL_CATEGORY, PROGRESS_TOOL_AGENT_MODES),
			toolContract(
				"kb_write_page",
				KB_WRITE_PAGE_TOOL_SCOPES,
				KB_WRITE_PAGE_TOOL_CATEGORY,
				undefined,
				KB_WRITE_PAGE_TOOL_REQUIRES,
			),
		]);
		for (const { tool } of registrations) {
			expect(tool.label.length).toBeGreaterThan(0);
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.inputSchema).toMatchObject({ type: "object" });
		}
	});

	it("refreshes skill visibility per call and resolves the current file at execution", async () => {
		const directory = await mkdtemp(join(tmpdir(), "coding-agent-invoke-skill-"));
		temporaryDirectories.push(directory);
		const filePath = join(directory, "SKILL.md");
		await writeFile(filePath, "---\nname: sample\ndescription: sample\n---\nUse the sample workflow.\n", "utf8");
		let mode = "work";
		let skills: Skill[] = [];
		let refreshCount = 0;
		const source = promptResourceSource({
			readSkills: () => skills,
			onRefresh: () => {
				refreshCount += 1;
			},
		});
		const definition = createCodingAgentInvokeSkillFeature({
			resourceSource: source,
			readAgentMode: () => mode,
		});
		const signal = new AbortController().signal;
		const feature = await definition.prepare({ signal });

		try {
			expect((await feature.contribute({ profileId: "test", signal })).tools).toBeUndefined();
			skills = [skill(filePath, directory)];
			const workContribution = await feature.contribute({ profileId: "test", signal });
			const tool = workContribution.tools?.[0];
			expect(tool?.name).toBe("invoke_skill");
			if (!tool) throw new Error("Expected invoke_skill tool");
			const result = await tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "call-1",
				input: { description: "load sample", name: "sample" },
				signal,
			});
			expect(result.content[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("Use the sample workflow."),
			});

			mode = "coding";
			expect((await feature.contribute({ profileId: "test", signal })).tools).toBeUndefined();
			mode = "work";
			skills = [];
			expect((await feature.contribute({ profileId: "test", signal })).tools).toBeUndefined();
			expect(refreshCount).toBeGreaterThanOrEqual(5);
		} finally {
			await feature.dispose();
		}
	});
});

function createKnowledgeOperations(): KbWritePageOperations {
	return {
		write: async () => ({ action: "create", id: "page-1", path: "page.md" }),
		resolveAbsolutePath: (path) => path,
	};
}

function runtimeActivationDefinition(registration: CodingAgentRuntimeToolRegistration) {
	return {
		name: registration.tool.name,
		scopeUse: registration.scopeUse,
		requires: registration.requires,
		agentModes: registration.agentModes,
		category: registration.category,
	};
}

function toolContract(
	name: string,
	scopeUse: readonly string[],
	category: string,
	agentModes?: readonly string[],
	requires?: readonly string[],
) {
	return { name, scopeUse, requires, agentModes, category };
}

function skill(filePath: string, baseDir: string): Skill {
	return {
		name: "sample",
		description: "Sample skill",
		filePath,
		baseDir,
		source: "test",
		type: "skill",
		agentMode: ["work"],
		disableModelInvocation: false,
	};
}

function promptResourceSource(options: {
	readonly readSkills: () => Skill[];
	readonly onRefresh: () => void;
}): CodingAgentPromptResourceSource {
	return {
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getAppendSystemPrompt: () => [],
		getSkills: () => ({ skills: options.readSkills(), diagnostics: [] }),
		getSystemPrompt: () => undefined,
		refreshSkillsIfChanged: () => {
			options.onRefresh();
			return true;
		},
	};
}
