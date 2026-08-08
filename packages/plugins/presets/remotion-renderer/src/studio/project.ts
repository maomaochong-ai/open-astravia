import type { PluginFsApi } from "@vetta-org/plugin-sdk";

const ENTRY_POINT_CANDIDATES = [
	"src/index.ts",
	"src/index.tsx",
	"src/index.js",
	"src/index.jsx",
	"src/remotion/index.ts",
	"src/remotion/index.tsx",
] as const;

export type RemotionProjectNotReadyReason =
	| "package-json-missing"
	| "entry-point-missing"
	| "cli-package-missing"
	| "cli-bin-invalid"
	| "cli-bin-missing";

export type RemotionProjectInspection =
	| { kind: "ready"; entryPoint: string; cliPath: string }
	| { kind: "not-ready"; reason: RemotionProjectNotReadyReason };

function joinPath(root: string, relative: string): string {
	return `${root.replace(/[\\/]+$/, "")}/${relative.replace(/^[\\/]+/, "")}`;
}

function parseRecord(text: string, label: string): Record<string, unknown> {
	const value = JSON.parse(text) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must contain a JSON object`);
	}
	return value as Record<string, unknown>;
}

function normalizeRelativePath(value: string): string | null {
	const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
	if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;
	if (normalized.split("/").some((segment) => segment === ".." || segment.length === 0)) return null;
	return normalized;
}

export function resolveRemotionCliBin(packageJson: Record<string, unknown>): string | null {
	const bin = packageJson.bin;
	const value =
		typeof bin === "string"
			? bin
			: bin && typeof bin === "object" && !Array.isArray(bin) && "remotion" in bin
				? (bin as Record<string, unknown>).remotion
				: null;
	return typeof value === "string" ? normalizeRelativePath(value) : null;
}

export async function inspectRemotionProject(fs: PluginFsApi, cwd: string): Promise<RemotionProjectInspection> {
	const packagePath = joinPath(cwd, "package.json");
	if (!(await fs.stat(packagePath))) return { kind: "not-ready", reason: "package-json-missing" };

	const entryPoint = await (async (): Promise<string | null> => {
		for (const candidate of ENTRY_POINT_CANDIDATES) {
			if (await fs.stat(joinPath(cwd, candidate))) return candidate;
		}
		return null;
	})();
	if (!entryPoint) return { kind: "not-ready", reason: "entry-point-missing" };

	const cliPackagePath = joinPath(cwd, "node_modules/@remotion/cli/package.json");
	if (!(await fs.stat(cliPackagePath))) return { kind: "not-ready", reason: "cli-package-missing" };
	const cliPackage = parseRecord((await fs.readFile(cliPackagePath)).content, "@remotion/cli/package.json");
	const cliBin = resolveRemotionCliBin(cliPackage);
	if (!cliBin) return { kind: "not-ready", reason: "cli-bin-invalid" };
	const cliPath = joinPath(cwd, `node_modules/@remotion/cli/${cliBin}`);
	if (!(await fs.stat(cliPath))) return { kind: "not-ready", reason: "cli-bin-missing" };
	return { kind: "ready", entryPoint, cliPath };
}
