import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition, RuntimeToolExecutionRequest } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { INVOKE_SKILL_TOOL_DESCRIPTION } from "./description.js";

export const InvokeSkillToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	name: Type.String({ description: 'The exact skill name from <available_skills> (e.g., "pdf", "docx", "xlsx")' }),
	args: Type.Optional(Type.String({ description: "Optional arguments to pass to the skill" })),
});

export type InvokeSkillToolInput = Static<typeof InvokeSkillToolInputSchema>;

export interface InvokableSkillDescriptor {
	readonly name: string;
	readonly filePath: string;
	readonly baseDir: string;
	readonly source?: string;
	readonly type?: string;
	readonly disableModelInvocation?: boolean;
}

export interface InvokeSkillToolDetails {
	readonly skillName: string;
	readonly skillLocation: string;
}

export interface InvokeSkillToolOptions<TSkill extends InvokableSkillDescriptor = InvokableSkillDescriptor> {
	readonly getSkills: () => readonly TSkill[];
	readonly readBody: (skill: TSkill, request: RuntimeToolExecutionRequest<InvokeSkillToolInput>) => string;
}

export function createInvokeSkillTool<TSkill extends InvokableSkillDescriptor>(
	options: InvokeSkillToolOptions<TSkill>,
): RuntimeToolDefinition<InvokeSkillToolInput> {
	return {
		name: "invoke_skill",
		label: "invoke_skill",
		description: INVOKE_SKILL_TOOL_DESCRIPTION,
		inputSchema: InvokeSkillToolInputSchema,
		async execute(request) {
			const { name, args } = request.input;
			const skills = options.getSkills();
			const skill = skills.find((candidate) => candidate.name === name);
			if (!skill) {
				const availableNames = skills
					.filter((candidate) => !candidate.disableModelInvocation && candidate.type !== "scene")
					.map((candidate) => candidate.name);
				console.info("[skills] invoke miss", { name, available: availableNames.length });
				return {
					content: [
						{
							type: "text",
							text: `Error: Skill "${name}" not found. Available skills: ${availableNames.join(", ") || "(none)"}`,
						},
					],
					details: { skillName: name, skillLocation: "" } satisfies InvokeSkillToolDetails,
				};
			}

			try {
				const body = options.readBody(skill, request).trim();
				const lines = [
					`<skill name="${skill.name}" location="${skill.filePath}">`,
					"",
					`SKILL_DIR="${skill.baseDir}"`,
					"ALL relative paths (scripts/, references/, Samples/, assets/, etc.) in this skill MUST be resolved against SKILL_DIR using absolute paths.",
					'For example: bash "$SKILL_DIR/scripts/run.sh" — do NOT cd into SKILL_DIR.',
					"NEVER guess or fabricate paths. NEVER use find/locate/mdfind to search for skill files.",
					"",
					"CRITICAL: The skill directory is READ-ONLY. NEVER write, create, or modify any files inside SKILL_DIR.",
					"NEVER cd into SKILL_DIR. Stay in the user's working directory (cwd) at all times.",
					"All output files and artifacts MUST be written to cwd, NOT into the skill directory.",
					"",
					body,
					"</skill>",
				];
				if (args) lines.push("", `User arguments: ${args}`);
				console.info("[skills] invoke", {
					name: skill.name,
					source: skill.source,
					path: skill.filePath,
					hasArgs: Boolean(args),
				});
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { skillName: skill.name, skillLocation: skill.filePath } satisfies InvokeSkillToolDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.info("[skills] invoke error", { name, path: skill.filePath, error: message });
				return {
					content: [{ type: "text", text: `Error reading skill "${name}" from ${skill.filePath}: ${message}` }],
					details: { skillName: name, skillLocation: skill.filePath } satisfies InvokeSkillToolDetails,
				};
			}
		},
	};
}
