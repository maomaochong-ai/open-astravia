// @vitest-environment jsdom

import type { DesktopApi, DesktopRuntimeConfigurationCatalog } from "@preload/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
	}),
}));
vi.mock("../../plugins/runtime/plugin-i18n", () => ({ usePluginI18n: () => (_plugin: unknown, value: string) => value }));
vi.mock("../ai-assist", () => ({ SettingsAiAssist: () => null }));
vi.mock("@vetta/theme-ui/settings", () => ({
	SettingSection: ({ section, children }: { section: { title: string }; children: ReactNode }) => (
		<section aria-label={section.title}>{children}</section>
	),
	SettingRow: ({ title, children }: { title: string; children: ReactNode }) => (
		<label>
			<span>{title}</span>
			{children}
		</label>
	),
	MotionSelect: () => null,
}));
vi.mock("@vetta/ui", () => ({
	Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) => (
		<button type="button" role="checkbox" aria-checked={checked} onClick={() => onCheckedChange(!checked)} />
	),
}));

import { PluginsSettings } from "./PluginsSettings";

const catalog: DesktopRuntimeConfigurationCatalog = {
	snapshotId: "snapshot",
	definitionVersion: 1,
	entries: [
		{
			configurationId: "coding.images",
			definitionRevisionId: "definition",
			definitionSourceId: "runtime-tools",
			schemaVersion: 1,
			apply: "next-turn",
			descriptor: {
				title: "Image processing",
				schema: {
					type: "object",
					properties: {
						autoResize: { type: "boolean" },
						resize: { type: "object", properties: { maxWidth: { type: "integer", minimum: 1 } } },
					},
				},
			},
			defaultValue: { autoResize: true, resize: { maxWidth: 1280 } },
			value: { autoResize: true, resize: { maxWidth: 1280 } },
			redactedPaths: [],
			appliedLayerIds: [],
			diagnostics: [],
			owner: { kind: "builtin" },
			consumers: [{ kind: "tool", id: "read", support: "native" }],
		},
	],
};

describe("PluginsSettings Runtime Configuration UI", () => {
	let runtimeConfiguration: DesktopApi["runtimeConfiguration"];

	beforeEach(() => {
		runtimeConfiguration = {
			list: vi.fn(async () => catalog),
			set: vi.fn(async () => catalog),
			onChanged: vi.fn(() => () => undefined),
		};
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				runtimeConfiguration,
				plugins: { list: vi.fn(async () => []) },
			} as unknown as DesktopApi,
		});
	});

	it("renders catalog fields and submits a nested configuration patch", async () => {
		render(<PluginsSettings />);

		await screen.findByRole("region", { name: "Image processing" });
		expect(screen.getByText("read · native", { exact: false })).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox"));

		await waitFor(() =>
			expect(runtimeConfiguration.set).toHaveBeenCalledWith("coding.images", { autoResize: false }),
		);
		const maxWidth = screen.getByDisplayValue("1280");
		fireEvent.change(maxWidth, { target: { value: "640" } });
		await waitFor(() =>
			expect(runtimeConfiguration.set).toHaveBeenCalledWith("coding.images", { resize: { maxWidth: 640 } }),
		);
	});
});
