import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createNodeResourceAccess, type NodeResourceAccess } from "./resource-access.js";

const DEFAULT_NETWORK_TIMEOUT_MS = 10_000;

export interface NodeResourcePackageCommandRunner {
	run(command: string, args: string[], options?: { cwd?: string }): Promise<void>;
}

export class NodeResourcePackageCommands implements NodeResourcePackageCommandRunner {
	run(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
		return new Promise((resolvePromise, reject) => {
			const child = spawn(command, args, {
				cwd: options?.cwd,
				stdio: "inherit",
				shell: process.platform === "win32",
			});
			child.on("error", reject);
			child.on("exit", (code) => {
				if (code === 0) resolvePromise();
				else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
			});
		});
	}
}

export interface NodeResourcePackageFilePort {
	stat(path: string): Promise<{ kind: "file" | "directory" | "other" } | undefined>;
	readText(path: string): Promise<string>;
	ensureDirectory(path: string): Promise<void>;
	ensureTextFile(path: string, content: string): Promise<void>;
	removeTree(path: string): Promise<void>;
	readDirectory(path: string): Promise<readonly string[]>;
}

export class NodeResourcePackageFiles implements NodeResourcePackageFilePort {
	async stat(resourcePath: string): Promise<{ kind: "file" | "directory" | "other" } | undefined> {
		try {
			const info = await stat(resourcePath);
			return { kind: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other" };
		} catch (error) {
			if (isMissingPathError(error)) return undefined;
			throw error;
		}
	}

	readText(resourcePath: string): Promise<string> {
		return readFile(resourcePath, "utf8");
	}

	ensureDirectory(resourcePath: string): Promise<void> {
		return mkdir(resourcePath, { recursive: true }).then(() => undefined);
	}

	async ensureTextFile(resourcePath: string, content: string): Promise<void> {
		if ((await this.stat(resourcePath)) !== undefined) return;
		await this.ensureDirectory(path.dirname(resourcePath));
		try {
			await writeFile(resourcePath, content, { encoding: "utf8", flag: "wx" });
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
		}
	}

	removeTree(resourcePath: string): Promise<void> {
		return rm(resourcePath, { recursive: true, force: true });
	}

	async readDirectory(resourcePath: string): Promise<readonly string[]> {
		try {
			return await readdir(resourcePath);
		} catch (error) {
			if (isMissingPathError(error)) return [];
			throw error;
		}
	}
}

function isMissingPathError(error: unknown): boolean {
	return isFileSystemError(error, "ENOENT") || isFileSystemError(error, "ENOTDIR");
}

function isAlreadyExistsError(error: unknown): boolean {
	return isFileSystemError(error, "EEXIST");
}

function isFileSystemError(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export interface NodeResourcePackageLocationFactsOptions {
	readonly homeDirectory?: string;
	readonly temporaryDirectory?: string;
	readonly globalNpmRoot?: string;
}

export interface NodeResourcePackageLocationFacts {
	readonly homeDirectory: string;
	readonly temporaryDirectory: string;
	readonly getGlobalNpmRoot: () => string;
}

export interface NodeResourcePackageDigest {
	sha256Hex(value: string): string;
}

export const nodeResourcePackageDigest: NodeResourcePackageDigest = {
	sha256Hex: (value) => createHash("sha256").update(value).digest("hex"),
};

export function createNodeResourcePackageLocationFacts(
	options: NodeResourcePackageLocationFactsOptions = {},
): NodeResourcePackageLocationFacts {
	let globalNpmRoot: string | undefined;
	return {
		homeDirectory: options.homeDirectory ?? homedir(),
		temporaryDirectory: options.temporaryDirectory ?? tmpdir(),
		getGlobalNpmRoot: () => {
			globalNpmRoot ??= options.globalNpmRoot ?? resolveGlobalNpmRoot();
			return globalNpmRoot;
		},
	};
}

function resolveGlobalNpmRoot(): string {
	const result = spawnSync("npm", ["root", "-g"], {
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf-8",
		shell: process.platform === "win32",
	});
	if (result.status !== 0) {
		throw new Error(`Failed to resolve global npm root: ${result.stderr || result.stdout}`);
	}
	return (result.stdout || result.stderr || "").trim();
}

export interface NpmResourcePackageRegistryOptions {
	readonly fetch?: typeof fetch;
	readonly timeoutMs?: number;
}

export class NpmResourcePackageRegistry {
	private readonly fetch: typeof fetch;
	private readonly timeoutMs: number;

	constructor(options: NpmResourcePackageRegistryOptions = {}) {
		this.fetch = options.fetch ?? globalThis.fetch;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
	}

	async getLatestVersion(packageName: string): Promise<string> {
		const response = await this.fetch(`https://registry.npmjs.org/${packageName}/latest`, {
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (!response.ok) throw new Error(`Failed to fetch npm registry: ${response.status}`);
		const data = (await response.json()) as { version: string };
		return data.version;
	}
}

export interface NodeResourcePackageEnvironmentOptions {
	readonly env?: Readonly<Record<string, string | undefined>>;
}

export class NodeResourcePackageEnvironment {
	private readonly env: Readonly<Record<string, string | undefined>>;

	constructor(options: NodeResourcePackageEnvironmentOptions = {}) {
		this.env = options.env ?? process.env;
	}

	isOffline(): boolean {
		const value = this.env.PI_OFFLINE;
		return Boolean(value && (value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes"));
	}
}

export interface NodeResourcePackageHost {
	readonly commands: NodeResourcePackageCommands;
	readonly digest: NodeResourcePackageDigest;
	readonly locationFacts: NodeResourcePackageLocationFacts;
	readonly resourceAccess: NodeResourceAccess;
	readonly files: NodeResourcePackageFiles;
	readonly registry: NpmResourcePackageRegistry;
	readonly environment: NodeResourcePackageEnvironment;
}

/** Creates the concrete Node services required by a resource package runtime. */
export function createNodeResourcePackageHost(): NodeResourcePackageHost {
	return {
		commands: new NodeResourcePackageCommands(),
		digest: nodeResourcePackageDigest,
		locationFacts: createNodeResourcePackageLocationFacts(),
		resourceAccess: createNodeResourceAccess(),
		files: new NodeResourcePackageFiles(),
		registry: new NpmResourcePackageRegistry(),
		environment: new NodeResourcePackageEnvironment(),
	};
}
