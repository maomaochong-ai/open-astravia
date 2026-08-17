export type CodingToolExecutable = "fd" | "rg";

export interface CodingToolExecutableResolver {
	readonly resolve: (tool: CodingToolExecutable) => Promise<string | undefined>;
}
