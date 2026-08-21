import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];

vi.mock("node:child_process", () => ({
	spawn: (command: string, args: string[], options: Record<string, unknown>) => {
		spawnCalls.push({ command, args, options });
		const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
		const stdin = new PassThrough();
		child.pid = 4321;
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.stdin = stdin;
		// The manager waits for a real exit during stop(); emit one so the
		// fake child does not hold the test open.
		child.kill = () => {
			setImmediate(() => child.emit("exit", 0, null));
			return true;
		};
		stdin.on("finish", () => setImmediate(() => child.emit("exit", 0, null)));
		child.exitCode = null;
		return child;
	},
}));

const { SidecarManager } = await import("./sidecar-manager.js");

function baseConfig() {
	return {
		binaryPath: "/tmp/im-gateway",
		conversationCwd: "/tmp/conversation",
		state: [],
		discord: { botToken: "tok" },
	};
}

afterEach(() => {
	spawnCalls.length = 0;
});

/**
 * The Go sidecar reads proxy settings from its environment only. Losing the
 * resolved proxy on the way to spawn() is invisible until the bridge fails
 * to reach the platform, so pin the wiring here.
 */
describe("sidecar 进程的代理环境", () => {
	it("把解析出的代理变量传给子进程", async () => {
		const manager = new SidecarManager({ readyTimeoutMs: 5_000, shutdownGraceMs: 50, backoffMs: [10] });
		await manager.start({
			...baseConfig(),
			proxyEnv: { HTTPS_PROXY: "http://127.0.0.1:7890", NO_PROXY: "127.0.0.1,localhost" },
		});

		const env = spawnCalls.at(-1)?.options.env as NodeJS.ProcessEnv;
		expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
		expect(env.NO_PROXY).toBe("127.0.0.1,localhost");
		await manager.stop();
	});

	it("仍然继承父进程环境，不是只给代理变量", async () => {
		process.env.VETTA_PROXY_ENV_PROBE = "inherited";
		const manager = new SidecarManager({ readyTimeoutMs: 5_000, shutdownGraceMs: 50, backoffMs: [10] });
		await manager.start({ ...baseConfig(), proxyEnv: { HTTPS_PROXY: "http://127.0.0.1:7890" } });

		const env = spawnCalls.at(-1)?.options.env as NodeJS.ProcessEnv;
		expect(env.VETTA_PROXY_ENV_PROBE).toBe("inherited");
		delete process.env.VETTA_PROXY_ENV_PROBE;
		await manager.stop();
	});

	it("没有代理时不注入额外变量", async () => {
		const manager = new SidecarManager({ readyTimeoutMs: 5_000, shutdownGraceMs: 50, backoffMs: [10] });
		await manager.start(baseConfig());

		const env = spawnCalls.at(-1)?.options.env as NodeJS.ProcessEnv;
		expect(env.HTTPS_PROXY).toBeUndefined();
		await manager.stop();
	});
});
