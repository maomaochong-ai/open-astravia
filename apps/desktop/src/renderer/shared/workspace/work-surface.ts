import type { ConversationScenario } from "@vetta-org/plugin-sdk";

/**
 * A mounted working surface owns long-lived UI state independently from a
 * Conversation or Runtime. Conversation, Team, and project connectors choose
 * the stable key; reusable workspace abilities only consume this contract.
 */
export interface WorkSurfaceScope {
	readonly key: string;
	readonly cwd: string | null;
	readonly scenario?: ConversationScenario;
}
