import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import {
	DOC_TO_PDF_TOOL_CATEGORY,
	DOC_TO_PDF_TOOL_SCOPES,
	EXTRACT_TEXT_FROM_IMAGE_TOOL_CATEGORY,
	EXTRACT_TEXT_FROM_IMAGE_TOOL_SCOPES,
	EXTRACT_TEXT_FROM_PDF_TOOL_CATEGORY,
	EXTRACT_TEXT_FROM_PDF_TOOL_SCOPES,
	HTML_TO_PDF_TOOL_CATEGORY,
	HTML_TO_PDF_TOOL_SCOPES,
	RENDER_PDF_PAGE_TOOL_CATEGORY,
	RENDER_PDF_PAGE_TOOL_SCOPES,
} from "@vetta/runtime-node/coding";
import { afterEach, describe, expect, it } from "vitest";
import { createCodingAgentSpecializedToolRegistrations } from "../../src/composition/tool-surface/specialized-tools.js";
import {
	CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_CATEGORY,
	CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_REQUIRES,
	CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_SCOPES,
	type CodingAgentKnowledgeWriteOperations,
} from "../../src/features/knowledge/index.js";
import { PROGRESS_TOOL_CATEGORY, PROGRESS_TOOL_SCOPES } from "../../src/features/progress/index.js";
import type { Skill } from "../../src/resources/skills/index.js";
import { createCodingAgentInvokeSkillFeature } from "../../src/resources/skills/invoke-skill-feature.js";
import type {
	CodingAgentPromptResourceSource,
	CodingAgentRuntimeToolRegistration,
} from "../../src/runtime-contracts/index.js";

describe("Coding Agent specialized tool surface", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		for (const directory of temporaryDirectories.splice(0)) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("assembles the complete specialized tool definitions and activation metadata", () => {
		const knowledgeOperations = createKnowledgeOperations();
		const registrations = createCodingAgentSpecializedToolRegistrations({
			platformRegistrations: [
				platformRegistration("doc_to_pdf", DOC_TO_PDF_TOOL_SCOPES, DOC_TO_PDF_TOOL_CATEGORY),
				platformRegistration("html_to_pdf", HTML_TO_PDF_TOOL_SCOPES, HTML_TO_PDF_TOOL_CATEGORY),
				platformRegistration(
					"extract_text_from_pdf",
					EXTRACT_TEXT_FROM_PDF_TOOL_SCOPES,
					EXTRACT_TEXT_FROM_PDF_TOOL_CATEGORY,
				),
				platformRegistration(
					"extract_text_from_img",
					EXTRACT_TEXT_FROM_IMAGE_TOOL_SCOPES,
					EXTRACT_TEXT_FROM_IMAGE_TOOL_CATEGORY,
				),
				platformRegistration("render_pdf_page", RENDER_PDF_PAGE_TOOL_SCOPES, RENDER_PDF_PAGE_TOOL_CATEGORY),
			],
			knowledgePageWriter: knowledgeOperations,
		});
		expect(registrations.map(runtimeActivationDefinition)).toEqual([
			toolContract("doc_to_pdf", DOC_TO_PDF_TOOL_SCOPES, DOC_TO_PDF_TOOL_CATEGORY),
			toolContract("html_to_pdf", HTML_TO_PDF_TOOL_SCOPES, HTML_TO_PDF_TOOL_CATEGORY),
			toolContract("extract_text_from_pdf", EXTRACT_TEXT_FROM_PDF_TOOL_SCOPES, EXTRACT_TEXT_FROM_PDF_TOOL_CATEGORY),
			toolContract(
				"extract_text_from_img",
				EXTRACT_TEXT_FROM_IMAGE_TOOL_SCOPES,
				EXTRACT_TEXT_FROM_IMAGE_TOOL_CATEGORY,
			),
			toolContract("render_pdf_page", RENDER_PDF_PAGE_TOOL_SCOPES, RENDER_PDF_PAGE_TOOL_CATEGORY),
			toolContract("progress", PROGRESS_TOOL_SCOPES, PROGRESS_TOOL_CATEGORY),
			toolContract(
				"kb_write_page",
				CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_SCOPES,
				CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_CATEGORY,
				CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_REQUIRES,
			),
		]);
		for (const { tool } of registrations) {
			expect(tool.label.length).toBeGreaterThan(0);
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.inputSchema).toMatchObject({ type: "object" });
		}
		expect(registrations.map(({ tool }) => tool.modelOrder)).toEqual([
			1_000, 1_100, 1_200, 1_300, 1_400, 1_600, 1_700,
		]);
	});

	it("freezes skill visibility and content per Turn", async () => {
		const directory = await mkdtemp(join(tmpdir(), "coding-agent-invoke-skill-"));
		temporaryDirectories.push(directory);
		const filePath = join(directory, "SKILL.md");
		await writeFile(filePath, "---\nname: sample\ndescription: sample\n---\nUse the sample workflow.\n", "utf8");
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
		});
		const signal = new AbortController().signal;
		const feature = await definition.prepare({ signal });

		try {
			const contribution = await feature.contribute({ signal });
			const provider = contribution.modelCallProviders?.[0];
			if (!provider?.bindForTurn) throw new Error("Expected a Turn-bindable invoke_skill provider");
			const bind = (turnId: string) =>
				provider.bindForTurn?.({
					sessionId: "session-1",
					operationId: turnId,
					reason: "turn",
					signal,
				});
			const contribute = (bound: Awaited<ReturnType<NonNullable<typeof provider.bindForTurn>>>, turnId: string) =>
				bound.contribute({ sessionId: "session-1", turnId, signal });
			const emptyTurn = await bind("turn-empty");
			if (!emptyTurn) throw new Error("Expected empty Turn provider");
			expect((await contribute(emptyTurn, "turn-empty")).tools).toBeUndefined();
			skills = [skill(filePath, directory)];
			const workTurn = await bind("turn-work");
			if (!workTurn) throw new Error("Expected work Turn provider");
			const workContribution = await contribute(workTurn, "turn-work");
			const tool = workContribution.tools?.[0];
			expect(tool?.name).toBe("invoke_skill");
			if (!tool) throw new Error("Expected invoke_skill tool");
			await writeFile(filePath, "---\nname: sample\ndescription: sample\n---\nChanged after admission.\n", "utf8");
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

			expect((await contribute(workTurn, "turn-work")).tools?.[0]?.name).toBe("invoke_skill");
			skills = [];
			const removedTurn = await bind("turn-removed");
			if (!removedTurn) throw new Error("Expected removed Turn provider");
			expect((await contribute(removedTurn, "turn-removed")).tools).toBeUndefined();
			expect(refreshCount).toBe(3);
		} finally {
			await feature.dispose();
		}
	});
});

function createKnowledgeOperations(): CodingAgentKnowledgeWriteOperations {
	return {
		write: async () => ({ action: "create", id: "page-1", path: "page.md" }),
		resolveAbsolutePath: (path) => path,
	};
}

function platformRegistration(
	name: string,
	scopeUse: CodingAgentRuntimeToolRegistration["scopeUse"],
	category: CodingAgentRuntimeToolRegistration["category"],
): CodingAgentRuntimeToolRegistration {
	return {
		tool: {
			name,
			label: name,
			description: `${name} description`,
			inputSchema: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
		},
		scopeUse,
		category,
	};
}

function runtimeActivationDefinition(registration: CodingAgentRuntimeToolRegistration) {
	return {
		name: registration.tool.name,
		scopeUse: registration.scopeUse,
		requires: registration.requires,
		category: registration.category,
	};
}

function toolContract(name: string, scopeUse: readonly string[], category: string, requires?: readonly string[]) {
	return { name, scopeUse, requires, category };
}

function skill(filePath: string, baseDir: string): Skill {
	return {
		name: "sample",
		description: "Sample skill",
		filePath,
		baseDir,
		source: "test",
		type: "skill",
		disableModelInvocation: false,
		content: "---\nname: sample\ndescription: sample\n---\nUse the sample workflow.\n",
		sceneTasks: [],
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
		setRuntimeSkillPaths: async () => {},
		refreshContextResourcesIfChanged: async () => false,
		refreshSkillsIfChanged: async () => {
			options.onRefresh();
			return true;
		},
	};
}
