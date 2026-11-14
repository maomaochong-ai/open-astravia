// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HeaderActionBarItem, HeaderActionBarLabels } from "@astravia-org/theme-ui/chat";
import { HeaderActionBarView } from "@astravia-org/theme-ui/chat";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Radix 的菜单在 jsdom 里会调用这几项 Pointer Events API，jsdom 没有实现。
beforeAll(() => {
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => undefined;
	Element.prototype.releasePointerCapture ??= () => undefined;
	Element.prototype.scrollIntoView ??= () => undefined;
});

const labels: HeaderActionBarLabels = {
	customize: "自定义顶栏",
	moveToTop: "放到顶栏",
	topFull: "顶栏已满",
	moveToTray: "收纳",
	adjust: "调整",
	done: "完成",
	more: "更多操作",
};

function action(
	key: string,
	title: string,
	onClick: () => void,
	extra: Partial<HeaderActionBarItem> = {},
): HeaderActionBarItem {
	return {
		key,
		title,
		icon: <span aria-hidden="true">{title}</span>,
		behavior: { type: "click", onClick },
		...extra,
	};
}

function renderBar(crowded: boolean, top: readonly HeaderActionBarItem[], tray: readonly HeaderActionBarItem[] = []): void {
	render(
		<HeaderActionBarView
			crowded={crowded}
			top={top}
			tray={tray}
			maxTop={7}
			labels={labels}
			onMove={() => undefined}
			pinned={<button type="button">活动面板</button>}
		/>,
	);
}

describe("会话顶栏在极窄时收成下拉菜单", () => {
	it("把置顶和活动面板留在外面，其余动作收进更多菜单，点选后仍会执行", async () => {
		// Radix 打开菜单时会给 body 加 pointer-events: none，jsdom 下 userEvent 的可点性检查会一直等。
		const user = userEvent.setup({ pointerEventsCheck: 0 });
		const onExport = vi.fn();
		const onPin = vi.fn();
		const onTerminal = vi.fn();
		const onBottom = vi.fn();
		renderBar(
			true,
			[
				action("builtin:export", "导出", onExport),
				action("builtin:pin", "窗口置顶", onPin, { retainWhenNarrow: true, active: true }),
				action("builtin:terminal", "终端", onTerminal),
			],
			[action("builtin:bottom-panel", "底部面板", onBottom)],
		);

		expect(screen.getByRole("button", { name: "窗口置顶" }).getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByRole("button", { name: "活动面板" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "导出" })).toBeNull();
		expect(screen.queryByRole("button", { name: "终端" })).toBeNull();
		expect(screen.queryByRole("button", { name: "自定义顶栏" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "更多操作" }));
		expect(screen.queryByRole("menuitem", { name: "窗口置顶" })).toBeNull();
		await user.click(screen.getByRole("menuitem", { name: "导出" }));
		expect(onExport).toHaveBeenCalledOnce();

		await user.click(screen.getByRole("button", { name: "更多操作" }));
		await user.click(screen.getByRole("menuitem", { name: "底部面板" }));
		expect(onBottom).toHaveBeenCalledOnce();
		expect(onPin).not.toHaveBeenCalled();
	});

	it("窗口够宽时仍把每个动作摊开，不出现更多菜单", () => {
		renderBar(false, [
			action("builtin:export", "导出", vi.fn()),
			action("builtin:pin", "窗口置顶", vi.fn(), { retainWhenNarrow: true }),
		]);
		expect(screen.getByRole("button", { name: "导出" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "窗口置顶" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "更多操作" })).toBeNull();
	});

	it("置顶被收进托盘时，挤窄后仍然露在活动面板旁边", () => {
		renderBar(true, [action("builtin:export", "导出", vi.fn())], [
			action("builtin:pin", "窗口置顶", vi.fn(), { retainWhenNarrow: true }),
		]);
		expect(screen.getByRole("button", { name: "窗口置顶" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "导出" })).toBeNull();
	});
});
