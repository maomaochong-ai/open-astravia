import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";

export type TestAgentRuntimeBackend = "legacy" | "greenfield" | "greenfield-im";

export interface AgentRpcExecutable {
	readonly path: string;
	dispose(): Promise<void>;
}

export interface AgentRpcFixture {
	readonly root: string;
	readonly agentDir: string;
	readonly workspace: string;
	readonly conversationDir: string;
	dispose(): Promise<void>;
}

export interface CreateAgentRpcFixtureOptions {
	readonly baseUrl?: string;
	readonly api?: "openai-responses";
	readonly contextWindow?: number;
	readonly maxTokens?: number;
	readonly modelInput?: readonly ("text" | "image")[];
}

export interface StartAgentRpcOptions {
	readonly backend?: TestAgentRuntimeBackend | null;
	readonly enableHostBridge?: boolean;
	readonly scenario?: "cli" | "im-claw";
	readonly extraArgs?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
}

export interface RpcFrame {
	readonly [key: string]: unknown;
	readonly type: string;
	readonly id?: string;
	readonly command?: string;
	readonly data?: { readonly [key: string]: unknown };
}

interface FrameWaiter {
	readonly afterIndex: number;
	readonly predicate: (frame: RpcFrame) => boolean;
	readonly resolve: (frame: RpcFrame) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

const sourceEntryPath = fileURLToPath(new URL("../../src/agent-rpc-cli.ts", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const testBundleRoot = join(repositoryRoot, "node_modules", ".cache");

export async function buildAgentRpcExecutable(): Promise<AgentRpcExecutable> {
	await mkdir(testBundleRoot, { recursive: true });
	const directory = await mkdtemp(join(testBundleRoot, "vetta-agent-rpc-"));
	const path = join(directory, "agent-rpc.mjs");
	try {
		await runCommand(
			"bun",
			["build", sourceEntryPath, "--target", "bun", "--external", "@mariozechner/jiti", "--outfile", path],
			repositoryRoot,
		);
		await copyFile(join(repositoryRoot, "packages", "coding-agent", "package.json"), join(directory, "package.json"));
		return {
			path,
			dispose: () => rm(directory, { force: true, recursive: true }),
		};
	} catch (error) {
		await rm(directory, { force: true, recursive: true });
		throw error;
	}
}

export async function createAgentRpcFixture(options: CreateAgentRpcFixtureOptions = {}): Promise<AgentRpcFixture> {
	const root = await mkdtemp(join(tmpdir(), "vetta-agent-rpc-fixture-"));
	const fixture = {
		root,
		agentDir: join(root, "agent"),
		workspace: join(root, "workspace"),
		conversationDir: join(root, "conversations"),
	};
	await Promise.all([
		mkdir(fixture.agentDir, { recursive: true }),
		mkdir(fixture.workspace, { recursive: true }),
		mkdir(fixture.conversationDir, { recursive: true }),
	]);
	await Promise.all([
		writeFile(
			join(fixture.agentDir, "models.json"),
			JSON.stringify({
				providers: {
					test: {
						baseUrl: options.baseUrl ?? "http://127.0.0.1:1",
						api: options.api ?? "openai-responses",
						models: [
							{
								id: "test-model",
								name: "Test Model",
								reasoning: true,
								input: options.modelInput ?? ["text"],
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
								contextWindow: options.contextWindow ?? 8_000,
								maxTokens: options.maxTokens ?? 1_000,
							},
						],
					},
				},
			}),
			"utf8",
		),
		writeFile(
			join(fixture.agentDir, "auth.json"),
			JSON.stringify({ test: { type: "api_key", key: "test-key" } }),
			"utf8",
		),
	]);
	return {
		...fixture,
		dispose: () => rm(root, { force: true, recursive: true }),
	};
}

export function startAgentRpc(
	executable: AgentRpcExecutable,
	fixture: AgentRpcFixture,
	options: StartAgentRpcOptions = {},
): AgentRpcProcess {
	const backend = options.backend === null ? "greenfield" : (options.backend ?? "greenfield-im");
	const enableHostBridge = options.enableHostBridge ?? backend === "greenfield-im";
	const scenario = options.scenario ?? (backend === "greenfield-im" ? "im-claw" : undefined);
	return new AgentRpcProcess(
		spawn(
			"bun",
			[
				executable.path,
				"--mode",
				"rpc",
				...(enableHostBridge ? ["--enable-host-bridge"] : []),
				...(scenario ? ["--scenario", scenario] : []),
				"--session-dir",
				fixture.conversationDir,
				"--provider",
				"test",
				"--model",
				"test-model",
				"--offline",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				...(options.extraArgs ?? []),
			],
			{
				cwd: fixture.workspace,
				env: {
					...process.env,
					VETTA_CODING_AGENT_DIR: fixture.agentDir,
					VETTA_PACKAGE_DIR: join(repositoryRoot, "packages", "coding-agent"),
					...options.env,
				},
				stdio: "pipe",
			},
		),
	);
}

export class AgentRpcProcess {
	readonly child: ChildProcessWithoutNullStreams;
	readonly lines: Interface;
	readonly frames: RpcFrame[] = [];
	stderr = "";
	private readonly waiters = new Set<FrameWaiter>();
	private readonly exitPromise: Promise<number>;
	private parseError: Error | undefined;
	private closed = false;

	constructor(child: ChildProcessWithoutNullStreams) {
		this.child = child;
		this.lines = createInterface({ input: child.stdout });
		this.lines.on("line", (line) => this.acceptLine(line));
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			this.stderr += chunk;
		});
		this.exitPromise = new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) => {
				const error = signal
					? new Error(`RPC child exited with signal ${signal}\n${this.stderr}`)
					: new Error(`RPC child exited before the expected frame (code=${code ?? 1})\n${this.stderr}`);
				for (const waiter of this.waiters) {
					clearTimeout(waiter.timeout);
					waiter.reject(error);
				}
				this.waiters.clear();
				if (signal) reject(error);
				else resolve(code ?? 1);
			});
		});
	}

	mark(): number {
		return this.frames.length;
	}

	framesSince(index: number): readonly RpcFrame[] {
		return this.frames.slice(index);
	}

	send(frame: Readonly<Record<string, unknown>>): void {
		this.child.stdin.write(`${JSON.stringify(frame)}\n`);
	}

	async request(id: string, type: string, data: Readonly<Record<string, unknown>> = {}): Promise<RpcFrame> {
		const afterIndex = this.mark();
		this.send({ id, type, ...data });
		return this.waitFor(
			(frame) => frame.type === "response" && frame.id === id && frame.command === type,
			afterIndex,
		);
	}

	waitFor(predicate: (frame: RpcFrame) => boolean, afterIndex = 0, timeoutMs = 20_000): Promise<RpcFrame> {
		if (this.parseError) return Promise.reject(this.parseError);
		const existing = this.frames.slice(afterIndex).find(predicate);
		if (existing) return Promise.resolve(existing);
		return new Promise<RpcFrame>((resolve, reject) => {
			const waiter: FrameWaiter = {
				afterIndex,
				predicate,
				resolve,
				reject,
				timeout: setTimeout(() => {
					this.waiters.delete(waiter);
					reject(new Error(`Timed out waiting for RPC frame\n${this.stderr}`));
				}, timeoutMs),
			};
			this.waiters.add(waiter);
		});
	}

	waitForExit(): Promise<number> {
		return this.exitPromise;
	}

	async close(): Promise<number> {
		if (this.closed) return this.exitPromise;
		this.closed = true;
		if (this.child.exitCode === null) this.child.stdin.end();
		const timeout = setTimeout(() => this.child.kill(), 10_000);
		const code = await this.exitPromise.finally(() => clearTimeout(timeout));
		this.lines.close();
		return code;
	}

	private acceptLine(line: string): void {
		try {
			const parsed: unknown = JSON.parse(line);
			if (!isRpcFrame(parsed)) throw new Error(`RPC stdout line was not an object: ${line}`);
			const index = this.frames.push(parsed) - 1;
			for (const waiter of this.waiters) {
				if (index < waiter.afterIndex || !waiter.predicate(parsed)) continue;
				clearTimeout(waiter.timeout);
				this.waiters.delete(waiter);
				waiter.resolve(parsed);
			}
		} catch (error) {
			this.parseError = error instanceof Error ? error : new Error(String(error));
			for (const waiter of this.waiters) {
				clearTimeout(waiter.timeout);
				waiter.reject(this.parseError);
			}
			this.waiters.clear();
		}
	}
}

export function readSessionFile(frame: RpcFrame): string {
	const sessionFile = frame.data?.sessionFile;
	if (typeof sessionFile !== "string") throw new Error("Expected RPC state to include sessionFile");
	return sessionFile;
}

export function readSessionId(frame: RpcFrame): string {
	const sessionId = frame.data?.sessionId;
	if (typeof sessionId !== "string") throw new Error("Expected RPC state to include sessionId");
	return sessionId;
}

function isRpcFrame(value: unknown): value is RpcFrame {
	return typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string";
}

async function runCommand(command: string, args: readonly string[], cwd: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`Command failed with code ${code}, signal ${signal}\n${stderr}`));
		});
	});
}
