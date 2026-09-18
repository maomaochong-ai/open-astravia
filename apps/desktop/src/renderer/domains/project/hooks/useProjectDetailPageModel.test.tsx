// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const params = vi.hoisted(() => ({ cwd: encodeURIComponent("/workspace/from-route") }));

vi.mock("@tanstack/react-router", () => ({
	useParams: () => params,
	useNavigate: () => vi.fn(),
}));
vi.mock("@shared/shortcuts", () => ({ useShortcutScope: () => undefined }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "zh" },
	}),
}));

const { useProjectDetailPageModel } = await import("./useProjectDetailPageModel.js");

describe("useProjectDetailPageModel keep-alive identity", () => {
	beforeEach(() => {
		params.cwd = encodeURIComponent("/workspace/from-route");
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				fs: {
					readFile: vi.fn(async () => ({ content: "" })),
					writeFile: vi.fn(async () => undefined),
					stat: vi.fn(async () => ({ createdAt: 1 })),
				},
			},
		});
	});

	it("保活宿主传入的 cwd 优先于当前路由 params", async () => {
		const { result } = renderHook(() => useProjectDetailPageModel("/tmp/demo"));

		expect(result.current.decodedCwd).toBe("/tmp/demo");
		expect(result.current.cwd).toBe("/tmp/demo");
		await waitFor(() => {
			expect(window.vetta.fs.readFile).toHaveBeenCalledWith("/tmp/demo/AGENTS.md");
		});
		expect(window.vetta.fs.readFile).not.toHaveBeenCalledWith("/workspace/from-route/AGENTS.md");
	});

	it("未传入 cwd 时仍从路由 params 解码身份", async () => {
		const { result } = renderHook(() => useProjectDetailPageModel());

		expect(result.current.decodedCwd).toBe("/workspace/from-route");
		await waitFor(() => {
			expect(window.vetta.fs.readFile).toHaveBeenCalledWith("/workspace/from-route/AGENTS.md");
		});
	});

	it("Activity 切回同一项目时不重读 AGENTS.md，未保存编辑还在", async () => {
		const hidden = { current: false };
		const { result, rerender } = renderHook(() => useProjectDetailPageModel("/tmp/demo"), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<Activity mode={hidden.current ? "hidden" : "visible"}>{children}</Activity>
			),
		});
		await waitFor(() => {
			expect(window.vetta.fs.readFile).toHaveBeenCalledWith("/tmp/demo/AGENTS.md");
		});
		const readFile = window.vetta.fs.readFile as ReturnType<typeof vi.fn>;
		expect(readFile).toHaveBeenCalledTimes(1);

		act(() => {
			result.current.onContentChange("draft");
		});
		act(() => {
			hidden.current = true;
			rerender();
		});
		act(() => {
			hidden.current = false;
			rerender();
		});

		expect(result.current.content).toBe("draft");
		expect(readFile).toHaveBeenCalledTimes(1);
	});
});
