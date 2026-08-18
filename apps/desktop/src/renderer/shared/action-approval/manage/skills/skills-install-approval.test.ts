import { describe, expect, it } from "vitest";
import { parseSkillsInstallFromMarketInput } from "./SkillsInstallFromMarketApproval";

describe("parseSkillsInstallFromMarketInput", () => {
	it("accepts skill and scene install payloads", () => {
		expect(
			parseSkillsInstallFromMarketInput({
				operation: "install-from-market",
				type: "skill",
				slug: " create-skill ",
			}),
		).toEqual({
			operation: "install-from-market",
			type: "skill",
			slug: "create-skill",
			approvalUi: undefined,
		});
		expect(
			parseSkillsInstallFromMarketInput({
				operation: "install-from-market",
				type: "scene",
				slug: "welcome",
			}),
		).toMatchObject({ type: "scene", slug: "welcome" });
	});

	it("rejects invalid payloads", () => {
		expect(parseSkillsInstallFromMarketInput(null)).toBeNull();
		expect(parseSkillsInstallFromMarketInput({ operation: "set-enabled" })).toBeNull();
		expect(
			parseSkillsInstallFromMarketInput({
				operation: "install-from-market",
				type: "plugin",
				slug: "x",
			}),
		).toBeNull();
		expect(
			parseSkillsInstallFromMarketInput({
				operation: "install-from-market",
				type: "skill",
				slug: "   ",
			}),
		).toBeNull();
	});
});
