import { createConnection } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSshAskpassChannel, type SshAskpassChannel } from "./askpass-server.js";

async function roundtrip(
	channel: SshAskpassChannel,
	payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	return new Promise((resolvePromise, rejectPromise) => {
		const socket = createConnection({ host: "127.0.0.1", port: Number(channel.socketPath.split(":").pop()) });
		let buffer = "";
		socket.on("error", rejectPromise);
		socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			if (buffer.includes("\n")) {
				socket.end();
				resolvePromise(JSON.parse(buffer.trim()) as Record<string, unknown>);
			}
		});
	});
}

describe("Windows askpass 回传通道（TCP loopback）", () => {
	let channel: SshAskpassChannel;

	afterEach(() => channel?.close());

	it("win32 下监听 127.0.0.1，socketPath 是 host:port", async () => {
		channel = await createSshAskpassChannel(async () => ({ ok: true, value: "pw" }), "win32");
		expect(channel.socketPath).toMatch(/^127\.0\.0\.1:\d+$/);
	});

	it("token 匹配时把提示交给 resolver，答案经 TCP 回传", async () => {
		const resolve = async () => ({ ok: true as const, value: "pw" });
		channel = await createSshAskpassChannel(resolve, "win32");
		const reply = await roundtrip(channel, {
			token: channel.token,
			hostId: "h1",
			prompt: "root@host's password: ",
		});
		expect(reply).toEqual({ ok: true, value: "pw" });
	});

	it("token 不对时拒绝，resolver 不被调用", async () => {
		let called = false;
		channel = await createSshAskpassChannel(async () => {
			called = true;
			return { ok: true, value: "pw" };
		}, "win32");
		const reply = await roundtrip(channel, { token: "wrong", hostId: "h1", prompt: "password: " });
		expect(reply).toEqual({ ok: false });
		expect(called).toBe(false);
	});
});
