import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVettaCredentials, normalizeVettaBaseUrl, vettaApiUrl, vettaCredentialsPath } from "@vetta/runtime-mcp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEYS = ["VETTA_HOME", "VETTA_API_TOKEN", "VETTA_API_BASE_URL", "VETTA_SERVER_URL"] as const;

describe("vetta credentials", () => {
	let home: string;
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
		for (const key of ENV_KEYS) delete process.env[key];
		home = mkdtempSync(join(tmpdir(), "vetta-creds-"));
		process.env.VETTA_HOME = home;
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	function writeAuthFile(payload: unknown): void {
		writeFileSync(vettaCredentialsPath(), JSON.stringify(payload));
	}

	it("从 auth.json 读出凭据", () => {
		writeAuthFile({ baseUrl: "https://api.example.com", token: "tok" });

		expect(loadVettaCredentials()).toEqual({ baseUrl: "https://api.example.com", token: "tok" });
	});

	it("显式运行时目录不会读取用户默认凭据", () => {
		writeAuthFile({ baseUrl: "https://default.example.com", token: "default" });
		const isolatedHome = join(home, "isolated");
		mkdirSync(isolatedHome);

		expect(loadVettaCredentials(isolatedHome)).toBeNull();
		writeFileSync(
			vettaCredentialsPath(isolatedHome),
			JSON.stringify({ baseUrl: "https://isolated.example.com", token: "isolated" }),
		);
		expect(loadVettaCredentials(isolatedHome)).toEqual({
			baseUrl: "https://isolated.example.com",
			token: "isolated",
		});
	});

	it("文件不存在时返回 null 而不是抛错", () => {
		// 未登录是常态，不是异常；抛 ENOENT 会让调用方无从下手
		expect(loadVettaCredentials()).toBeNull();
	});

	it("文件内容损坏时返回 null", () => {
		writeFileSync(vettaCredentialsPath(), "{ not json");

		expect(loadVettaCredentials()).toBeNull();
	});

	it("缺 token 或缺 baseUrl 都视为未登录", () => {
		writeAuthFile({ baseUrl: "https://api.example.com" });
		expect(loadVettaCredentials()).toBeNull();

		writeAuthFile({ token: "tok" });
		expect(loadVettaCredentials()).toBeNull();
	});

	it("环境变量优先于文件", () => {
		writeAuthFile({ baseUrl: "https://file.example.com", token: "file-token" });
		process.env.VETTA_API_TOKEN = "env-token";
		process.env.VETTA_API_BASE_URL = "https://env.example.com";

		expect(loadVettaCredentials()).toEqual({ baseUrl: "https://env.example.com", token: "env-token" });
	});

	it("VETTA_SERVER_URL 可作为 baseUrl 来源", () => {
		// 桌面端给子进程注入的是这个变量
		process.env.VETTA_API_TOKEN = "env-token";
		process.env.VETTA_SERVER_URL = "https://desktop.example.com/api/v1";

		expect(loadVettaCredentials()).toEqual({ baseUrl: "https://desktop.example.com", token: "env-token" });
	});

	it("每次调用都重读文件，不缓存", () => {
		// token 会轮换，缓存住就等于把过期凭据钉死在连接上
		writeAuthFile({ baseUrl: "https://api.example.com", token: "old" });
		expect(loadVettaCredentials()?.token).toBe("old");

		writeAuthFile({ baseUrl: "https://api.example.com", token: "new" });
		expect(loadVettaCredentials()?.token).toBe("new");
	});
});

describe("normalizeVettaBaseUrl", () => {
	it("剥掉尾部斜杠与 API 前缀", () => {
		expect(normalizeVettaBaseUrl("https://a.com/")).toBe("https://a.com");
		expect(normalizeVettaBaseUrl("https://a.com/api/v1")).toBe("https://a.com");
		expect(normalizeVettaBaseUrl("https://a.com/api/v2/")).toBe("https://a.com");
	});

	it("路径中段的 api/v1 不动", () => {
		// 只剥尾部，否则会误伤把服务挂在子路径下的部署
		expect(normalizeVettaBaseUrl("https://a.com/api/v1/gateway")).toBe("https://a.com/api/v1/gateway");
	});
});

describe("vettaApiUrl", () => {
	it("两种 baseUrl 写法拼出同一个 URL", () => {
		// 不归一就会拼出 /api/v1/api/v1/... 而 404
		expect(vettaApiUrl("https://a.com", "/mcp")).toBe("https://a.com/api/v1/mcp");
		expect(vettaApiUrl("https://a.com/api/v1", "/mcp")).toBe("https://a.com/api/v1/mcp");
	});
});
