import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";

export const SUBAGENT_REPORT_TO_PARENT_TOOL_NAME = "report_to_parent";

export const SubagentReportSchema = Type.Object({
	status: Type.Union([Type.Literal("progress"), Type.Literal("blocked"), Type.Literal("validation")]),
	summary: Type.String({ minLength: 1, description: "Concise user-language update for the root agent." }),
	details: Type.Optional(Type.String({ description: "Evidence, blocker details, or the next decision required." })),
	artifacts: Type.Optional(
		Type.Array(
			Type.Object({
				path: Type.String({ minLength: 1 }),
				summary: Type.String({ minLength: 1 }),
			}),
		),
	),
	validation: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String({ minLength: 1 }),
				outcome: Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("not_run")]),
				details: Type.Optional(Type.String()),
			}),
		),
	),
});

export type SubagentReport = Static<typeof SubagentReportSchema>;

export interface SubagentReportEnvelope {
	readonly id: string;
	readonly taskName: string;
	readonly path: string;
	readonly report: SubagentReport;
}

export function createSubagentReportToParentToolRegistration(options: {
	readonly id: string;
	readonly taskName: string;
	onReport(envelope: SubagentReportEnvelope): Promise<void>;
}): CodingAgentRuntimeToolRegistration {
	const tool: RuntimeToolDefinition<SubagentReport> = {
		name: SUBAGENT_REPORT_TO_PARENT_TOOL_NAME,
		label: SUBAGENT_REPORT_TO_PARENT_TOOL_NAME,
		description: [
			"Send a structured progress, blocker, or validation report to the root agent.",
			"Use it when the root can act before you finish, when blocked, and after meaningful validation.",
			"This does not end your turn and does not replace the final completion summary.",
		].join("\n"),
		inputSchema: SubagentReportSchema,
		async execute({ input }) {
			const envelope = {
				id: options.id,
				taskName: options.taskName,
				path: `/root/${options.taskName}`,
				report: input,
			} satisfies SubagentReportEnvelope;
			await options.onReport(envelope);
			return {
				content: [{ type: "text", text: "Report delivered to the root agent." }],
				details: envelope,
			};
		},
	};
	return {
		tool,
		scopeUse: ["conversation", "project", "cli"],
		category: "agent-control",
		modelOrder: 2450,
	};
}

export function formatSubagentReport(envelope: SubagentReportEnvelope): string {
	const { report } = envelope;
	const lines = [
		"<subagent_report>",
		`id: ${envelope.id}`,
		`path: ${envelope.path}`,
		`task_name: ${envelope.taskName}`,
		`status: ${report.status}`,
		`summary: ${report.summary}`,
	];
	if (report.details) lines.push(`details: ${report.details}`);
	for (const artifact of report.artifacts ?? []) {
		lines.push(`artifact: ${artifact.path} — ${artifact.summary}`);
	}
	for (const validation of report.validation ?? []) {
		lines.push(
			`validation: [${validation.outcome}] ${validation.name}${validation.details ? ` — ${validation.details}` : ""}`,
		);
	}
	lines.push("</subagent_report>");
	return lines.join("\n");
}
