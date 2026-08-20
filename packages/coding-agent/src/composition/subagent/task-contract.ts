import { type Static, Type } from "@sinclair/typebox";

const NonEmptyTextSchema = Type.String({ minLength: 1 });
const NonEmptyTextListSchema = Type.Array(NonEmptyTextSchema, { minItems: 1 });

export const SubagentTaskContractSchema = Type.Object({
	history: Type.String({
		minLength: 1,
		description: "Relevant history and decisions that explain how the parent reached the current state.",
	}),
	current_state: Type.String({
		minLength: 1,
		description: "Verified current state, including existing behavior, changes already present, and known failures.",
	}),
	objective: Type.String({
		minLength: 1,
		description: "One concrete outcome this child owns. State observable completion, not an implementation activity.",
	}),
	scope: Type.String({
		minLength: 1,
		description: "Exact ownership boundary: modules, files, data, or questions this child may change or inspect.",
	}),
	constraints: NonEmptyTextListSchema,
	relevant_context: NonEmptyTextListSchema,
	deliverables: NonEmptyTextListSchema,
	validation: Type.Array(NonEmptyTextSchema, {
		minItems: 1,
		description: "Functional tests or checks that must pass before the child may claim completion.",
	}),
});

export type SubagentTaskContract = Static<typeof SubagentTaskContractSchema>;

export interface SubagentTaskInput {
	readonly task?: SubagentTaskContract;
	/** Compatibility input for existing callers. New model calls must use task. */
	readonly message?: string;
}

export function resolveSubagentTaskMessage(input: SubagentTaskInput): string {
	if (input.task) return renderSubagentTaskContract(input.task);
	if (input.message?.trim()) return input.message;
	throw new Error("A detailed task contract is required. Provide task, or message for a legacy caller.");
}

export function renderSubagentTaskContract(task: SubagentTaskContract): string {
	return [
		"<delegated_task_contract>",
		section("history", task.history),
		section("current_state", task.current_state),
		section("objective", task.objective),
		section("scope", task.scope),
		listSection("constraints", task.constraints),
		listSection("relevant_context", task.relevant_context),
		listSection("deliverables", task.deliverables),
		listSection("validation", task.validation),
		"</delegated_task_contract>",
		"",
		"Completion is based on the validation results and observable deliverables above, not on code being written.",
	].join("\n");
}

function section(name: string, value: string): string {
	return `<${name}>\n${value.trim()}\n</${name}>`;
}

function listSection(name: string, values: readonly string[]): string {
	return section(name, values.map((value) => `- ${value.trim()}`).join("\n"));
}
