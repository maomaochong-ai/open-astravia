import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdateRestartDialogView } from "./UpdateRestartDialogView";

const labels = {
	install: "Restart now",
	later: "Later",
	message: "Astravia 0.5.77 is ready to install.",
	title: "Restart to update",
};

// electron-updater 的 GitHub provider 取的是 Atom feed 里已经渲染过的 HTML。
const FEED_HTML = "<h2>新增</h2><ul><li><strong>内置浏览器</strong>可以从标签页菜单添加了</li></ul>";

function renderDialog(releaseNote: string): string {
	return renderToStaticMarkup(
		<UpdateRestartDialogView
			labels={labels}
			onClose={() => {}}
			onInstall={() => {}}
			overlayRef={createRef<HTMLDivElement>()}
			releaseNote={releaseNote}
			visible
		/>,
	);
}

describe("UpdateRestartDialogView", () => {
	it("shows the release note as text instead of printing its tags", () => {
		const html = renderDialog(FEED_HTML);

		expect(html).toContain("<h2>新增</h2>");
		expect(html).toContain("<strong>内置浏览器</strong>");
		expect(html).not.toContain("&lt;h2&gt;");
		expect(html).not.toContain("&lt;ul&gt;");
	});

	it("renders markdown notes unchanged", () => {
		const html = renderDialog("## 新增\n\n- **内置浏览器**可以从标签页菜单添加了");

		expect(html).toContain("<h2>新增</h2>");
		expect(html).toContain("<strong>内置浏览器</strong>");
	});
});
