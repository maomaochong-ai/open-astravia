import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptResourceRef } from "@vetta/runtime-core";
import { createSkillHookContribution, readSkillInvocationDocument } from "../skills/skill-document.js";
import type { PromptResourceExpansion, PromptResourceExpansionDependencies } from "./contracts.js";

function expandPromptResource(
	text: string,
	promptRef: PromptResourceRef,
	dependencies: PromptResourceExpansionDependencies,
	options: { structured: boolean; legacyArgs?: string },
): PromptResourceExpansion {
	const name = promptRef.name.trim();
	const isScene = promptRef.kind === "scene";
	const allSkills = dependencies.resourceLoader.getSkills().skills;
	const skill = isScene
		? allSkills.find((candidate) => candidate.name === name && candidate.type === "scene")
		: allSkills.find((candidate) => candidate.name === name && (!options.structured || candidate.type !== "scene"));
	if (!skill) {
		console.info("[skills] expand miss", { kind: promptRef.kind, name });
		return options.structured ? { text, promptRef } : { text };
	}

	try {
		const document = readSkillInvocationDocument(skill);
		const body = document.body.trim();
		if (isScene) {
			const lines: string[] = [
				`<scene name="${skill.name}" location="${skill.filePath}">`,
				"",
				`SCENE_DIR="${skill.baseDir}"`,
				`ALL relative paths in this scene MUST be resolved against SCENE_DIR using absolute paths.`,
				`For example: bash "${skill.baseDir}/scripts/run.sh" — do NOT cd into the scene directory.`,
				`IMPORTANT: Use the literal path above. Do NOT use shell variables like $SCENE_DIR — no such variable exists in the shell environment.`,
				"",
				`CRITICAL: The scene directory is READ-ONLY. NEVER write, create, or modify any files inside the scene directory.`,
				`NEVER cd into the scene directory. Stay in the user's working directory (cwd) at all times.`,
				`All output files and artifacts MUST be written to cwd, NOT into the scene directory.`,
				"",
				body,
				`</scene>`,
			];

			const sceneState = dependencies.todoState.readSceneTodoState();
			const tasksJsonPath = join(skill.baseDir, "tasks.json");
			if (sceneState.locked) {
				lines.push(
					"",
					`[SYSTEM] The todo list is already locked from an earlier scene invocation in this session (${sceneState.itemCount} items).`,
					`Do NOT call todo(action="create") — it will be rejected.`,
					`Continue working through the existing items in strict sequential order.`,
					`Use todo(action="list") to view current progress.`,
				);
			} else if (skill.sceneTasks !== undefined || existsSync(tasksJsonPath)) {
				try {
					const tasks: unknown = skill.sceneTasks ?? JSON.parse(readFileSync(tasksJsonPath, "utf-8"));
					if (Array.isArray(tasks) && tasks.length > 0 && tasks.every((task) => typeof task === "string")) {
						dependencies.todoState.initializeSceneTodoItems(tasks);
						lines.push(
							"",
							`[SYSTEM] ${tasks.length} todo items have been auto-created from this scene's tasks.json and the list is now LOCKED.`,
							`Do NOT call todo(action="create") — it will be rejected. The tasks.json list is the authoritative plan.`,
							`Work strictly through these items in order. Start now with todo(action="update", id=1, status="in_progress").`,
							`After finishing each item, IMMEDIATELY call todo(action="update", id=N, status="done") before moving on to the next.`,
						);
					}
				} catch {
					// Malformed tasks.json remains a best-effort no-op.
				}
			}

			console.info("[skills] expand", {
				kind: "scene",
				name: skill.name,
				source: skill.source,
				path: skill.filePath,
				hasArgs: Boolean(options.legacyArgs),
			});
			return {
				text: options.legacyArgs || text,
				sceneInjection: lines.join("\n"),
				promptRef,
			};
		}

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
			skillHookContribution: createSkillHookContribution(skill, document),
			promptRef,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.info("[skills] expand error", {
			kind: isScene ? "scene" : "skill",
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
	let kind: PromptResourceRef["kind"];
	let prefix: string;
	if (text.startsWith("/skill:")) {
		kind = "skill";
		prefix = "/skill:";
	} else if (text.startsWith("/scene:")) {
		kind = "scene";
		prefix = "/scene:";
	} else {
		return { text };
	}

	const rest = text.slice(prefix.length);
	const separator = rest.match(/[\s]/);
	const name = separator ? rest.slice(0, separator.index) : rest;
	const args = separator ? rest.slice(separator.index).trim() : "";
	return expandPromptResource(text, { kind, name }, dependencies, { structured: false, legacyArgs: args });
}
