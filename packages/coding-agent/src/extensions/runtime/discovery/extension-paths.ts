import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "../../../config.js";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

interface ExtensionManifest {
	extensions?: string[];
}

export function resolveExtensionPath(extensionPath: string, cwd: string): string {
	const normalized = extensionPath.replace(UNICODE_SPACES, " ");
	const expanded = normalized.startsWith("~/")
		? path.join(os.homedir(), normalized.slice(2))
		: normalized.startsWith("~")
			? path.join(os.homedir(), normalized.slice(1))
			: normalized;
	return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

function readExtensionManifest(packageJsonPath: string): ExtensionManifest | null {
	try {
		const packageJson: unknown = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
		if (!packageJson || typeof packageJson !== "object" || !("pi" in packageJson)) return null;
		const pi = packageJson.pi;
		return pi && typeof pi === "object" ? (pi as ExtensionManifest) : null;
	} catch {
		return null;
	}
}

function resolveExtensionEntries(directory: string): string[] | null {
	const packageJsonPath = path.join(directory, "package.json");
	if (fs.existsSync(packageJsonPath)) {
		const manifest = readExtensionManifest(packageJsonPath);
		if (manifest?.extensions?.length) {
			const entries = manifest.extensions
				.map((entry) => path.resolve(directory, entry))
				.filter((entry) => fs.existsSync(entry));
			if (entries.length > 0) return entries;
		}
	}

	const indexTs = path.join(directory, "index.ts");
	if (fs.existsSync(indexTs)) return [indexTs];
	const indexJs = path.join(directory, "index.js");
	return fs.existsSync(indexJs) ? [indexJs] : null;
}

function discoverExtensionsInDirectory(directory: string): string[] {
	if (!fs.existsSync(directory)) return [];
	const discovered: string[] = [];
	try {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if ((entry.isFile() || entry.isSymbolicLink()) && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
				discovered.push(entryPath);
				continue;
			}
			if (entry.isDirectory() || entry.isSymbolicLink()) {
				const entries = resolveExtensionEntries(entryPath);
				if (entries) discovered.push(...entries);
			}
		}
	} catch {
		return [];
	}
	return discovered;
}

export function discoverExtensionPaths(configuredPaths: string[], cwd: string, agentDir: string): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	const addPaths = (candidates: string[]) => {
		for (const candidate of candidates) {
			const identity = path.resolve(candidate);
			if (seen.has(identity)) continue;
			seen.add(identity);
			paths.push(candidate);
		}
	};

	addPaths(discoverExtensionsInDirectory(path.join(cwd, CONFIG_DIR_NAME, "extensions")));
	addPaths(discoverExtensionsInDirectory(path.join(agentDir, "extensions")));

	for (const configuredPath of configuredPaths) {
		const resolved = resolveExtensionPath(configuredPath, cwd);
		if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
			const entries = resolveExtensionEntries(resolved);
			addPaths(entries ?? discoverExtensionsInDirectory(resolved));
			continue;
		}
		addPaths([resolved]);
	}

	return paths;
}
