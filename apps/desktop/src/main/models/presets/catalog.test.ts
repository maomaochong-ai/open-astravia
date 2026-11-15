import { describe, expect, it } from "vitest";
import { getPresetProvider, PRESET_PROVIDERS } from "./catalog";

describe("本机代理预设", () => {
	it("指向回环地址并带密钥默认值，用户不必自备 key", () => {
		const magpie = getPresetProvider("magpie");
		expect(magpie).toMatchObject({
			id: "magpie",
			icon: "magpie",
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:3425/v1",
			defaultApiKey: "magpie",
		});
	});

	it("只有一个本机代理：回环地址上的预设不允许再出现第二个", () => {
		const loopback = PRESET_PROVIDERS.filter((provider) => provider.baseUrl.startsWith("http://127.0.0.1"));
		expect(loopback.map((provider) => provider.id)).toEqual(["magpie"]);
	});
});
