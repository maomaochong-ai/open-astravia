// @vitest-environment jsdom
/**
 * 「管理会话」面板的组件级用例。
 *
 * 放在 `apps/desktop` 而不是 `packages/theme-ui`：该包刻意不依赖 `@testing-library/*`
 * （包内既有 jsdom 用例一律 `react-dom/client` + `act`），面板级断言需要 testing-library
 * 才表达得清楚，因此按 ADR-0170 §1 用宿主里已配置好的环境跑同一个组件。
 */
import { ManageSessionsSplashView, type ManageSessionsSplashViewProps } from "@astravia-org/theme-ui/project";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LABELS: ManageSessionsSplashViewProps["labels"] = {
	title: "管理会话",
	searchPlaceholder: "搜索会话…",
	searchLabel: "搜索会话",
	empty: "还没有会话",
	back: "返回",
	renamePlaceholder: "输入新的会话名称",
	renameLabel: "重命名",
	clearAll: "清空全部",
	clearAllDisabled: "请先停止运行中的会话",
	hintDelete: "删除",
	hintMore: "更多操作",
	hintClose: "Esc 关闭",
	hintTab: "切换标签",
	hintBack: "Esc 返回",
	hintSelect: "回车 确认",
	hintRename: "回车 保存",
};

function rows(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		id: `row-${index}`,
		title: `会话 ${index}`,
		titleHighlights: [],
		icon: "icon-[solar--chat-round-line-linear]",
	}));
}

function props(overrides: Partial<ManageSessionsSplashViewProps> = {}): ManageSessionsSplashViewProps {
	return {
		open: true,
		step: "list",
		labels: LABELS,
		modifierLabel: "Control",
		onClose: vi.fn(),
		tabs: [],
		activeTabId: "all",
		onSelectTab: vi.fn(),
		query: "",
		onQueryChange: vi.fn(),
		rows: [],
		selectedId: null,
		onHoverRow: vi.fn(),
		onOpenRow: vi.fn(),
		onMoreRow: vi.fn(),
		clearAllVisible: false,
		clearAllDisabled: false,
		onClearAll: vi.fn(),
		menuTitle: "",
		menuItems: [],
		menuActiveId: null,
		onHoverMenuItem: vi.fn(),
		onSelectMenuItem: vi.fn(),
		renameValue: "",
		onRenameChange: vi.fn(),
		onRenameSubmit: vi.fn(),
		onBack: vi.fn(),
		...overrides,
	};
}

const VIRTUAL_THRESHOLD = 80;
const ROW_HEIGHT = 36;
const OVERSCAN = 6;

/** 让容器报出一个固定高度，模拟矮窗口下 `min(420px, 56vh)` 收缩后的真实视口。 */
function stubViewportHeight(height: number): void {
	class FakeResizeObserver {
		private readonly callback: ResizeObserverCallback;
		constructor(callback: ResizeObserverCallback) {
			this.callback = callback;
		}
		observe(): void {
			this.callback(
				[{ contentRect: { height } } as unknown as ResizeObserverEntry] as ResizeObserverEntry[],
				this as unknown as ResizeObserver,
			);
		}
		unobserve(): void {}
		disconnect(): void {}
	}
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
}

/**
 * 面板在几百条历史时必须只挂载可见的几十行，否则每次击键都会重排整棵树。
 * 同时 80 条以内要保持全量渲染——窗口化会牺牲焦点与滚动锚点，不值得在小列表上付这个代价。
 */
describe("管理会话面板视图", () => {
	beforeEach(() => {
		// 每个用例都从「拿不到高度」的默认状态开始，避免上一个用例的桩件泄漏。
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("超过 80 行时只挂载可视窗口里的行，并保留完整列表高度", async () => {
		render(<ManageSessionsSplashView {...props({ rows: rows(200) })} />);
		const listbox = await screen.findByRole("listbox", { name: LABELS.title });
		const mounted = listbox.querySelectorAll('[role="option"]');
		expect(mounted.length).toBeGreaterThan(0);
		expect(mounted.length).toBeLessThan(200);
		// 上下留白撑出完整列表高度，滚动条长度才不会随窗口化缩水。
		expect(listbox.querySelector('[data-manage-sessions-spacer="true"]')).toBeTruthy();
	}, 20_000);

	it("80 行以内全量渲染每一条", async () => {
		render(<ManageSessionsSplashView {...props({ rows: rows(VIRTUAL_THRESHOLD) })} />);
		const listbox = await screen.findByRole("listbox", { name: LABELS.title });
		expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(VIRTUAL_THRESHOLD);
		expect(listbox.querySelector('[data-manage-sessions-spacer="true"]')).toBeNull();
	}, 20_000);

	it("矮窗口按实测视口算可见行数，不会多挂载看不见的行", async () => {
		// 窗口高度 < 750px 时 `56vh` 小于 420px 上限：这里取 200px，只要能挂 6 行。
		const height = 200;
		stubViewportHeight(height);
		render(<ManageSessionsSplashView {...props({ rows: rows(200) })} />);
		const listbox = await screen.findByRole("listbox", { name: LABELS.title });

		// 未滚动时窗口 = 可见行 + 单侧 overscan；按常量 420 算会多挂 6 行，
		// 那几行永远在视口外，选中它们时用户看不到任何变化。
		const visibleRows = Math.ceil(height / ROW_HEIGHT) + 1;
		const mounted = listbox.querySelectorAll('[role="option"]').length;
		expect(mounted).toBe(visibleRows + OVERSCAN);
	}, 20_000);

	it("没有会话时显示空态文案", async () => {
		render(<ManageSessionsSplashView {...props()} />);
		await waitFor(() => expect(screen.getByText(LABELS.empty)).toBeTruthy());
	});

	it("行尾「更多」按钮把 id 交给宿主，不会顺带打开这一行", async () => {
		const onMoreRow = vi.fn();
		const onOpenRow = vi.fn();
		render(<ManageSessionsSplashView {...props({ rows: rows(3), onMoreRow, onOpenRow, selectedId: "row-0" })} />);
		const more = await screen.findAllByRole("button", { name: LABELS.hintMore });
		more[0]?.click();
		expect(onMoreRow).toHaveBeenCalledWith("row-0");
		expect(onOpenRow).not.toHaveBeenCalled();
	});
});
