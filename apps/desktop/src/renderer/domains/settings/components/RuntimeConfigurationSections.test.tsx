// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RuntimeConfigurationJsonObject, RuntimeConfigurationJsonValue } from "@vetta/runtime-core/configuration";
import { CODING_IMAGE_CONFIGURATION } from "@vetta/runtime-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeConfigurationCatalog } from "@preload/api";
import { IMAGE_NUMERIC_PRESETS } from "./image-numeric-presets";
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
	"runtimeConfiguration.custom": "自定义",
	"runtimeConfiguration.fields.resize.maxWidth.title": "最大宽度",
	"runtimeConfiguration.fields.resize.maxHeight.title": "最大高度",
	"runtimeConfiguration.fields.resize.maxInputPixels.title": "最大输入像素数",
	"runtimeConfiguration.fields.resize.maxInputEdge.title": "最大输入边长",
	"runtimeConfiguration.fields.resize.maxBytes.title": "最大图片字节数",
	"runtimeConfiguration.fields.resize.jpegQuality.title": "JPEG 质量",
	"runtimeConfiguration.fields.requestBudget.highWatermarkBytes.title": "请求高水位",
	"runtimeConfiguration.fields.requestBudget.lowWatermarkBytes.title": "请求低水位",
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) => translations[key] ?? options?.defaultValue ?? key,
	}),
}));
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));

afterEach(() => {
	cleanup();
});

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
		expect(screen.queryByText(/runtimeConfiguration\.applyLabel|生效时间/)).toBeNull();
	});
});

const imageTitles = {
	"resize.maxWidth": "最大宽度",
	"resize.maxHeight": "最大高度",
	"resize.maxInputPixels": "最大输入像素数",
	"resize.maxInputEdge": "最大输入边长",
	"resize.maxBytes": "最大图片字节数",
	"resize.jpegQuality": "JPEG 质量",
	"requestBudget.highWatermarkBytes": "请求高水位",
	"requestBudget.lowWatermarkBytes": "请求低水位",
} as const;

function imageCatalog(
	value: RuntimeConfigurationJsonObject = CODING_IMAGE_CONFIGURATION.defaultValue,
): DesktopRuntimeConfigurationCatalog {
	return {
		snapshotId: "snapshot-images",
		definitionVersion: 1,
		entries: [
			{
				configurationId: CODING_IMAGE_CONFIGURATION.id,
				definitionRevisionId: "definition-images",
				definitionSourceId: "desktop-builtins",
				schemaVersion: CODING_IMAGE_CONFIGURATION.schemaVersion,
				apply: CODING_IMAGE_CONFIGURATION.apply,
				descriptor: CODING_IMAGE_CONFIGURATION.descriptor,
				defaultValue: CODING_IMAGE_CONFIGURATION.defaultValue,
				value,
				redactedPaths: [],
				appliedLayerIds: [],
				diagnostics: [],
				consumers: [{ kind: "runtime", id: "image-processing", support: "native" }],
			},
		],
	};
}

function mergePatch(
	base: RuntimeConfigurationJsonObject,
	patch: RuntimeConfigurationJsonObject,
): RuntimeConfigurationJsonObject {
	const next: Record<string, RuntimeConfigurationJsonValue> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		const current = base[key];
		next[key] = isRecord(value) && isRecord(current) ? mergePatch(current, value) : value;
	}
	return next;
}

function isRecord(value: unknown): value is RuntimeConfigurationJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(root: RuntimeConfigurationJsonObject, path: string): number {
	const value = path.split(".").reduce<unknown>((current, key) => {
		if (!isRecord(current)) return undefined;
		return current[key];
	}, root);
	if (typeof value !== "number") throw new Error(path);
	return value;
}

function installImageConfiguration(value: RuntimeConfigurationJsonObject = CODING_IMAGE_CONFIGURATION.defaultValue) {
	let current = value;
	const set = vi.fn(async (_configurationId: string, patch: RuntimeConfigurationJsonObject) => {
		current = mergePatch(current, patch);
		return imageCatalog(current);
	});
	(window as unknown as { vetta: unknown }).vetta = {
		runtimeConfiguration: {
			list: vi.fn(async () => imageCatalog(current)),
			set,
			onChanged: vi.fn(() => () => undefined),
		},
		plugins: { onOcrProvidersChanged: vi.fn(() => () => undefined) },
	};
	return set;
}

describe("Agent 设置的图片处理配置", () => {
	it("每个数值项列出常用值并以自定义结尾，选中后才手填", async () => {
		const set = installImageConfiguration();
		render(<Harness />);

		expect(await screen.findByRole("button", { name: "最大宽度" })).toBeTruthy();
		expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
		for (const [path, presets] of Object.entries(IMAGE_NUMERIC_PRESETS)) {
			const title = imageTitles[path as keyof typeof imageTitles];
			const preset = presets.find((item) => item.value === readNumber(CODING_IMAGE_CONFIGURATION.defaultValue, path));
			expect(preset, `${path} includes its default`).toBeTruthy();
			expect(screen.getByRole("button", { name: title }).textContent).toContain(preset?.label ?? "");
		}

		await userEvent.click(screen.getByRole("button", { name: "最大宽度" }));
		const optionNames = ["512 px", "768 px", "1024 px", "1280 px", "1536 px", "2048 px", "自定义"];
		const labels = screen.getAllByRole("button").map((button) => button.textContent?.trim());
		const start = labels.indexOf("512 px");
		expect(labels.slice(start, start + optionNames.length)).toEqual(optionNames);

		await userEvent.click(screen.getByRole("button", { name: "2048 px" }));
		await waitFor(() => expect(set).toHaveBeenCalledWith("coding.images", { resize: { maxWidth: 2048 } }));
		expect(screen.getByRole("button", { name: "最大宽度" }).textContent).toContain("2048 px");
		expect(screen.queryByRole("spinbutton", { name: "自定义 最大宽度" })).toBeNull();

		await userEvent.click(screen.getByRole("button", { name: "最大宽度" }));
		await userEvent.click(screen.getByRole("button", { name: "自定义" }));
		const custom = screen.getByRole("spinbutton", { name: "自定义 最大宽度" }) as HTMLInputElement;
		expect(custom.value).toBe("2048");
		await userEvent.clear(custom);
		await userEvent.type(custom, "1600");
		fireEvent.blur(custom);
		await waitFor(() => expect(set).toHaveBeenCalledWith("coding.images", { resize: { maxWidth: 1600 } }));
		expect(screen.getByRole("button", { name: "最大宽度" }).textContent).toContain("自定义");
		expect((screen.getByRole("spinbutton", { name: "自定义 最大宽度" }) as HTMLInputElement).value).toBe("1600");
	});

	it("不在常用值里的已保存数字直接显示为自定义，超出范围的输入不会写入", async () => {
		const set = installImageConfiguration({
			...CODING_IMAGE_CONFIGURATION.defaultValue,
			resize: { ...CODING_IMAGE_CONFIGURATION.defaultValue.resize, jpegQuality: 82 },
		});
		render(<Harness />);

		expect((await screen.findByRole("button", { name: "JPEG 质量" })).textContent).toContain("自定义");
		const custom = screen.getByRole("spinbutton", { name: "自定义 JPEG 质量" }) as HTMLInputElement;
		expect(custom.value).toBe("82");
		await userEvent.clear(custom);
		await userEvent.type(custom, "120");
		fireEvent.blur(custom);
		expect(set).not.toHaveBeenCalled();
		expect(custom.value).toBe("82");
	});
});
