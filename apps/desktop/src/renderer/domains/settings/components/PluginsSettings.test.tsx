// @vitest-environment jsdom

import type { DesktopApi, DesktopRuntimeConfigurationCatalog } from "@preload/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InputHTMLAttributes, ReactNode } from "react";
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
	Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input data-slot="input" {...props} />,
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
			configuredSensitivePaths: [],
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

	it("keeps a complete secret draft while catalogs refresh and saves it once on blur", async () => {
		let settingsChanged: (() => void) | undefined;
		const pluginCatalog: DesktopRuntimeConfigurationCatalog = {
			...catalog,
			entries: [
				{
					configurationId: "plugin.jsk-map.settings",
					definitionRevisionId: "definition",
					definitionSourceId: "plugin",
					schemaVersion: 1,
					apply: "next-turn",
					descriptor: {
						title: "JSK Map",
						schema: { type: "object", properties: { password: { type: "string", writeOnly: true } } },
						presentation: {
							fields: [{ key: "password", type: "secret", title: "JSK Password" }],
						},
					},
					defaultValue: {},
					value: {},
					redactedPaths: ["/password"],
					configuredSensitivePaths: [],
					appliedLayerIds: [],
					diagnostics: [],
					owner: { kind: "plugin", pluginId: "jsk-map" },
					consumers: [{ kind: "plugin", id: "jsk-map", support: "adapter" }],
				},
			],
		};
		vi.mocked(runtimeConfiguration.list).mockResolvedValue(pluginCatalog);
		vi.mocked(runtimeConfiguration.set).mockResolvedValue({
			...pluginCatalog,
			entries: pluginCatalog.entries.map((entry) => ({ ...entry, configuredSensitivePaths: ["/password"] })),
		});
		vi.mocked(runtimeConfiguration.onChanged).mockImplementation((listener) => {
			settingsChanged = () => listener({ configurationId: "plugin.jsk-map.settings" });
			return () => undefined;
		});
		vi.mocked(window.vetta.plugins.list).mockResolvedValue([
			{
				id: "jsk-map",
				name: "JSK Map",
				settingsSchema: [{ key: "password", type: "secret", title: "JSK Password" }],
			} as never,
		]);

		render(<PluginsSettings />);
		const password = await screen.findByLabelText("JSK Password");
		expect(screen.getByText("runtimeConfiguration.apply.immediate", { exact: false })).toBeTruthy();
		fireEvent.change(password, { target: { value: "complete-password" } });
		expect(password).toHaveProperty("value", "complete-password");
		expect(runtimeConfiguration.set).not.toHaveBeenCalled();

		settingsChanged?.();
		await waitFor(() => expect(runtimeConfiguration.list).toHaveBeenCalledTimes(2));
		expect(password).toHaveProperty("value", "complete-password");

		fireEvent.blur(password);
		await waitFor(() =>
			expect(runtimeConfiguration.set).toHaveBeenCalledWith("plugin.jsk-map.settings", {
				password: "complete-password",
			}),
		);
		expect(runtimeConfiguration.set).toHaveBeenCalledTimes(1);
	});

	it("saves a complete string setting after editing finishes", async () => {
		const pluginCatalog: DesktopRuntimeConfigurationCatalog = {
			...catalog,
			entries: [
				{
					configurationId: "plugin.jsk-map.settings",
					definitionRevisionId: "definition",
					definitionSourceId: "plugin",
					schemaVersion: 1,
					apply: "next-turn",
					descriptor: {
						title: "JSK Map",
						schema: { type: "object", properties: { username: { type: "string" } } },
						presentation: { fields: [{ key: "username", type: "string", title: "JSK Username" }] },
					},
					defaultValue: {},
					value: { username: "old" },
					redactedPaths: [],
					configuredSensitivePaths: [],
					appliedLayerIds: [],
					diagnostics: [],
					owner: { kind: "plugin", pluginId: "jsk-map" },
					consumers: [{ kind: "plugin", id: "jsk-map", support: "adapter" }],
				},
			],
		};
		vi.mocked(runtimeConfiguration.list).mockResolvedValue(pluginCatalog);
		vi.mocked(runtimeConfiguration.set).mockResolvedValue(pluginCatalog);
		vi.mocked(window.vetta.plugins.list).mockResolvedValue([
			{
				id: "jsk-map",
				name: "JSK Map",
				settingsSchema: [{ key: "username", type: "string", title: "JSK Username" }],
			} as never,
		]);

		render(<PluginsSettings />);
		const username = await screen.findByLabelText("JSK Username");
		fireEvent.change(username, { target: { value: "complete-account" } });
		expect(runtimeConfiguration.set).not.toHaveBeenCalled();
		fireEvent.blur(username);

		await waitFor(() =>
			expect(runtimeConfiguration.set).toHaveBeenCalledWith("plugin.jsk-map.settings", {
				username: "complete-account",
			}),
		);
		expect(runtimeConfiguration.set).toHaveBeenCalledTimes(1);
	});
});
