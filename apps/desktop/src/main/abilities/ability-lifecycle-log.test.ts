import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.hoisted(() => vi.fn());
const error = vi.hoisted(() => vi.fn());
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info, error }) }));

import {
	logAbilityDevelopmentLink,
	logAbilityInstallFailed,
	logAbilityInstallStarted,
	logAbilityLifecycleEvent,
	logAbilityRuntimeLoaded,
} from "./ability-lifecycle-log.js";

describe("ability lifecycle log", () => {
	beforeEach(() => {
		info.mockClear();
		error.mockClear();
	});

	it("uses one structured lifecycle format for every ability type", () => {
		logAbilityLifecycleEvent({
			type: "resource.lifecycle",
			resourceKind: "mcp",
			resourceId: "demo-server",
			operation: "enabled",
			source: "market",
		});

		expect(info).toHaveBeenCalledWith("lifecycle completed", {
			abilityType: "mcp",
			abilityId: "demo-server",
			operation: "enabled",
			source: "market",
		});
	});

	it("adds marketplace branch and artifact provenance to installation logs", () => {
		const context = {
			abilityType: "plugin" as const,
			abilityId: "demo-plugin",
			version: "1.2.3",
			installMode: "marketplace" as const,
			artifactKind: "vettapkg" as const,
			artifactName: "demo-plugin-1.2.3.vettapkg",
			marketplaceSourceId: "official",
			marketplaceRepository: "https://github.com/example/market",
			marketplaceRef: "refa/market-v3",
		};

		logAbilityInstallStarted(context);
		logAbilityLifecycleEvent(
			{
				type: "resource.lifecycle",
				resourceKind: "plugin",
				resourceId: "demo-plugin",
				operation: "installed",
				source: "remote",
			},
			context,
		);

		expect(info).toHaveBeenNthCalledWith(1, "installation started", context);
		expect(info).toHaveBeenNthCalledWith(
			2,
			"lifecycle completed",
			expect.objectContaining({
				abilityId: "demo-plugin",
				installMode: "marketplace",
				artifactKind: "vettapkg",
				marketplaceRef: "refa/market-v3",
			}),
		);
	});

	it("records failed installs and temporary development links separately", () => {
		const failure = new Error("download failed");
		logAbilityInstallFailed(
			{
				abilityType: "plugin",
				abilityId: "demo-plugin",
				installMode: "marketplace",
				artifactKind: "vettapkg",
			},
			failure,
		);
		logAbilityDevelopmentLink("linked", {
			abilityType: "plugin",
			abilityId: "demo-plugin",
			projectDir: "C:/project/demo-plugin",
		});

		expect(error).toHaveBeenCalledWith(
			"installation failed",
			expect.objectContaining({ abilityId: "demo-plugin" }),
			failure,
		);
		expect(info).toHaveBeenCalledWith(
			"development source linked",
			expect.objectContaining({
				abilityId: "demo-plugin",
				installMode: "plugin-cli",
				artifactKind: "development-project",
				persisted: false,
			}),
		);
	});

	it("records a successful runtime load separately from configuration changes", () => {
		logAbilityRuntimeLoaded({
			abilityType: "plugin",
			abilityId: "demo-plugin",
			version: "1.2.3",
			source: "remote",
			activationId: "activation-1",
		});

		expect(info).toHaveBeenCalledWith("runtime loaded", {
			abilityType: "plugin",
			abilityId: "demo-plugin",
			version: "1.2.3",
			source: "remote",
			activationId: "activation-1",
		});
	});
});
