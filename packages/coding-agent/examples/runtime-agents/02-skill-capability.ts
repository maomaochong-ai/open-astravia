import { fileURLToPath } from "node:url";
import {
	createInvokeSkillTool,
	formatSkillsForPrompt,
	loadSkillsFromDir,
	type ResourceDiagnostic,
	type Skill,
} from "@vetta/coding-agent/resources";
import {
	defineRuntimeAgent,
	type RuntimeAgentDefinition,
	type RuntimeAgentSessionPlan,
	RuntimeHost,
} from "@vetta/runtime-core";
import {
	type AgentFeatureDefinition,
	createDefaultRuntimeCapabilityDefinition,
	type ModelCallContribution,
	type ModelCallContributionProvider,
	type RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import { createNodeResourceAccess } from "@vetta/runtime-node/host";
import { acquirePreview, executeTextTool } from "./support/preview.js";

const resourceAccess = createNodeResourceAccess();

export interface SkillCapabilityExampleResult {
	readonly researcher: {
		readonly prompt: string;
		readonly toolNames: readonly string[];
		readonly invocation: string;
		readonly diagnostics: readonly ResourceDiagnostic[];
	};
	readonly reviewer: {
		readonly prompt: string;
		readonly toolNames: readonly string[];
		readonly invocation: string;
		readonly diagnostics: readonly ResourceDiagnostic[];
	};
}

export interface DirectorySkillAgentOptions {
	readonly id: string;
	readonly skillsDirectory: string;
	readonly onDiagnostics?: (diagnostics: readonly ResourceDiagnostic[]) => void;
}

/**
 * 使用 Coding Agent 的公开 Skill 发现/格式化/调用 API，并在 Turn admission 物化完整 Skill generation。
 * 文件读取是 Host adapter；Runtime Snapshot 不再回读磁盘，因此同一 Turn 的索引与正文始终一致。
 */
export function createDirectorySkillAgent(options: DirectorySkillAgentOptions): RuntimeAgentDefinition {
	return defineRuntimeAgent({
		id: options.id,
		createInstance: () => ({
			prepareSession: () => {
				let currentSkills: readonly Skill[] = [];
				const plan: RuntimeAgentSessionPlan = {
					definition: {
						capabilities: createDefaultRuntimeCapabilityDefinition({
							instructions: [
								{
									id: `${options.id}.base`,
									content: "Load an applicable Skill before following its specialized workflow.",
									priority: 0,
								},
							],
							features: [createSkillFeature(() => currentSkills)],
							toolPolicy: { authorize: async () => true },
						}),
					},
					async beforeSnapshotAcquire(context) {
						const result = await loadSkillsFromDir({
							resourceAccess,
							dir: options.skillsDirectory,
							source: `example:${options.id}`,
							signal: context?.signal,
						});
						currentSkills = result.skills;
						options.onDiagnostics?.(result.diagnostics);
					},
				};
				return plan;
			},
		}),
	});
}

export async function runSkillCapabilityExample(): Promise<SkillCapabilityExampleResult> {
	const researcherDiagnostics: ResourceDiagnostic[] = [];
	const reviewerDiagnostics: ResourceDiagnostic[] = [];
	const host = new RuntimeHost();

	try {
		host.agents.registry.upsert({
			source: { id: "example", revision: "skills-1" },
			definition: createDirectorySkillAgent({
				id: "skill-researcher",
				skillsDirectory: fileURLToPath(new URL("./skills/researcher/", import.meta.url)),
				onDiagnostics: (diagnostics) => researcherDiagnostics.push(...diagnostics),
			}),
		});
		host.agents.registry.upsert({
			source: { id: "example", revision: "skills-1" },
			definition: createDirectorySkillAgent({
				id: "skill-reviewer",
				skillsDirectory: fileURLToPath(new URL("./skills/reviewer/", import.meta.url)),
				onDiagnostics: (diagnostics) => reviewerDiagnostics.push(...diagnostics),
			}),
		});
		const researcher = await host.agents.createInstance({
			agentId: "skill-researcher",
			instanceId: "skill-researcher-instance",
		});
		const reviewer = await host.agents.createInstance({
			agentId: "skill-reviewer",
			instanceId: "skill-reviewer-instance",
		});
		const researcherSession = await researcher.createSession({ sessionId: "skill-researcher-session" });
		const reviewerSession = await reviewer.createSession({ sessionId: "skill-reviewer-session" });
		const researcherPreview = await acquirePreview(researcherSession, "skill-researcher-turn");
		try {
			const reviewerPreview = await acquirePreview(reviewerSession, "skill-reviewer-turn");
			try {
				return {
					researcher: {
						prompt: readInstruction(researcherPreview.frame.instructions, "skills.index"),
						toolNames: [...researcherPreview.frame.tools.keys()],
						invocation: await invokeSkill(
							researcherPreview.frame.tools,
							"evidence-review",
							"Check the rollout claim",
							researcherSession.id,
							"skill-researcher-turn",
						),
						diagnostics: researcherDiagnostics,
					},
					reviewer: {
						prompt: readInstruction(reviewerPreview.frame.instructions, "skills.index"),
						toolNames: [...reviewerPreview.frame.tools.keys()],
						invocation: await invokeSkill(
							reviewerPreview.frame.tools,
							"release-checklist",
							"Review version 2",
							reviewerSession.id,
							"skill-reviewer-turn",
						),
						diagnostics: reviewerDiagnostics,
					},
				};
			} finally {
				await reviewerPreview.lease.release();
			}
		} finally {
			await researcherPreview.lease.release();
		}
	} finally {
		await host.close();
	}
}

function createSkillFeature(readCurrentSkills: () => readonly Skill[]): AgentFeatureDefinition {
	const capture = (): ModelCallContribution => createSkillContribution(captureSkills(readCurrentSkills()));
	const provider: ModelCallContributionProvider = {
		id: "example.skills",
		bindForTurn: () => {
			const contribution = capture();
			return {
				id: "example.skills.bound",
				async contribute({ signal }) {
					signal.throwIfAborted();
					return contribution;
				},
			};
		},
		async contribute({ signal }) {
			signal.throwIfAborted();
			return capture();
		},
	};
	return {
		id: "example.skills",
		async prepare() {
			return {
				async contribute() {
					return { modelCallProviders: [provider] };
				},
				async dispose() {},
			};
		},
	};
}

function createSkillContribution(skills: readonly Skill[]): ModelCallContribution {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation && skill.type !== "scene");
	const content = formatSkillsForPrompt(visibleSkills);
	const tool = createInvokeSkillTool({
		getSkills: () => visibleSkills,
		readBody: (skill) => readFrontmatterBody(skill.content),
	});
	return {
		instructions: content ? [{ id: "skills.index", content, priority: 400 }] : [],
		tools: visibleSkills.length > 0 ? [tool] : [],
	};
}

function captureSkills(skills: readonly Skill[]): readonly Skill[] {
	return skills.map((skill) => ({ ...skill, sceneTasks: [...skill.sceneTasks] }));
}

function readFrontmatterBody(content: string): string {
	const lines = content.split(/\r?\n/);
	if (lines[0] !== "---") return content;
	const closing = lines.indexOf("---", 1);
	return closing < 0 ? content : lines.slice(closing + 1).join("\n");
}

async function invokeSkill(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	name: string,
	args: string,
	sessionId: string,
	turnId: string,
): Promise<string> {
	const tool = tools.get("invoke_skill");
	if (!tool) throw new Error("Expected invoke_skill in the example frame");
	return executeTextTool(tool, { description: `Load ${name}`, name, args }, sessionId, turnId);
}

function readInstruction(
	instructions: readonly { readonly id: string; readonly content: string }[],
	id: string,
): string {
	return instructions.find((instruction) => instruction.id === id)?.content ?? "";
}
