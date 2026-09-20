import { describe, expect, it, vi } from "vitest";
import { SshPromptService, type SshPromptUserAnswer } from "./ssh-prompt-service.js";

function createFixture(options?: { stored?: Record<string, string>; answer?: SshPromptUserAnswer }) {
	const stored = new Map(Object.entries(options?.stored ?? {}));
	const askUser = vi.fn(async () => options?.answer ?? { ok: true, value: "typed" });
	const removeStoredSecret = vi.fn((ref: { ownerId: string; name: string }) => {
		stored.delete(`${ref.ownerId}:${ref.name}`);
	});
	const writeStoredSecret = vi.fn((ref: { ownerId: string; name: string }, value: string) => {
		stored.set(`${ref.ownerId}:${ref.name}`, value);
	});
	const service = new SshPromptService({
		resolveHostLabel: () => "构建机",
		readStoredSecret: (ref) => stored.get(`${ref.ownerId}:${ref.name}`),
		writeStoredSecret,
		removeStoredSecret,
		askUser,
	});
	return { service, askUser, writeStoredSecret, removeStoredSecret, stored };
}

const passwordRequest = { hostId: "h1", kind: "password" as const, prompt: "me@build-01's password: " };

describe("SSH 交互提示", () => {
	it("有存档凭据时直接回答，不打扰用户", async () => {
		const fixture = createFixture({ stored: { "h1:password": "saved" } });

		await expect(fixture.service.resolve(passwordRequest)).resolves.toEqual({ ok: true, value: "saved" });
		expect(fixture.askUser).not.toHaveBeenCalled();
	});

	it("同一轮再次被问说明存档是错的：改问用户并删掉失效记录", async () => {
		// OpenSSH 密码错了会连问三次。每次都把同一个错密码递回去，用户只会看到卡住然后
		// 失败，完全看不出是存的密码过期了。
		const fixture = createFixture({ stored: { "h1:password": "stale" } });

		await fixture.service.resolve(passwordRequest);
		await expect(fixture.service.resolve(passwordRequest)).resolves.toEqual({ ok: true, value: "typed" });

		expect(fixture.removeStoredSecret).toHaveBeenCalled();
		expect(fixture.stored.has("h1:password")).toBe(false);
		expect(fixture.askUser).toHaveBeenCalledOnce();
	});

	it("连接成功后重置，下次仍先用存档", async () => {
		const fixture = createFixture({ stored: { "h1:password": "saved" } });

		await fixture.service.resolve(passwordRequest);
		fixture.service.reset("h1");
		await expect(fixture.service.resolve(passwordRequest)).resolves.toEqual({ ok: true, value: "saved" });
		expect(fixture.askUser).not.toHaveBeenCalled();
	});

	it("用户勾选记住才写入凭据库", async () => {
		const withRemember = createFixture({ answer: { ok: true, value: "secret", remember: true } });
		await withRemember.service.resolve(passwordRequest);
		expect(withRemember.stored.get("h1:password")).toBe("secret");

		const withoutRemember = createFixture({ answer: { ok: true, value: "secret" } });
		await withoutRemember.service.resolve(passwordRequest);
		expect(withoutRemember.writeStoredSecret).not.toHaveBeenCalled();
	});

	it("一次性验证码不读也不写凭据库", async () => {
		// 记住一次性码没有意义，还会把它留在磁盘上。
		const fixture = createFixture({
			stored: { "h1:verification-code": "000000" },
			answer: { ok: true, value: "123456", remember: true },
		});

		const answer = await fixture.service.resolve({
			hostId: "h1",
			kind: "verification-code",
			prompt: "Verification code: ",
		});

		expect(answer).toEqual({ ok: true, value: "123456" });
		expect(fixture.askUser).toHaveBeenCalledOnce();
		expect(fixture.writeStoredSecret).not.toHaveBeenCalled();
	});

	it("确认类提示只回 ok，不带值", async () => {
		const fixture = createFixture({ answer: { ok: true } });

		await expect(
			fixture.service.resolve({ hostId: "h1", kind: "confirm", prompt: "Are you sure (yes/no)?" }),
		).resolves.toEqual({ ok: true });
	});

	it("用户拒绝主机指纹时不放行", async () => {
		// 默认同意等于让中间人静默通过。
		const fixture = createFixture({ answer: { ok: false } });

		await expect(
			fixture.service.resolve({ hostId: "h1", kind: "confirm", prompt: "Are you sure (yes/no)?" }),
		).resolves.toEqual({ ok: false });
	});

	it("用户取消口令输入时不返回空密码", async () => {
		const fixture = createFixture({ answer: { ok: false } });

		await expect(fixture.service.resolve(passwordRequest)).resolves.toEqual({ ok: false });
	});
});
