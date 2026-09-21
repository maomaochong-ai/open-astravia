import { describe, expect, it, vi } from "vitest";
import { SshPromptService, type SshPromptUserAnswer } from "./ssh-prompt-service.js";

function createFixture(options?: {
	stored?: Record<string, string>;
	answer?: SshPromptUserAnswer;
	now?: () => number;
}) {
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
		...(options?.now === undefined ? {} : { now: options.now }),
	});
	return { service, askUser, writeStoredSecret, removeStoredSecret, stored };
}

/** 同一个 `round` 代表同一个 ssh 进程，也就是同一轮认证。 */
const passwordRequest = { hostId: "h1", kind: "password" as const, prompt: "me@build-01's password: ", round: 4242 };

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

	it("换一个 ssh 进程就是新一轮，仍然先用存档", async () => {
		// 这是「勾了记住却每次还问」的回归点：轮次一旦按应用生命周期来算，同一次运行里的
		// 第二次连接就会被当成「存档是错的」，把刚存下的密码当场删掉。
		const fixture = createFixture({ stored: { "h1:password": "saved" } });

		await fixture.service.resolve(passwordRequest);
		await expect(fixture.service.resolve({ ...passwordRequest, round: 4243 })).resolves.toEqual({
			ok: true,
			value: "saved",
		});

		expect(fixture.askUser).not.toHaveBeenCalled();
		expect(fixture.removeStoredSecret).not.toHaveBeenCalled();
		expect(fixture.stored.get("h1:password")).toBe("saved");
	});

	it("用户勾选记住后，下一轮直接用存档而不再问", async () => {
		const fixture = createFixture({ answer: { ok: true, value: "secret", remember: true } });

		await fixture.service.resolve(passwordRequest);
		await expect(fixture.service.resolve({ ...passwordRequest, round: 4243 })).resolves.toEqual({
			ok: true,
			value: "secret",
		});

		expect(fixture.askUser).toHaveBeenCalledOnce();
	});

	it("标记过期后不再拦着存档", async () => {
		// 标记按 ssh 进程号分桶，而进程退出没有任何事件通知我们清理；过期是这个 Map 的唯一上界。
		let clock = 0;
		const fixture = createFixture({ stored: { "h1:password": "saved" }, now: () => clock });

		await fixture.service.resolve(passwordRequest);
		clock += 11 * 60 * 1000;
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
