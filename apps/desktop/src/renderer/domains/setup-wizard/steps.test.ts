import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ cloud: true, mac: true }));

vi.mock("@/shared/feature-flags", () => ({
	isCloudBuildEnabled: () => flags.cloud,
}));

vi.mock("@shared/lib/platform", () => ({
	get isMac() {
		return flags.mac;
	},
}));

import { getSetupWizardSteps } from "./steps";

describe("getSetupWizardSteps", () => {
	beforeEach(() => {
		flags.cloud = true;
		flags.mac = true;
	});

	it("完全体构建包含登录步", () => {
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "permissions", "login", "welcome"]);
	});

	it("已登录用户跳过登录步", () => {
		expect(getSetupWizardSteps({ isLoggedIn: true })).toEqual(["languageAppearance", "permissions", "welcome"]);
	});

	it("lite 构建（无云服务）不引导登录", () => {
		flags.cloud = false;
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "permissions", "welcome"]);
	});

	it("非 macOS 跳过权限步；lite 下同样不含登录步", () => {
		flags.mac = false;
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "login", "welcome"]);
		flags.cloud = false;
		expect(getSetupWizardSteps()).toEqual(["languageAppearance", "welcome"]);
	});
});
