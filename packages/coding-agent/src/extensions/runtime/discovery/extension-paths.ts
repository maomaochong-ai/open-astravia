import type {
	ResourceAccessPort,
	ResourceDirectoryEntry,
	ResourceEntryKind,
	ResourcePathPort,
} from "../../../resources/contracts/resource-access.js";

const CONFIG_DIRECTORY = ".vetta";
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

interface ExtensionManifest {
	readonly extensions?: readonly string[];
}

export function resolveExtensionPath(paths: ResourcePathPort, extensionPath: string, cwd: string): string {
	const normalized = extensionPath.replace(UNICODE_SPACES, " ");
	const home = paths.homeDirectory();
	const expanded =
		normalized === "~"
			? home
			: normalized.startsWith("~/") || normalized.startsWith("~\\")
				? paths.join(home, normalized.slice(2))
				: normalized.startsWith("~")
					? paths.join(home, normalized.slice(1))
					: normalized;
	return paths.isAbsolute(expanded) ? paths.resolve(expanded) : paths.resolve(cwd, expanded);
}

export async function discoverExtensionPaths(options: {
	readonly resourceAccess: ResourceAccessPort;
	readonly configuredPaths: readonly string[];
	readonly cwd: string;
	readonly agentDir: string;
	readonly signal?: AbortSignal;
}): Promise<string[]> {
	const { resourceAccess: access, signal } = options;
	const discovered: string[] = [];
	const seen = new Set<string>();
	const addPaths = (candidates: readonly string[]): void => {
		for (const candidate of candidates) {
			const identity = access.paths.resolve(candidate);
			if (seen.has(identity)) continue;
			seen.add(identity);
			discovered.push(candidate);
		}
	};

	addPaths(
		await discoverExtensionsInDirectory(
			access,
			access.paths.join(options.cwd, CONFIG_DIRECTORY, "extensions"),
			signal,
		),
	);
	addPaths(await discoverExtensionsInDirectory(access, access.paths.join(options.agentDir, "extensions"), signal));

	for (const configuredPath of options.configuredPaths) {
		const resolved = resolveExtensionPath(access.paths, configuredPath, options.cwd);
		let kind: ResourceEntryKind | undefined;
		try {
			kind = (await access.files.stat(resolved, { signal }))?.kind;
		} catch {
			signal?.throwIfAborted();
		}
		if (kind === "directory") {
			const entries = await resolveExtensionEntries(access, resolved, signal);
			addPaths(entries ?? (await discoverExtensionsInDirectory(access, resolved, signal)));
			continue;
		}
		addPaths([resolved]);
	}

	return discovered;
}

async function discoverExtensionsInDirectory(
	access: ResourceAccessPort,
	directory: string,
	signal?: AbortSignal,
): Promise<string[]> {
	let entries: readonly ResourceDirectoryEntry[];
	try {
		if ((await access.files.stat(directory, { signal }))?.kind !== "directory") return [];
		entries = await access.files.readDirectory(directory, { signal });
	} catch {
		signal?.throwIfAborted();
		return [];
	}

	const discovered: string[] = [];
	for (const entry of entries) {
		const entryPath = access.paths.join(directory, entry.name);
		if ((entry.kind === "file" || entry.symbolicLink) && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
			discovered.push(entryPath);
			continue;
		}
		if (entry.kind === "directory" || entry.symbolicLink) {
			const resolved = await resolveExtensionEntries(access, entryPath, signal);
			if (resolved) discovered.push(...resolved);
		}
	}
	return discovered;
}

async function resolveExtensionEntries(
	access: ResourceAccessPort,
	directory: string,
	signal?: AbortSignal,
): Promise<string[] | undefined> {
	const manifest = await readExtensionManifest(access, access.paths.join(directory, "package.json"), signal);
	if (manifest?.extensions?.length) {
		const entries: string[] = [];
		for (const candidate of manifest.extensions) {
			const resolved = access.paths.resolve(directory, candidate);
			try {
				if (await access.files.stat(resolved, { signal })) entries.push(resolved);
			} catch {
				signal?.throwIfAborted();
			}
		}
		if (entries.length > 0) return entries;
	}

	for (const name of ["index.ts", "index.js"]) {
		const candidate = access.paths.join(directory, name);
		try {
			if ((await access.files.stat(candidate, { signal }))?.kind === "file") return [candidate];
		} catch {
			signal?.throwIfAborted();
		}
	}
	return undefined;
}

async function readExtensionManifest(
	access: ResourceAccessPort,
	manifestPath: string,
	signal?: AbortSignal,
): Promise<ExtensionManifest | undefined> {
	try {
		if ((await access.files.stat(manifestPath, { signal }))?.kind !== "file") return undefined;
		const document: unknown = JSON.parse(await access.files.readText(manifestPath, { signal }));
		if (!document || typeof document !== "object" || !("pi" in document)) return undefined;
		const pi = document.pi;
		if (!pi || typeof pi !== "object" || !("extensions" in pi) || !Array.isArray(pi.extensions)) {
			return undefined;
		}
		return { extensions: pi.extensions.filter((entry): entry is string => typeof entry === "string") };
	} catch {
		signal?.throwIfAborted();
		return undefined;
	}
}
