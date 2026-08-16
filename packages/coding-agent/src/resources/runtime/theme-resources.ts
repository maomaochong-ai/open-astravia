import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { ResourceDiagnostic } from "../contracts/diagnostics.js";
import type { ResourceAccessPort } from "../contracts/resource-access.js";
import type { ThemeResourceParser } from "../contracts/resource-runtime.js";

export interface LoadThemeResourcesOptions {
	readonly resourceAccess: ResourceAccessPort;
	readonly paths: readonly string[];
	readonly cwd: string;
	readonly parse: ThemeResourceParser;
	readonly signal?: AbortSignal;
}

export async function loadThemeResources(options: LoadThemeResourcesOptions): Promise<{
	themes: Theme[];
	diagnostics: ResourceDiagnostic[];
}> {
	const themes: Theme[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	for (const path of options.paths) {
		options.signal?.throwIfAborted();
		const resolved = options.resourceAccess.paths.resolve(options.cwd, path);
		try {
			const info = await options.resourceAccess.files.stat(resolved, { signal: options.signal });
			if (!info) {
				diagnostics.push({ type: "warning", message: "theme path does not exist", path: resolved });
				continue;
			}
			if (info.kind === "directory") {
				await loadThemesFromDirectory(options, resolved, themes, diagnostics);
			} else if (info.kind === "file" && resolved.endsWith(".json")) {
				await loadThemeFile(options, resolved, themes, diagnostics);
			} else {
				diagnostics.push({ type: "warning", message: "theme path is not a json file", path: resolved });
			}
		} catch (error) {
			options.signal?.throwIfAborted();
			diagnostics.push({
				type: "warning",
				message: error instanceof Error ? error.message : "failed to read theme path",
				path: resolved,
			});
		}
	}
	return dedupeThemes(themes, diagnostics);
}

async function loadThemesFromDirectory(
	options: LoadThemeResourcesOptions,
	directory: string,
	themes: Theme[],
	diagnostics: ResourceDiagnostic[],
): Promise<void> {
	try {
		const entries = await options.resourceAccess.files.readDirectory(directory, { signal: options.signal });
		for (const entry of entries) {
			options.signal?.throwIfAborted();
			const filePath = options.resourceAccess.paths.join(directory, entry.name);
			let kind = entry.kind;
			if (entry.symbolicLink) {
				try {
					kind = (await options.resourceAccess.files.stat(filePath, { signal: options.signal }))?.kind ?? "other";
				} catch {
					options.signal?.throwIfAborted();
					continue;
				}
			}
			if (kind === "file" && entry.name.endsWith(".json")) {
				await loadThemeFile(options, filePath, themes, diagnostics);
			}
		}
	} catch (error) {
		options.signal?.throwIfAborted();
		diagnostics.push({
			type: "warning",
			message: error instanceof Error ? error.message : "failed to read theme directory",
			path: directory,
		});
	}
}

async function loadThemeFile(
	options: LoadThemeResourcesOptions,
	filePath: string,
	themes: Theme[],
	diagnostics: ResourceDiagnostic[],
): Promise<void> {
	try {
		const content = await options.resourceAccess.files.readText(filePath, { signal: options.signal });
		options.signal?.throwIfAborted();
		themes.push(options.parse(filePath, content));
	} catch (error) {
		options.signal?.throwIfAborted();
		diagnostics.push({
			type: "warning",
			message: error instanceof Error ? error.message : "failed to load theme",
			path: filePath,
		});
	}
}

function dedupeThemes(
	themes: Theme[],
	diagnostics: ResourceDiagnostic[],
): {
	themes: Theme[];
	diagnostics: ResourceDiagnostic[];
} {
	const seen = new Map<string, Theme>();
	for (const theme of themes) {
		const name = theme.name ?? "unnamed";
		const existing = seen.get(name);
		if (existing) {
			diagnostics.push({
				type: "collision",
				message: `name "${name}" collision`,
				path: theme.sourcePath,
				collision: {
					resourceType: "theme",
					name,
					winnerPath: existing.sourcePath ?? "<builtin>",
					loserPath: theme.sourcePath ?? "<builtin>",
				},
			});
		} else seen.set(name, theme);
	}
	return { themes: Array.from(seen.values()), diagnostics };
}
