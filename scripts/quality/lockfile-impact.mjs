import ts from "typescript";

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const PACKAGE_CONTEXT_CACHES = new WeakMap();
const PACKAGE_ENTRY_CACHES = new WeakMap();

function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalize(value[key])]),
	);
}

function canonicalStringify(value) {
	return JSON.stringify(canonicalize(value));
}

function parseBunLock(text, label) {
	const parsed = ts.parseConfigFileTextToJson(label, text);
	if (parsed.error) {
		const message = ts.flattenDiagnosticMessageText(parsed.error.messageText, " ");
		throw new Error(`cannot parse bun.lock (${label}): ${message}`);
	}
	const lock = parsed.config;
	if (!lock || typeof lock !== "object" || !lock.workspaces || !lock.packages) {
		throw new Error(`cannot parse bun.lock (${label}): workspaces or packages map is missing`);
	}
	return lock;
}

function dependencyEntries(record) {
	if (!record || typeof record !== "object") return [];
	return DEPENDENCY_SECTIONS.flatMap((section) =>
		Object.entries(record[section] ?? {}).map(([name, specifier]) => ({ name, section, specifier })),
	);
}

function packageContexts(packageKey, packages, packageKeys) {
	if (!packageKey) return [];
	let cache = PACKAGE_CONTEXT_CACHES.get(packages);
	if (!cache) {
		cache = new Map();
		PACKAGE_CONTEXT_CACHES.set(packages, cache);
	}
	const cached = cache.get(packageKey);
	if (cached) return cached;
	const contexts = [
		packageKey,
		...packageKeys
			.filter((candidate) => candidate !== packageKey && packageKey.startsWith(`${candidate}/`))
			.sort((left, right) => right.length - left.length),
	];
	cache.set(packageKey, contexts);
	return contexts;
}

function resolvePackageKey(dependencyName, parentKey, packages, packageKeys) {
	for (const context of packageContexts(parentKey, packages, packageKeys)) {
		const nested = `${context}/${dependencyName}`;
		if (Object.hasOwn(packages, nested)) return nested;
	}
	return Object.hasOwn(packages, dependencyName) ? dependencyName : null;
}

function canonicalPackageEntry(packages, packageKey) {
	let cache = PACKAGE_ENTRY_CACHES.get(packages);
	if (!cache) {
		cache = new Map();
		PACKAGE_ENTRY_CACHES.set(packages, cache);
	}
	if (!cache.has(packageKey)) cache.set(packageKey, canonicalStringify(packages[packageKey]));
	return cache.get(packageKey);
}

function workspacePathFromPackageEntry(entry) {
	const resolution = Array.isArray(entry) ? entry[0] : null;
	if (typeof resolution !== "string") return null;
	const marker = "@workspace:";
	const markerIndex = resolution.lastIndexOf(marker);
	return markerIndex === -1 ? null : resolution.slice(markerIndex + marker.length).replaceAll("\\", "/");
}

function workspaceFingerprint(lock, workspaceDir) {
	const records = new Map();
	const visitedPackages = new Set();
	const visitedWorkspaces = new Set();
	const packages = lock.packages;
	const packageKeys = Object.keys(packages);

	const visitDependencies = (record, parentKey) => {
		for (const { name, section, specifier } of dependencyEntries(record)) {
			const packageKey = resolvePackageKey(name, parentKey, packages, packageKeys);
			if (packageKey) visitPackage(packageKey);
			else records.set(`unresolved:${parentKey ?? "workspace"}:${section}:${name}`, canonicalStringify(specifier));
		}
	};

	const visitWorkspace = (dir) => {
		if (visitedWorkspaces.has(dir)) return;
		visitedWorkspaces.add(dir);
		const workspace = lock.workspaces[dir];
		if (!workspace || typeof workspace !== "object") {
			records.set(`workspace:${dir}`, "missing");
			return;
		}
		const dependencyContract = Object.fromEntries(
			DEPENDENCY_SECTIONS.filter((section) => workspace[section]).map((section) => [section, workspace[section]]),
		);
		records.set(`workspace:${dir}`, canonicalStringify(dependencyContract));
		visitDependencies(workspace, workspace.name);
	};

	function visitPackage(packageKey) {
		if (visitedPackages.has(packageKey)) return;
		visitedPackages.add(packageKey);
		const entry = packages[packageKey];
		records.set(`package:${packageKey}`, canonicalPackageEntry(packages, packageKey));
		const linkedWorkspace = workspacePathFromPackageEntry(entry);
		if (linkedWorkspace) {
			visitWorkspace(linkedWorkspace);
			return;
		}
		const metadata = Array.isArray(entry) && entry[2] && typeof entry[2] === "object" ? entry[2] : null;
		visitDependencies(metadata, packageKey);
	}

	visitWorkspace(workspaceDir);
	return [...records.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}\0${value}`)
		.join("\n");
}

export function changedLockfileWorkspaceKeys(beforeText, afterText, workspaces) {
	const before = parseBunLock(beforeText, "base bun.lock");
	const after = parseBunLock(afterText, "current bun.lock");
	for (const { dir } of workspaces) {
		if (!Object.hasOwn(after.workspaces, dir)) {
			throw new Error(`cannot analyze bun.lock: current lockfile is missing workspace ${dir}`);
		}
	}
	return workspaces
		.filter(({ dir }) => workspaceFingerprint(before, dir) !== workspaceFingerprint(after, dir))
		.map(({ key }) => key);
}
