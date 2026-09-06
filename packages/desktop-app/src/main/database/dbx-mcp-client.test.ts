import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mock node:child_process.spawn —— 单元测试不拉起真实 dbx-mcp 二进制。
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// mock 二进制路径解析:spawn 已被 mock,路径不再参与执行。
vi.mock("../mcp/dbx-mcp-path.js", () => ({
	resolveDbxMcpBinaryPath: () => "/fake/dbx-mcp",
}));

import { DbxMcpClient } from "./dbx-mcp-client.js";

/** 构造一个可控的假子进程:kill 同步触发 exit,stdout 可手动 emit data。 */
function makeFakeChild() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
		stderr: EventEmitter;
		stdin: { write: ReturnType<typeof vi.fn> };
		kill: ReturnType<typeof vi.fn>;
		killed: boolean;
	};
	child.stdout = new EventEmitter() as (typeof child)["stdout"];
	child.stdout.setEncoding = vi.fn();
	child.stderr = new EventEmitter();
	child.stdin = { write: vi.fn(() => true) };
	child.kill = vi.fn(() => {
		child.killed = true;
		child.emit("exit", 0, null);
		return true;
	});
	child.killed = false;
	return child;
}

/** 让假引擎对 initialize 返回成功 result,使 ensureInitialized resolve。 */
function respondInitializeOk(child: ReturnType<typeof makeFakeChild>): void {
	child.stdout.emit(
		"data",
		`${JSON.stringify({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2024-11-05" } })}\n`,
	);
}

/** 让假引擎对 tools/call 返回成功 result。 */
function respondToolOk(child: ReturnType<typeof makeFakeChild>, id = 1): void {
	child.stdout.emit(
		"data",
		`${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ok" }], isError: false } })}\n`,
	);
}

let client: DbxMcpClient | null = null;

beforeEach(() => {
	spawnMock.mockReset();
});

afterEach(async () => {
	if (client) {
		await client.dispose();
		client = null;
	}
});

describe("DbxMcpClient 握手失败复位(P4-1)", () => {
	it("握手超时后复位,再次 ensureInitialized 会重新 spawn 重试", async () => {
		client = new DbxMcpClient({ handshakeTimeoutMs: 30 });
		const childA = makeFakeChild();
		spawnMock.mockReturnValueOnce(childA);

		const first = client.ensureInitialized();
		await expect(first).rejects.toThrow(/timeout/);
		expect(spawnMock).toHaveBeenCalledTimes(1);

		// 复位后再次调用 → 重新拉起重试(旧实现会复用已拒绝的 promise,spawn 仍为 1 次)。
		const childB = makeFakeChild();
		spawnMock.mockReturnValueOnce(childB);
		const second = client.ensureInitialized();
		expect(spawnMock).toHaveBeenCalledTimes(2);
		respondInitializeOk(childB);
		await expect(second).resolves.toBeUndefined();
	});

	it("initialize 返回 error 后复位可重试", async () => {
		client = new DbxMcpClient({ handshakeTimeoutMs: 1_000 });
		const childA = makeFakeChild();
		spawnMock.mockReturnValueOnce(childA);

		const first = client.ensureInitialized();
		childA.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 0, error: { message: "boom" } })}\n`);
		await expect(first).rejects.toThrow(/boom/);
		expect(spawnMock).toHaveBeenCalledTimes(1);

		const childB = makeFakeChild();
		spawnMock.mockReturnValueOnce(childB);
		const second = client.ensureInitialized();
		expect(spawnMock).toHaveBeenCalledTimes(2);
		respondInitializeOk(childB);
		await expect(second).resolves.toBeUndefined();
	});

	it("spawn error(如 EACCES)后复位,后续调用可重试", async () => {
		client = new DbxMcpClient({ handshakeTimeoutMs: 1_000 });
		const childA = makeFakeChild();
		spawnMock.mockReturnValueOnce(childA);

		const first = client.ensureInitialized();
		childA.emit("error", new Error("EACCES: permission denied"));
		await expect(first).rejects.toThrow(/EACCES/);

		const childB = makeFakeChild();
		spawnMock.mockReturnValueOnce(childB);
		const second = client.ensureInitialized();
		expect(spawnMock).toHaveBeenCalledTimes(2);
		respondInitializeOk(childB);
		await expect(second).resolves.toBeUndefined();
	});
});

describe("DbxMcpClient 跨代 exit 竞态(P4-2)", () => {
	it("dispose 后旧进程 exit 不清新一代引用,新一代仍可完成请求", async () => {
		client = new DbxMcpClient({ handshakeTimeoutMs: 5_000 });
		const childA = makeFakeChild();
		spawnMock.mockReturnValueOnce(childA);
		const first = client.ensureInitialized();

		// dispose 回收 A(置空引用 + kill);在途 initialize 被拒绝。
		await client.dispose();
		await expect(first).rejects.toThrow(/disposed/);

		// 新一代 B 拉起。
		const childB = makeFakeChild();
		spawnMock.mockReturnValueOnce(childB);
		const second = client.ensureInitialized();
		expect(spawnMock).toHaveBeenCalledTimes(2);

		// A 的 exit 回调迟到(已按代过滤)→ B 引用不受影响,请求照常完成。
		childA.emit("exit", 0, null);
		respondInitializeOk(childB);
		await expect(second).resolves.toBeUndefined();

		// B 仍在位:callTool 能正常发出并收到响应。
		// callTool 内部先 await ensureInitialized 才发 request,需等一拍微任务后再回包。
		const toolPromise = client.callTool("echo", {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		respondToolOk(childB);
		respondToolOk(childB);
		await expect(toolPromise).resolves.toMatchObject({ isError: false });
		expect(childB.stdin.write).toHaveBeenCalled();
	});

	it("旧代 exit 只清理自己的在途请求,不误清新代", async () => {
		client = new DbxMcpClient({ handshakeTimeoutMs: 5_000 });
		const childA = makeFakeChild();
		spawnMock.mockReturnValueOnce(childA);
		const first = client.ensureInitialized();

		// A 正常退出(当前代)→ 状态复位。
		childA.emit("exit", 1, null);
		await expect(first).rejects.toThrow(/exited/);
		expect(spawnMock).toHaveBeenCalledTimes(1);

		// 新一代 B。
		const childB = makeFakeChild();
		spawnMock.mockReturnValueOnce(childB);
		const second = client.ensureInitialized();
		expect(spawnMock).toHaveBeenCalledTimes(2);

		// 迟到的 A 二次 exit(竞态残留)不得清理 B。
		childA.emit("exit", 1, null);
		respondInitializeOk(childB);
		await expect(second).resolves.toBeUndefined();
		expect(childB.stdin.write).toHaveBeenCalled();
	});
});
