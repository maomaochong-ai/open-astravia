export type ContextSectionKind = "instruction" | "tool_schema" | "history" | "runtime_context" | "user_input";

export type ContextSourceOwner = "core" | "skill" | "plugin" | "mcp" | "extension" | "runtime" | "user" | "unknown";

export type TokenEstimateMethod = "provider_tokenizer" | "model_tokenizer" | "heuristic" | "unknown";

export interface ContextCompositionModel {
	readonly provider: string;
	readonly modelId: string;
	readonly contextWindow: number;
}

export interface ContextSectionSource {
	readonly owner: ContextSourceOwner;
	readonly id: string;
}

export interface ContextSectionUsage {
	readonly id: string;
	readonly kind: ContextSectionKind;
	readonly category?: string;
	readonly source: ContextSectionSource;
	readonly estimatedTokens: number | null;
	readonly estimateMethod: TokenEstimateMethod;
	readonly tokenizerId?: string;
	readonly characters?: number;
	readonly percentOfWindow: number | null;
}

export interface ContextCompositionEstimate {
	readonly tokens: number | null;
	readonly knownTokens: number;
	readonly coverage: "complete" | "partial" | "none";
}

export interface ContextCompositionReport {
	readonly version: 1;
	readonly callId: string;
	readonly snapshotId: string;
	readonly phase: "prepared" | "completed";
	readonly createdAt: number;
	readonly model: ContextCompositionModel;
	readonly estimate: ContextCompositionEstimate;
	readonly providerReportedInputTokens?: number | null;
	readonly sections: readonly ContextSectionUsage[];
}

export interface ContextCompositionSectionInput {
	readonly id: string;
	readonly kind: ContextSectionKind;
	readonly category?: string;
	readonly source: ContextSectionSource;
	/** Sensitive content is used only during estimation and is never copied into the report. */
	readonly content?: string;
}

export interface TokenEstimateRequest {
	readonly model: ContextCompositionModel;
	readonly section: Pick<ContextCompositionSectionInput, "id" | "kind" | "category" | "source">;
	readonly content: string;
}

export interface TokenEstimate {
	readonly tokens: number | null;
	readonly method: TokenEstimateMethod;
	readonly tokenizerId?: string;
}

export interface TokenEstimator {
	estimate(request: TokenEstimateRequest): Promise<TokenEstimate> | TokenEstimate;
}

export interface BuildContextCompositionReportInput {
	readonly callId: string;
	readonly snapshotId: string;
	readonly createdAt: number;
	readonly model: ContextCompositionModel;
	readonly sections: readonly ContextCompositionSectionInput[];
}
