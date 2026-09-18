// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const params = vi.hoisted(() => ({ path: encodeURIComponent("/route/session.jsonl") as string | undefined }));

vi.mock("@tanstack/react-router", () => ({
	useParams: () => params,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const { useSessionViewerPageModel } = await import("./useSessionViewerPageModel.js");

describe("useSessionViewerPageModel keep-alive identity", () => {
	beforeEach(() => {
		params.path = encodeURIComponent("/route/session.jsonl");
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				session: {
					openViewer: vi.fn(async () => ({ history: [] })),
					subscribeViewer: vi.fn(async () => () => undefined),
				},
			},
		});
	});

	it("保活宿主传入的 path 优先于当前路由 params", async () => {
		const { result } = renderHook(() => useSessionViewerPageModel("/kept/session.jsonl"));

		expect(result.current.path).toBe("/kept/session.jsonl");
		await waitFor(() => {
			expect(window.vetta.session.openViewer).toHaveBeenCalledWith("/kept/session.jsonl");
		});
		expect(window.vetta.session.openViewer).not.toHaveBeenCalledWith("/route/session.jsonl");
	});

	it("未传入 path 时仍从路由 params 解码身份", async () => {
		const { result } = renderHook(() => useSessionViewerPageModel());

		expect(result.current.path).toBe("/route/session.jsonl");
		await waitFor(() => {
			expect(window.vetta.session.openViewer).toHaveBeenCalledWith("/route/session.jsonl");
		});
	});
});
