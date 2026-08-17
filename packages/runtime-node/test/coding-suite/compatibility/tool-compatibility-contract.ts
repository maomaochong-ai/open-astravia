export interface ToolCompatibilityDefinition {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly schema: Readonly<Record<string, unknown>>;
	readonly scopeUse: readonly string[];
	readonly category: string;
}
