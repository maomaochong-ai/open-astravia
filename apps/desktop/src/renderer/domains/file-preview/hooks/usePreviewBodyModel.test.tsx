// @vitest-environment jsdom

import type { DesktopApi } from "@preload/api";
import { pluginFilePreviewsAtom } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const translations = vi.hoisted(() => ({
	t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: translations.t }),
}));

import { usePreviewBodyModel } from "./usePreviewBodyModel";

function createWrapper(store = createStore()) {
	return function Wrapper({ children }: PropsWithChildren): JSX.Element {
		return <Provider store={store}>{children}</Provider>;
	};
}

describe("usePreviewBodyModel", () => {
	let readFile: ReturnType<typeof vi.fn>;
	let readTextPreviewFile: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		readFile = vi.fn();
		readTextPreviewFile = vi.fn();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				fs: {
					readFile,
					readTextPreviewFile,
					watchDir: vi.fn(async () => undefined),
					unwatchDir: vi.fn(async () => undefined),
					onDirChanged: vi.fn(() => () => undefined),
				},
			} as unknown as DesktopApi,
		});
	});

	it("renders an unknown local UTF-8 file through the plain-text fallback", async () => {
		readTextPreviewFile.mockResolvedValue({ status: "text", content: "custom content", size: 14 });
		const { result } = renderHook(
			() => usePreviewBodyModel({ name: "notes.custom", path: "C:\\workspace\\notes.custom" }),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => expect(result.current.state.status).toBe("content"));
		expect(readTextPreviewFile).toHaveBeenCalledWith("C:\\workspace\\notes.custom");
		expect(readFile).not.toHaveBeenCalled();
		if (result.current.state.status !== "content") throw new Error("Expected content preview");
		expect(result.current.state.content).toMatchObject({ props: { content: "custom content", extension: "" } });
	});

	it("keeps an unknown binary file in the unsupported state", async () => {
		readTextPreviewFile.mockResolvedValue({ status: "binary", size: 4 });
		const { result } = renderHook(
			() => usePreviewBodyModel({ name: "payload.custom", path: "C:\\workspace\\payload.custom" }),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => expect(result.current.state.status).toBe("unsupported"));
	});

	it("does not probe an unknown remote resource without a bounded host reader", () => {
		const { result } = renderHook(
			() => usePreviewBodyModel({ name: "notes.custom", url: "https://example.test/notes.custom" }),
			{ wrapper: createWrapper() },
		);

		expect(result.current.state.status).toBe("unsupported");
		expect(readTextPreviewFile).not.toHaveBeenCalled();
	});

	it("keeps a registered plugin preview ahead of the plain-text fallback", () => {
		const store = createStore();
		store.set(pluginFilePreviewsAtom, [
			{ pluginId: "custom-viewer", extensions: ["custom"], component: () => null },
		]);
		const { result } = renderHook(
			() => usePreviewBodyModel({ name: "notes.custom", path: "C:\\workspace\\notes.custom" }),
			{ wrapper: createWrapper(store) },
		);

		expect(result.current.state.status).toBe("plugin");
		expect(readTextPreviewFile).not.toHaveBeenCalled();
	});

	it("continues to use the existing reader for declared text formats", async () => {
		readFile.mockResolvedValue({ content: "# heading", encoding: "utf8" });
		const { result } = renderHook(
			() => usePreviewBodyModel({ name: "notes.md", path: "C:\\workspace\\notes.md" }),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => expect(result.current.state.status).toBe("content"));
		expect(readFile).toHaveBeenCalledWith("C:\\workspace\\notes.md");
		expect(readTextPreviewFile).not.toHaveBeenCalled();
	});

	it("re-probes an unknown local file after a refresh", async () => {
		readTextPreviewFile.mockResolvedValue({ status: "text", content: "one", size: 3 });
		const { result, rerender } = renderHook(
			({ refreshNonce }) =>
				usePreviewBodyModel(
					{ name: "notes.custom", path: "C:\\workspace\\notes.custom" },
					refreshNonce,
				),
			{ initialProps: { refreshNonce: 0 }, wrapper: createWrapper() },
		);
		await waitFor(() => expect(result.current.state.status).toBe("content"));

		readTextPreviewFile.mockResolvedValue({ status: "text", content: "two", size: 3 });
		act(() => rerender({ refreshNonce: 1 }));

		await waitFor(() => expect(readTextPreviewFile).toHaveBeenCalledTimes(2));
	});
});
