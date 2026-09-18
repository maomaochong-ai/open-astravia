// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersistentSurfaceShell } from "./PersistentSurfaceShell";
import { persistentSurfaceTitleRef } from "./persistent-surface-shell";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

describe("PersistentSurfaceShell", () => {
	it("能力页 chunk 还没到时立刻画出页内标题，不铺脉冲卡片", () => {
		const { container, getByRole } = render(<PersistentSurfaceShell id="abilities" />);
		expect(getByRole("heading", { level: 1 }).textContent).toBe("page.title");
		expect(container.querySelector(".animate-pulse")).toBeNull();
	});

	it("设置页 chunk 还没到时立刻画出「设置」标题，不铺脉冲卡片", () => {
		const { container, getByRole } = render(<PersistentSurfaceShell id="settings" />);
		expect(getByRole("heading", { level: 1 }).textContent).toBe("title");
		expect(container.querySelector(".animate-pulse")).toBeNull();
		expect(container.querySelector("[aria-busy='true']")).toBeNull();
	});

	it("新会话 chunk 还没到时立刻画出问候语，不铺脉冲卡片", () => {
		const { container, getByRole } = render(<PersistentSurfaceShell id="new-session" />);
		expect(getByRole("heading", { level: 1 }).textContent).toBe("newSession.greetingDefault");
		expect(container.querySelector(".animate-pulse")).toBeNull();
		expect(container.querySelector("[aria-busy='true']")).toBeNull();
	});

	it("壳上的标题 key 与 persistentSurfaceTitleRef 同一份事实源", () => {
		const ids = [
			"abilities",
			"agents",
			"automation",
			"batch-tasks",
			"knowledge",
			"knowledge-all",
			"scenes",
			"settings",
			"new-session",
		] as const;
		for (const id of ids) {
			const { getByRole, unmount } = render(<PersistentSurfaceShell id={id} />);
			expect(getByRole("heading", { level: 1 }).textContent).toBe(persistentSurfaceTitleRef(id).key);
			unmount();
		}
	});
});
