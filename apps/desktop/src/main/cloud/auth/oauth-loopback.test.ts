import { describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }),
}));

const { ensureLoopbackCallbackUrl, setLoopbackCallbackHandler } = await import("./oauth-loopback.js");

describe("oauth loopback callback", () => {
	it("把 loopback 回调归一化成 vetta:// 形式交给 handler", async () => {
		const received: string[] = [];
		setLoopbackCallbackHandler((url) => received.push(url));

		const callbackUrl = await ensureLoopbackCallbackUrl();
		expect(callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);

		const response = await fetch(`${callbackUrl}?state=s1&access_token=t1&refresh_token=r1`);
		expect(response.status).toBe(200);
		await response.text();

		expect(received).toEqual(["vetta://oauth/callback?state=s1&access_token=t1&refresh_token=r1"]);
	});

	it("复用同一个端口", async () => {
		const first = await ensureLoopbackCallbackUrl();
		expect(await ensureLoopbackCallbackUrl()).toBe(first);
	});

	it("忽略非回调路径", async () => {
		const received: string[] = [];
		setLoopbackCallbackHandler((url) => received.push(url));

		const callbackUrl = await ensureLoopbackCallbackUrl();
		const origin = new URL(callbackUrl).origin;
		const response = await fetch(`${origin}/favicon.ico`);
		expect(response.status).toBe(404);
		await response.text();

		expect(received).toEqual([]);
	});
});
