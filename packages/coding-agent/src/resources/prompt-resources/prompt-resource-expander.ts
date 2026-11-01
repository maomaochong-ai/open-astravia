import type { PromptResourceRef } from "@astravia/runtime-core";
import { createSkillHookContribution, readSkillInvocationDocument } from "../skills/skill-document.js";
import type { PromptResourceExpansion, PromptResourceExpansionDependencies } from "./contracts.js";

function expandPromptResource(
	text: string,
	promptRef: PromptResourceRef,
	dependencies: PromptResourceExpansionDependencies,
	options: { structured: boolean; legacyArgs?: string },
): PromptResourceExpansion {
	const name = promptRef.name.trim();
	const skill = dependencies.resourceLoader.getSkills().skills.find((candidate) => candidate.name === name);
	if (!skill) {
		console.info("[skills] expand miss", { kind: promptRef.kind, name });
		return options.structured ? { text, promptRef } : { text };
	}

	try {
		const document = readSkillInvocationDocument(skill);
		const body = document.body.trim();
		const hookContribution = createSkillHookContribution(skill, document);
		const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
		console.info("[skills] expand", {
			kind: "skill",
			name: skill.name,
			source: skill.source,
			path: skill.filePath,
			hasArgs: Boolean(options.legacyArgs),
		});
		return {
			text,
			skillInjection: skillBlock,
			promptResourceHookContribution: hookContribution,
			// Keep the established public field populated for external resolvers/consumers.
			skillHookContribution: hookContribution,
			promptRef,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.info("[skills] expand error", {
			kind: "skill",
			name: skill.name,
			path: skill.filePath,
			error: message,
		});
		dependencies.emitError?.({
			extensionPath: skill.filePath,
			event: "skill_expansion",
			error: message,
		});
		return options.structured ? { text, promptRef } : { text };
	}
}

export function expandPromptResourceReference(
	text: string,
	promptRef: PromptResourceRef,
	dependencies: PromptResourceExpansionDependencies,
): PromptResourceExpansion {
	const name = promptRef.name.trim();
	if (!name) throw new Error("Prompt resource name must not be empty");
	return expandPromptResource(text, { ...promptRef, name }, dependencies, { structured: true });
}

export function expandPromptResourceCommand(
	text: string,
	dependencies: PromptResourceExpansionDependencies,
): PromptResourceExpansion {
	const prefix = "/skill:";
	if (!text.startsWith(prefix)) return { text };

	const rest = text.slice(prefix.length);
	const separator = rest.match(/[\s]/);
	const name = separator ? rest.slice(0, separator.index) : rest;
	const args = separator ? rest.slice(separator.index).trim() : "";
	return expandPromptResource(text, { kind: "skill", name }, dependencies, { structured: false, legacyArgs: args });
}
