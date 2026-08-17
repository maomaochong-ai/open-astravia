import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { getVettaConfigDirName } from "@vetta/action-rpc";
import type { RuntimeSandboxGrantStore } from "@vetta/runtime-core";
import type {
	SandboxPermissionCapability,
	SandboxPermissionRequest,
	SandboxSessionGrantEntry,
	SandboxShellGrant,
} from "@vetta/runtime-core/sandbox";

interface SandboxShellGrantContext {
	cwd: string;
	grant: SandboxShellGrant;
}

const shellGrantStorage = new AsyncLocalStorage<SandboxShellGrantContext>();

// =============================================================================
// Session-scoped sandbox grant cache ("don't ask again this session")
// =============================================================================

const sessionGrantStore = new Map<string, SandboxSessionGrantEntry[]>();

function normalizeRoot(root: string): string {
	return resolvePath(root);
}

function buildEntryKey(toolName: string, capability: SandboxPermissionCapability, grantRoot: string): string {
	return `${toolName}::${capability}::${normalizeRoot(grantRoot)}`;
}

export function findSessionGrant(
	sessionId: string,
	request: SandboxPermissionRequest,
): SandboxSessionGrantEntry | undefined {
	if (!sessionId) return undefined;
	const entries = sessionGrantStore.get(sessionId);
	if (!entries || entries.length === 0) return undefined;
	const targetRoot = request.grantRoot ? normalizeRoot(request.grantRoot) : normalizeRoot(request.resolvedTarget);
	for (const entry of entries) {
		if (entry.toolName !== request.toolName) continue;
		if (entry.capability !== request.capability) continue;
		// Cached grant covers the request when target falls inside the cached root.
		if (isPathInsideRoot(targetRoot, entry.grantRoot)) return entry;
		// Tool-side computed grantRoot may be a parent of cached root — e.g. when
		// the original cache entry was a file's dirname and the new request is
		// already that exact file. Honor exact-equality too.
		if (entry.grantRoot === targetRoot) return entry;
	}
	return undefined;
}

export function addSessionGrant(sessionId: string, request: SandboxPermissionRequest): SandboxSessionGrantEntry {
	const grantRoot = normalizeRoot(request.grantRoot ?? request.resolvedTarget);
	const key = buildEntryKey(request.toolName, request.capability, grantRoot);
	const entries = sessionGrantStore.get(sessionId) ?? [];
	for (const existing of entries) {
		if (buildEntryKey(existing.toolName, existing.capability, existing.grantRoot) === key) {
			return existing;
		}
	}
	const entry: SandboxSessionGrantEntry = {
		id: randomUUID(),
		sessionId,
		toolName: request.toolName,
		capability: request.capability,
		grantRoot,
		firstTarget: request.target,
		createdAt: Date.now(),
	};
	entries.push(entry);
	sessionGrantStore.set(sessionId, entries);
	return entry;
}

export function listSessionGrants(sessionId: string): SandboxSessionGrantEntry[] {
	const entries = sessionGrantStore.get(sessionId);
	return entries ? entries.slice() : [];
}

export function revokeSessionGrant(sessionId: string, entryId: string): boolean {
	const entries = sessionGrantStore.get(sessionId);
	if (!entries) return false;
	const idx = entries.findIndex((e) => e.id === entryId);
	if (idx < 0) return false;
	entries.splice(idx, 1);
	if (entries.length === 0) sessionGrantStore.delete(sessionId);
	return true;
}

export function revokeAllSessionGrants(sessionId: string): number {
	const entries = sessionGrantStore.get(sessionId);
	if (!entries) return 0;
	const count = entries.length;
	sessionGrantStore.delete(sessionId);
	return count;
}

export function clearSessionGrants(sessionId: string): void {
	sessionGrantStore.delete(sessionId);
}

export const nodeSandboxGrantStore: RuntimeSandboxGrantStore = {
	list: listSessionGrants,
	revoke: revokeSessionGrant,
	revokeAll: revokeAllSessionGrants,
	clear: clearSessionGrants,
};

function expandHome(inputPath: string): string {
	if (inputPath === "~") return homedir();
	if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) return resolvePath(homedir(), inputPath.slice(2));
	return inputPath;
}

export function resolveSandboxPath(inputPath: string, cwd: string): string {
	const expanded = expandHome(inputPath.trim());
	return isAbsolute(expanded) ? resolvePath(expanded) : resolvePath(cwd, expanded);
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
	const normalizedTarget =
		process.platform === "win32" ? resolvePath(targetPath).toLowerCase() : resolvePath(targetPath);
	const normalizedRoot = process.platform === "win32" ? resolvePath(rootPath).toLowerCase() : resolvePath(rootPath);
	const rel = relative(normalizedRoot, normalizedTarget);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Device pseudo-files that are always safe to write to. They are not real files
// and have no security impact; treating them like out-of-workspace writes would
// flag every `2>/dev/null` redirection as a grant request.
const SHELL_WRITE_DEVICE_NULLS = new Set([
	"/dev/null",
	"/dev/stdout",
	"/dev/stderr",
	"/dev/zero",
	"/dev/tty",
	"/dev/fd",
]);

function isShellWriteDeviceNull(targetPath: string): boolean {
	if (SHELL_WRITE_DEVICE_NULLS.has(targetPath)) return true;
	// /dev/fd/N, /dev/null/anything are still OS-managed and harmless.
	return targetPath.startsWith("/dev/fd/");
}

function isAllowedSandboxPath(targetPath: string, cwd: string): boolean {
	if (isShellWriteDeviceNull(targetPath)) return true;
	const allowedRoots = [cwd, tmpdir(), "/tmp", "/private/tmp"];
	return allowedRoots.some((root) => isPathInsideRoot(targetPath, root));
}

export function getSandboxDenyRoots(): string[] {
	const homeDir = homedir();
	const roots = [
		join(homeDir, ".ssh"),
		join(homeDir, ".aws"),
		join(homeDir, ".gnupg"),
		join(homeDir, ".kube"),
		join(homeDir, ".docker"),
		join(homeDir, getVettaConfigDirName(), "agent"),
		join(homeDir, ".pi"),
	];
	if (process.platform === "darwin") {
		roots.push(join(homeDir, ".config", "gcloud"), join(homeDir, "Library", "Keychains"));
	}
	if (process.platform === "win32") {
		const appData = process.env.APPDATA;
		if (appData) roots.push(join(appData, "gcloud"), join(appData, "Vetta"));
	}
	return Array.from(new Set(roots.map((root) => resolvePath(root))));
}

export function isDeniedSandboxPath(targetPath: string): boolean {
	return getSandboxDenyRoots().some((root) => isPathInsideRoot(targetPath, root));
}

export function assertSandboxPathNotDenied(targetPath: string, toolName: string): void {
	if (!isDeniedSandboxPath(targetPath)) return;
	throw new Error(
		`Access denied by sandbox: "${targetPath}" is in a sensitive sandbox deny path for tool "${toolName}".`,
	);
}

function shouldSkipShellPath(rawPath: string): boolean {
	const trimmed = rawPath.trim();
	if (trimmed.length === 0) return true;
	return /[$`*?[\]{}()]/.test(trimmed);
}

function unquoteShellToken(token: string): string {
	const trimmed = token.trim();
	if (trimmed.length < 2) return trimmed;
	const quote = trimmed[0];
	if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function collectRegexPathMatches(command: string, regex: RegExp): string[] {
	const matches: string[] = [];
	let match = regex.exec(command);
	while (match !== null) {
		const rawPath = match[1] ?? match[2] ?? match[3];
		if (rawPath) matches.push(unquoteShellToken(rawPath));
		match = regex.exec(command);
	}
	return matches;
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values));
}

// Write-ish commands whose positional (non-flag) arguments are write targets.
// Conservative over-trigger is fine: a false positive just shows a confirm dialog.
const SHELL_WRITE_COMMANDS = new Set([
	"cp",
	"mv",
	"rm",
	"mkdir",
	"rmdir",
	"touch",
	"ln",
	"install",
	"dd",
	"chmod",
	"chown",
	"chgrp",
	"truncate",
]);

// In-place editing tools — only treat positional args as writes when -i flag present.
const SHELL_INPLACE_COMMANDS = new Set(["sed", "perl", "gawk", "awk"]);

function splitShellSegments(command: string): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote) {
			if (ch === "\\" && command[i + 1]) {
				current += ch + command[i + 1];
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "\\" && command[i + 1]) {
			current += ch + command[i + 1];
			i++;
			continue;
		}
		const two = command.slice(i, i + 2);
		if (two === "&&" || two === "||") {
			parts.push(current);
			current = "";
			i++;
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "&" || ch === "\n") {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	if (current) parts.push(current);
	return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function tokenizeShellSegment(segment: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;
	let hadAny = false;
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];
		if (quote) {
			if (ch === "\\" && segment[i + 1]) {
				current += segment[i + 1];
				i++;
				continue;
			}
			if (ch === quote) {
				quote = null;
				continue;
			}
			current += ch;
			hadAny = true;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			hadAny = true;
			continue;
		}
		if (ch === "\\" && segment[i + 1]) {
			current += segment[i + 1];
			hadAny = true;
			i++;
			continue;
		}
		if (/\s/.test(ch)) {
			if (hadAny) {
				tokens.push(current);
				current = "";
				hadAny = false;
			}
			continue;
		}
		current += ch;
		hadAny = true;
	}
	if (hadAny) tokens.push(current);
	return tokens;
}

function stripEnvAssignments(tokens: string[]): string[] {
	let i = 0;
	while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
	return tokens.slice(i);
}

function basenameOfBinary(binary: string): string {
	const idx = Math.max(binary.lastIndexOf("/"), binary.lastIndexOf("\\"));
	return idx >= 0 ? binary.slice(idx + 1) : binary;
}

function isFlagToken(token: string): boolean {
	return token.startsWith("-");
}

function collectCommandWriteTargets(segment: string): string[] {
	const tokens = stripEnvAssignments(tokenizeShellSegment(segment));
	if (tokens.length === 0) return [];
	const binary = basenameOfBinary(tokens[0]);
	const args = tokens.slice(1);

	if (SHELL_WRITE_COMMANDS.has(binary)) {
		return args.filter((arg) => !isFlagToken(arg));
	}
	if (SHELL_INPLACE_COMMANDS.has(binary)) {
		const hasInPlace = args.some((arg) => arg === "-i" || arg.startsWith("-i") || arg === "--in-place");
		if (!hasInPlace) return [];
		return args.filter((arg) => !isFlagToken(arg));
	}
	return [];
}

export function collectShellWritePermissionRequests(command: string, cwd: string): SandboxPermissionRequest[] {
	const redirectPaths = collectRegexPathMatches(
		command,
		/(?:^|[\s;&|])(?:\d?>|\d?>>|&>|>|>>)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g,
	);
	const teePaths = collectRegexPathMatches(
		command,
		/(?:^|[\s;&|])tee(?:\s+-[a-zA-Z]+)*\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g,
	);

	const commandPaths: string[] = [];
	for (const segment of splitShellSegments(command)) {
		for (const target of collectCommandWriteTargets(segment)) {
			commandPaths.push(target);
		}
	}

	return unique([...redirectPaths, ...teePaths, ...commandPaths])
		.filter((rawPath) => !shouldSkipShellPath(rawPath))
		.map((rawPath) => {
			const resolvedTarget = resolveSandboxPath(rawPath, cwd);
			assertSandboxPathNotDenied(resolvedTarget, "shell");
			const grantRoot = dirname(resolvedTarget);
			return { rawPath, resolvedTarget, grantRoot };
		})
		.filter(({ resolvedTarget }) => !isAllowedSandboxPath(resolvedTarget, cwd))
		.map(({ rawPath, resolvedTarget, grantRoot }) => ({
			capability: "file.write",
			toolName: "shell",
			target: rawPath,
			resolvedTarget,
			grantRoot,
			reason: "shell command writes outside the workspace sandbox",
			command,
		}));
}

export function runWithSandboxShellGrant<T>(
	cwd: string,
	grant: SandboxShellGrant,
	callback: () => Promise<T>,
): Promise<T> {
	return shellGrantStorage.run({ cwd: resolvePath(cwd), grant }, callback);
}

export function getSandboxShellGrant(cwd: string): SandboxShellGrant | undefined {
	const context = shellGrantStorage.getStore();
	if (!context || context.cwd !== resolvePath(cwd)) return undefined;
	return context.grant;
}
