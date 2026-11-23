// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initTheme, useTheme } from "../src/app/theme";

/**
 * 主题是站点级状态：页头切一次，所有依赖它的区块（产品截图、社群海报）都要换。
 * 之前每个 useTheme 各持一份 useState，切主题后图不变——这条用例守的就是那个回归。
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
	document.documentElement.dataset.theme = "dark";
	localStorage.clear();
	localStorage.setItem("astravia-theme", "dark");
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(() => {
	if (root) {
		const r = root;
		act(() => r.unmount());
	}
	root = null;
	host?.remove();
	host = null;
	delete document.documentElement.dataset.theme;
});

afterEach(() => {
	root?.unmount();
	root = null;
	host?.remove();
	host = null;
	delete document.documentElement.dataset.theme;
});

function Probe({ label }: { label: string }) {
	const { theme } = useTheme();
	return <span data-probe={label}>{theme}</span>;
}

function Toggle() {
	const { toggle } = useTheme();
	return (
		<button type="button" onClick={toggle}>
			切主题
		</button>
	);
}

describe("主题状态", () => {
	it("切换后所有订阅者一起更新，不只更新按钮自己", () => {
		act(() => {
			initTheme();
			root?.render(
				<>
					<Toggle />
					<Probe label="header" />
					<Probe label="screenshot" />
					<Probe label="poster" />
				</>,
			);
		});

		const read = () => [...document.querySelectorAll("[data-probe]")].map((el) => el.textContent);
		expect(read()).toEqual(["dark", "dark", "dark"]);

		act(() => {
			document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(read()).toEqual(["light", "light", "light"]);
		expect(document.documentElement.dataset.theme).toBe("light");
		expect(localStorage.getItem("astravia-theme")).toBe("light");
	});

	it("切换会同步 <meta name=theme-color>，移动端状态栏不变色", () => {
		const meta = document.createElement("meta");
		meta.name = "theme-color";
		meta.content = "#0d0d0d";
		document.head.append(meta);

		act(() => {
			initTheme();
			root?.render(<Toggle />);
		});
		act(() => {
			document.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#ffffff");
		meta.remove();
	});
});
