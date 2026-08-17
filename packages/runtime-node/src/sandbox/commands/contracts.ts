export type NodeSandboxPlatform = "win32" | "linux" | "darwin";

export type NodeSandboxEnvironment = Readonly<Record<string, string | undefined>>;

export interface NodeSandboxShell {
	readonly executable: string;
	readonly args: readonly string[];
}
