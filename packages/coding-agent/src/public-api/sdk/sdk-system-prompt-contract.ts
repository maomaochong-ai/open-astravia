/** Public value model for deterministic system-prompt contributions. */
export type SystemPromptBlockType =
	| "subconscious"
	| "base"
	| "tools"
	| "mcp"
	| "guidelines"
	| "append"
	| "context"
	| "memory"
	| "skills"
	| "mode"
	| "personalization"
	| "footer"
	| "plugin";

export interface SystemPromptBlock {
	id: string;
	type: SystemPromptBlockType;
	source: {
		kind: "core" | "plugin";
		pluginId?: string;
	};
	content: string;
	priority: number;
	enabled: boolean;
	/** Core blocks infer this from priority; plugin blocks default to volatile. */
	cacheability?: "stable" | "volatile";
}

export type SystemPromptBlockPatch = Partial<Omit<SystemPromptBlock, "id" | "source">>;

export type SystemPromptOperation =
	| { type: "addBlock"; block: SystemPromptBlock }
	| { type: "replaceBlock"; blockId: string; block: SystemPromptBlock }
	| { type: "updateBlock"; blockId: string; patch: SystemPromptBlockPatch }
	| { type: "removeBlock"; blockId: string }
	| { type: "setBlockEnabled"; blockId: string; enabled: boolean };

export interface SystemPromptContribution {
	pluginId: string;
	operations: SystemPromptOperation[];
}
