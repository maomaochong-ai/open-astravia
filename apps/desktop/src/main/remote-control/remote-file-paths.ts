import { fileURLToPath } from "node:url";
import { formatSshProjectUri, isSshProjectUri, parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import { RemoteOperationError } from "./remote-error-mapping.js";

/**
 * Paths the phone names a desktop file by (ADR-0139).
 *
 * The phone hands over whatever the assistant wrote, or a path the desktop gave
 * it earlier, and the desktop resolves it against the session's working
 * directory the way clicking a link in the chat does. Every path going back is
 * in canonical form: relative inside the working directory, `~/…` under the
 * home directory, absolute elsewhere. The working directory itself never
 * crosses the wire.
 */

/** The `node:path` flavour the host runs on; injected so tests cover both. */
export interface RemotePathFlavor {
	readonly sep: string;
	isAbsolute(path: string): boolean;
	resolve(...paths: string[]): string;
	relative(from: string, to: string): string;
}

export interface RemotePathContext {
	/** The session's working directory: a local path or an `ssh://` project URI. */
	readonly cwd: string;
	readonly home: string;
	readonly path: RemotePathFlavor;
}

function decode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** Strips what markdown and models wrap a destination in, and turns `file://` into a path. */
function unwrap(input: string): string {
	let value = input.trim();
	if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
	if (/^file:\/\//i.test(value)) {
		try {
			return fileURLToPath(value);
		} catch {
			// `file:///C:/x` on a POSIX host, or a malformed URL: keep the path part.
			const stripped = decode(value.replace(/^file:\/\//i, ""));
			return /^\/[A-Za-z]:/.test(stripped) ? stripped.slice(1) : stripped;
		}
	}
	return decode(value);
}

function isWithin(flavor: RemotePathFlavor, root: string, target: string): boolean {
	const rel = flavor.relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !flavor.isAbsolute(rel));
}

function toSlashes(flavor: RemotePathFlavor, value: string): string {
	return flavor.sep === "/" ? value : value.split(flavor.sep).join("/");
}

/** POSIX join that folds `.` and `..`, since the remote allowlist rejects any `..` it sees. */
function remoteJoin(base: string, relative: string): string {
	const parts: string[] = [];
	for (const part of `${base}/${relative}`.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
}

function remoteWithin(root: string, target: string): boolean {
	return root === "/" || target === root || target.startsWith(`${root}/`);
}

/**
 * Resolves what the phone sent to a local absolute path or an `ssh://` URI.
 * Throws `forbidden` for forms a remote project cannot serve (`~`, other hosts).
 */
export function resolveRemoteFileTarget(input: string, context: RemotePathContext): string {
	const value = unwrap(input);
	const { cwd, home, path } = context;
	if (isSshProjectUri(cwd)) {
		const project = parseProjectLocation(cwd);
		if (project.kind !== "ssh") throw new RemoteOperationError("forbidden", "Path is not readable from the phone");
		if (isSshProjectUri(value)) {
			const target = parseProjectLocation(value);
			if (target.kind !== "ssh" || target.hostId !== project.hostId) {
				throw new RemoteOperationError("forbidden", "Path is not readable from the phone");
			}
			return formatSshProjectUri(project.hostId, remoteJoin(target.remotePath, ""));
		}
		// `~` would mean the remote user's home, which the remote allowlist never covers.
		if (value === "~" || value.startsWith("~/")) {
			throw new RemoteOperationError("forbidden", "Path is not readable from the phone");
		}
		const posixValue = value.replace(/\\/g, "/");
		const remotePath = posixValue.startsWith("/")
			? remoteJoin(posixValue, "")
			: remoteJoin(project.remotePath, posixValue);
		return formatSshProjectUri(project.hostId, remotePath);
	}
	if (value === "~") return home;
	if (value.startsWith("~/")) return path.resolve(home, value.slice(2));
	// A leading slash before a drive letter comes from `/C:/x` style links.
	const local = /^\/[A-Za-z]:/.test(value) ? value.slice(1) : value;
	return path.isAbsolute(local) ? path.resolve(local) : path.resolve(cwd, local);
}

/** The form a resolved target travels back to the phone in. */
export function canonicalRemoteFilePath(target: string, context: RemotePathContext): string {
	const { cwd, path } = context;
	if (isSshProjectUri(target)) {
		const location = parseProjectLocation(target);
		const project = parseProjectLocation(cwd);
		if (location.kind !== "ssh") return target;
		if (project.kind === "ssh" && remoteWithin(project.remotePath, location.remotePath)) {
			return location.remotePath.slice(project.remotePath.length).replace(/^\//, "");
		}
		return location.remotePath;
	}
	if (!isSshProjectUri(cwd) && isWithin(path, cwd, target)) return toSlashes(path, path.relative(cwd, target));
	return displayRemoteFilePath(target, context);
}

/** Where the file lives, for showing: the home directory abbreviated to `~`. */
export function displayRemoteFilePath(target: string, context: RemotePathContext): string {
	const { home, path } = context;
	if (isSshProjectUri(target)) {
		const location = parseProjectLocation(target);
		return location.kind === "ssh" ? location.remotePath : target;
	}
	if (isWithin(path, home, target)) {
		const rel = toSlashes(path, path.relative(home, target));
		return rel ? `~/${rel}` : "~";
	}
	return toSlashes(path, target);
}

/** Whether a target lies inside the session's working directory, the only place the phone may list. */
export function isInsideSessionDirectory(target: string, context: RemotePathContext): boolean {
	const { cwd, path } = context;
	if (isSshProjectUri(cwd) !== isSshProjectUri(target)) return false;
	if (isSshProjectUri(cwd)) {
		const project = parseProjectLocation(cwd);
		const location = parseProjectLocation(target);
		return (
			project.kind === "ssh" &&
			location.kind === "ssh" &&
			project.hostId === location.hostId &&
			remoteWithin(project.remotePath, location.remotePath)
		);
	}
	return isWithin(path, cwd, target);
}

/** Directory names that hold credentials wherever they appear. */
const SECRET_DIRECTORIES = new Set([".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker"]);

/** Entries directly under the home directory that hold credentials. */
const HOME_SECRETS = [
	".config/gcloud",
	".config/gh",
	".netrc",
	".git-credentials",
	".npmrc",
	".pypirc",
	"Library/Keychains",
	"Library/Cookies",
];

/** Under `~/.vetta` only these hold things the phone should see: session workspaces, uploads, knowledge. */
const VETTA_READABLE = new Set(["conversation", "workspace", "im-gateway", "knowledges", "remote-uploads"]);

function segments(value: string): string[] {
	return value.split(/[\\/]+/).filter(Boolean);
}

/**
 * The sensitive locations the phone may never read, even where the desktop's own
 * preview may (ADR-0139). Checked against the path as named and, for local
 * files, against where its symlinks lead.
 */
export function isBlockedForPhone(target: string, context: Pick<RemotePathContext, "home" | "path">): boolean {
	if (isSshProjectUri(target)) {
		const location = parseProjectLocation(target);
		const parts = location.kind === "ssh" ? segments(location.remotePath) : segments(target);
		return parts.some((part) => SECRET_DIRECTORIES.has(part));
	}
	const { home, path } = context;
	if (segments(target).some((part) => SECRET_DIRECTORIES.has(part))) return true;
	if (!isWithin(path, home, target)) return false;
	const rel = segments(path.relative(home, target));
	const relText = rel.join("/");
	if (HOME_SECRETS.some((secret) => relText === secret || relText.startsWith(`${secret}/`))) return true;
	if (rel[0] === ".vetta") return rel.length < 2 || !VETTA_READABLE.has(rel[1] ?? "");
	return false;
}
