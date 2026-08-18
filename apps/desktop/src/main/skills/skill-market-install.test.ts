import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("../constants.js", () => ({
	DEFAULT_SERVER_URL: "https://api.example.com/api/v1",
}));

vi.mock("../ipc/settings.js", () => ({
	readSettings: vi.fn(() => ({})),
}));

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../utils/integrity.js", () => ({
	verifySha256: vi.fn(),
}));

vi.mock("../abilities/ability-ledger.js", () => ({
	recordAbilityInstall: vi.fn(),
}));

vi.mock("./skill-service.js", () => ({
	ensureDirWritable: vi.fn(),
	getSkillBaseDir: vi.fn(() => "C:/tmp/skills"),
	readSkillsManifest: vi.fn(() => ({})),
	recordSkillResourceEvent: vi.fn(),
	writeSkillsManifest: vi.fn(),
}));

vi.mock("@vetta/action-rpc", () => ({
	getVettaHomePath: () => "C:/tmp/vetta-home",
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	rm: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(() => true),
		readFileSync: vi.fn(() => "---\nversion: 9.9.9\n---\n"),
	};
});

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

import { setCloudBridge } from "../cloud-bridge.js";

/** 市场安装依赖云服务：默认给测试挂一个已登录形态的 bridge。 */
function mountCloudBridge(): void {
	setCloudBridge({
		fetchRemoteProviders: vi.fn(async () => ({ providers: {} })),
		requestGateway: vi.fn(),
		tryRefreshAccessToken: vi.fn(async () => ({ status: "transient" as const })),
	});
}

beforeEach(() => {
	mountCloudBridge();
});

afterEach(() => {
	setCloudBridge(null);
	fetchMock.mockReset();
	vi.clearAllMocks();
});

describe("installSkillFromMarketSlug", () => {
	it("fetches info and archive then installs", async () => {
		const infoBody = {
			code: 0,
			data: {
				slug: "demo",
				name: "Demo",
				description: "desc",
				version: "1.2.3",
				sha256: undefined,
			},
		};
		fetchMock
			.mockResolvedValueOnce({
				ok: true,
				json: async () => infoBody,
			})
			.mockResolvedValueOnce({
				ok: true,
				arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
			});

		const { installSkillFromMarketSlug } = await import("./skill-market-install.js");
		const result = await installSkillFromMarketSlug("skill", "demo");
		expect(result).toEqual({
			name: "demo",
			type: "skill",
			version: "1.2.3",
			updated: false,
		});
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"https://api.example.com/api/v1/abilities/skill/demo/info",
			expect.objectContaining({ headers: expect.any(Object) }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"https://api.example.com/api/v1/abilities/skill/demo/download",
			expect.objectContaining({ headers: expect.any(Object) }),
		);
	});
});

describe("lite 构建（无 cloud bridge）", () => {
	it("市场安装直接失败，不发出任何网络请求", async () => {
		setCloudBridge(null);
		const { installSkillFromMarketSlug } = await import("./skill-market-install.js");
		await expect(installSkillFromMarketSlug("skill", "demo")).rejects.toThrow(/not available in this build/);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
