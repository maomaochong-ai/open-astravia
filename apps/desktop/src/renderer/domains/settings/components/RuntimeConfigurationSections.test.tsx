// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RuntimeConfigurationJsonObject } from "@vetta/runtime-core/configuration";
import { describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeConfigurationCatalog } from "@preload/api";
import { RuntimeConfigurationSections } from "./RuntimeConfigurationSections";
import { useRuntimeConfigurationModel } from "./useRuntimeConfigurationModel";

const translations = vi.hoisted<Record<string, string>>(() => ({
	"runtimeConfiguration.fields.enabled.title": "自动压缩",
	"runtimeConfiguration.fields.reserveTokens.title": "剩余空间阈值（tokens）",
	"runtimeConfiguration.fields.contextThresholdPercent.title": "上下文压缩阈值（%）",
	"runtimeConfiguration.fields.contextThresholdPercent.description":
		"已用上下文达到这个比例，且剩余空间也低于 token 阈值时，自动压缩。",
	"runtimeConfiguration.fields.keepRecentTokens.title": "压缩后保留的最近对话（tokens）",
	"runtimeConfiguration.fields.keepRecentTokens.description":
		"每次压缩时，最近约这么多 token 的对话保留原文；更早的内容整理成摘要。数值越大，保留的近期细节越多。",
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) => translations[key] ?? options?.defaultValue ?? key,
	}),
}));
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));

const compactionValue = {
	enabled: true,
	reserveTokens: 36_000,
	contextThresholdPercent: 80,
	keepRecentTokens: 20_000,
};

function catalog(value: RuntimeConfigurationJsonObject = compactionValue): DesktopRuntimeConfigurationCatalog {
	return {
		snapshotId: "snapshot-1",
		definitionVersion: 1,
		entries: [
			{
				configurationId: "coding.compaction",
				definitionRevisionId: "definition-1",
				definitionSourceId: "desktop-builtins",
				schemaVersion: 1,
				apply: "next-turn",
				descriptor: {
					title: "Context compaction",
					description: "Context policy",
					schema: {
						type: "object",
						properties: {
							enabled: { type: "boolean" },
							reserveTokens: { type: "integer", minimum: 1 },
							contextThresholdPercent: { type: "integer", minimum: 1, maximum: 100 },
							keepRecentTokens: { type: "integer", minimum: 0 },
						},
					},
				},
				defaultValue: compactionValue,
				value,
				redactedPaths: [],
				appliedLayerIds: [],
				diagnostics: [],
				consumers: [{ kind: "runtime", id: "context-compaction", support: "native" }],
			},
		],
	};
}

function Harness(): JSX.Element {
	return <RuntimeConfigurationSections model={useRuntimeConfigurationModel()} />;
}

describe("Agent 设置的上下文压缩配置", () => {
	it("从 Runtime 配置加载控件，并把用户修改保存到下一回合配置", async () => {
		const set = vi.fn(async (_configurationId: string, patch: Record<string, unknown>) =>
			catalog({ ...compactionValue, ...patch }),
		);
		(window as unknown as { vetta: unknown }).vetta = {
			runtimeConfiguration: {
				list: vi.fn(async () => catalog()),
				set,
				onChanged: vi.fn(() => () => undefined),
			},
			plugins: { onOcrProvidersChanged: vi.fn(() => () => undefined) },
		};

		render(<Harness />);

		const autoCompaction = await screen.findByRole("switch", { name: "自动压缩" });
		await userEvent.click(autoCompaction);
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith("coding.compaction", {
				enabled: false,
			}),
		);

		const reserve = screen.getByRole("spinbutton", { name: "剩余空间阈值（tokens）" });
		fireEvent.change(reserve, { target: { value: "24000" } });
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith("coding.compaction", {
				reserveTokens: 24_000,
			}),
		);

		const threshold = screen.getByRole("spinbutton", { name: "上下文压缩阈值（%）" });
		expect((threshold as HTMLInputElement).value).toBe("80");
		fireEvent.change(threshold, { target: { value: "75" } });
		await waitFor(() =>
			expect(set).toHaveBeenCalledWith("coding.compaction", {
				contextThresholdPercent: 75,
			}),
		);
		expect(screen.getByText(translations["runtimeConfiguration.fields.contextThresholdPercent.description"])).toBeTruthy();
		expect(
			(screen.getByRole("spinbutton", { name: "压缩后保留的最近对话（tokens）" }) as HTMLInputElement).value,
		).toBe("20000");
		expect(screen.getByText(translations["runtimeConfiguration.fields.keepRecentTokens.description"])).toBeTruthy();
		expect(screen.getByText(/runtimeConfiguration\.applyLabel/).textContent).toContain("next-turn");
	});
});
