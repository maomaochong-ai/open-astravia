// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginAbility } from "../../types";
import { PluginContributionsSection } from "./PluginContributionsSection";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "zh", resolvedLanguage: "zh" },
	}),
}));

function pluginAbility(overrides: Partial<PluginAbility> = {}): PluginAbility {
	return {
		type: "plugin",
		id: "plugin:demo",
		slug: "demo",
		installed: true,
		busy: false,
		permissions: [],
		...overrides,
	} as unknown as PluginAbility;
}

afterEach(cleanup);

describe("PluginContributionsSection", () => {
	it("hides internal Skills and keeps the provider display name on plugin detail", () => {
		render(
			<PluginContributionsSection
				item={
					pluginAbility({
						plugin: {
							agent: {
								skillPresentation: {
									defaultVisibility: "hidden",
									skills: {
										"public-skill": {
											defaultVisibility: "visible",
											displayName: "Vetta 设计",
										},
									},
								},
							},
							locales: {},
							defaultLocale: "zh",
						} as unknown as NonNullable<PluginAbility["plugin"]>,
						market: {
							config: {
								contributions: {
									skills: [
										{ name: "public-skill", alias: "public-skill" },
										{ name: "internal-skill", alias: "internal-skill" },
									],
								},
							},
						} as unknown as PluginAbility["market"],
					})
				}
			/>,
		);

		expect(screen.getByText("Vetta 设计")).toBeTruthy();
		expect(screen.queryByText("internal-skill")).toBeNull();
	});

	it("uses a presentation included in an uninstalled market snapshot", () => {
		render(
			<PluginContributionsSection
				item={
					pluginAbility({
						plugin: null,
						market: {
							config: {
								contributions: {
									skills: [
										{
											name: "public-skill",
											presentation: {
												defaultVisibility: "hidden",
												surfaces: { pluginDetail: "visible" },
												displayName: "公开能力",
											},
										},
									],
								},
							},
						} as unknown as PluginAbility["market"],
					})
				}
			/>,
		);

		expect(screen.getByText("公开能力")).toBeTruthy();
	});
});
