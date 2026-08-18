import { describe, expect, it } from "vitest";
import { parseImSetFeishuConfigInput } from "./ImSetFeishuConfigApproval";

describe("parseImSetFeishuConfigInput", () => {
	it("accepts operation with optional secret fields omitted", () => {
		expect(parseImSetFeishuConfigInput({ operation: "set-feishu-config", appId: "cli_1" })).toEqual({
			operation: "set-feishu-config",
			appId: "cli_1",
			appSecret: undefined,
			verificationToken: undefined,
			encryptKey: undefined,
			baseUrl: undefined,
			enabled: undefined,
			approvalUi: undefined,
		});
	});

	it("keeps user-provided secrets for approval rewrite", () => {
		expect(
			parseImSetFeishuConfigInput({
				operation: "set-feishu-config",
				appId: "cli_1",
				appSecret: "secret",
				verificationToken: "vt",
			}),
		).toMatchObject({
			appId: "cli_1",
			appSecret: "secret",
			verificationToken: "vt",
		});
	});

	it("rejects non set-feishu-config operations", () => {
		expect(parseImSetFeishuConfigInput({ operation: "set-enabled", enabled: true })).toBeNull();
		expect(parseImSetFeishuConfigInput(null)).toBeNull();
	});
});
