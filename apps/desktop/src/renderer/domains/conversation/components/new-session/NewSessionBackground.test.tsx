// @vitest-environment jsdom
/**
 * 新会话页底衬按「设置 - 外观 - 纹理」的选择决定画哪一档：
 * 选「网格」（含未选过、存了脏值）时画网格那档，选「流光」时画顶部那条光带，
 * 选「无」时整块背景什么都不画。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta/theme-ui/chat", () => ({
	NewSessionBackground: () => <div data-testid="grid" />,
}));

vi.mock("@shared/components/aurora/AuroraTexture", () => ({
	AuroraTexture: () => <div data-testid="aurora" />,
}));

const STORAGE_KEY = "vetta-new-session-texture";

/** atom 的初值在模块加载时就从 localStorage 读走了，所以每次都要先写值再重新 import。 */
async function renderBackground(stored: string | null) {
	if (stored === null) window.localStorage.removeItem(STORAGE_KEY);
	else window.localStorage.setItem(STORAGE_KEY, stored);
	vi.resetModules();
	const { NewSessionBackground } = await import("./NewSessionBackground");
	return render(<NewSessionBackground />);
}

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	vi.resetModules();
});

describe("NewSessionBackground", () => {
	it("未选过时画默认的网格", async () => {
		await renderBackground(null);

		expect(screen.getByTestId("grid")).toBeTruthy();
	});

	it("选「无」时整块背景一个节点都不留", async () => {
		const { container } = await renderBackground("none");

		expect(screen.queryByTestId("grid")).toBeNull();
		expect(container.firstChild).toBeNull();
	});

	it("选「网格」时画网格", async () => {
		await renderBackground("grid");

		expect(screen.getByTestId("grid")).toBeTruthy();
	});

	it("选「流光」时画流光那条光带", async () => {
		await renderBackground("aurora");

		expect(screen.getByTestId("aurora")).toBeTruthy();
		expect(screen.queryByTestId("grid")).toBeNull();
	});

	it("存了未知纹理时回落到默认的网格", async () => {
		await renderBackground("not-a-texture");

		expect(screen.getByTestId("grid")).toBeTruthy();
	});

	it("在设置页改选「无」：底衬当场清空，重开应用后仍是「无」", async () => {
		vi.resetModules();
		const [{ NewSessionBackground }, { useNewSessionTexture }] = await Promise.all([
			import("./NewSessionBackground"),
			import("@shared/hooks/useNewSessionTexture"),
		]);
		// 设置页那张纹理卡片做的就是这件事：把选中的 id 交给 useNewSessionTexture。
		function TexturePicker(): JSX.Element {
			const { setTexture } = useNewSessionTexture();
			return (
				<button type="button" onClick={() => setTexture("none")}>
					无
				</button>
			);
		}
		render(
			<>
				<TexturePicker />
				<NewSessionBackground />
			</>,
		);
		expect(screen.getByTestId("grid")).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: "无" }));

		expect(screen.queryByTestId("grid")).toBeNull();
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe("none");
	});
});
