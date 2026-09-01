import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
export const TeamDelegateInputSchema = Type.Object(
	{
		target: Type.String({ minLength: 1, description: "Team member handle, without @." }),
		objective: Type.String({ minLength: 1, maxLength: 16_000, description: "Focused work to hand off." }),
	},
	{ additionalProperties: false },
);
export type TeamDelegateInput = Static<typeof TeamDelegateInputSchema>;
export interface TeamDelegationResult {
	readonly memberId: string;
	readonly memberHandle: string;
	readonly summary: string;
}
export interface TeamDelegationPort {
	delegate(input: {
		readonly sourceRuntimeSessionId: string;
		readonly sourceTurnId: string;
		readonly targetHandle: string;
		readonly objective: string;
		readonly signal: AbortSignal;
	}): Promise<TeamDelegationResult>;
}
export function createTeamDelegateTool(port: TeamDelegationPort): RuntimeToolDefinition<TeamDelegateInput> {
	return {
		name: "team_delegate",
		label: "team_delegate",
		description:
			"Delegate a focused task to another persistent member of this Agent Team and wait for that member's final result. Use the member handle shown in the team roster.",
		inputSchema: TeamDelegateInputSchema,
		async execute({ sessionId, turnId, input, signal }) {
			const result = await port.delegate({
				sourceRuntimeSessionId: sessionId,
				sourceTurnId: turnId,
				targetHandle: input.target,
				objective: input.objective,
				signal,
			});
			return { content: [{ type: "text", text: result.summary }], details: result };
		},
	};
}
