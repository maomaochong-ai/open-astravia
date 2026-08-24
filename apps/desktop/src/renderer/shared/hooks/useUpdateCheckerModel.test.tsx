/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { useAtom, useSetAtom } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filePreviewAtom } from "../store/file-preview-atoms";
import { updaterStateAtom } from "../store/updater-atoms";
import { useUpdateCheckerModel } from "./useUpdateCheckerModel";
describe("useUpdateCheckerModel", () => {
	beforeEach(() => {
		if (typeof URL.createObjectURL !== "function") {
			URL.createObjectURL = vi.fn((_blob: Blob) => "blob:mock-url");
		}
	});
	it("sets global markdown preview when onViewMore is called", () => {
		let globalPreview: any = null;

		const { result } = renderHook(() => {
			const setUpdaterState = useSetAtom(updaterStateAtom);
			const [preview] = useAtom(filePreviewAtom);
			globalPreview = preview;
			const model = useUpdateCheckerModel();
			return { setUpdaterState, model };
		});

		act(() => {
			result.current.setUpdaterState({
				phase: "available",
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				releaseNote: "# Release 1.1.0\n- Great feature\n- Bug fix",
			});
		});

		expect(result.current.model.phase).toBe("available");
		expect(result.current.model.releaseNote).toContain("Great feature");

		act(() => {
			result.current.model.onViewMore?.();
		});

		expect(globalPreview).not.toBeNull();
		expect(globalPreview.name).toBe("v1.1.0_changelog.md");
		expect(globalPreview.url).toMatch(/^blob:/);
	});
});
