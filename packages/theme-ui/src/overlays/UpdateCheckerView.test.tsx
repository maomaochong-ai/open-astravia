import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdateCheckerDetail, type UpdateCheckerViewLabels } from "./UpdateCheckerView";
// 从 barrel 取归一化函数：desktop 侧读的是同一入口，这条引用保证导出没被删改。
import { normalizeReleaseNote } from "./index";

const labels: UpdateCheckerViewLabels = {
	check: "Check for updates",
	checking: "Checking",
	checkingBtn: "Checking",
	currentVersion: (version) => `Current ${version}`,
	download: "Download",
	downloading: (progress) => `Downloading ${progress}%`,
	idle: (version) => `Up to date (${version})`,
	newVersion: (version) => `Version ${version}`,
	restart: "Restart",
	viewMore: "View more",
};

// electron-updater 的 GitHub provider 取的是 Atom feed 里已经渲染过的 HTML。
const FEED_HTML =
	"<h2>新增</h2><ul><li><strong>内置浏览器可以从标签页菜单添加了</strong>：现在它按普通面板参与可见性解析。</li></ul>";

const notesMarkdown = "## 新增\n\n- **内置浏览器可以从标签页菜单添加了**：现在它按普通面板参与可见性解析。";

function renderDetail(releaseNote: string): string {
	return renderToStaticMarkup(
		<UpdateCheckerDetail
			currentVersion="0.5.73"
			labels={labels}
			latestVersion="0.5.77"
			onPrimary={() => {}}
			onViewMore={() => {}}
			phase="available"
			releaseNote={releaseNote}
		/>,
	);
}

describe("UpdateCheckerDetail", () => {
	it("renders the release note html as structured text instead of showing the tags", () => {
		const html = renderDetail(FEED_HTML);

		expect(html).toContain("<h2");
		expect(html).toContain("<strong>内置浏览器可以从标签页菜单添加了</strong>");
		expect(html).toContain("<li>");
		expect(html).not.toContain("&lt;h2&gt;");
		expect(html).not.toContain("&lt;ul&gt;");
	});

	it("renders the markdown release notes the same way", () => {
		const html = renderDetail(notesMarkdown);

		expect(html).toContain("<h2");
		expect(html).toContain("<strong>内置浏览器可以从标签页菜单添加了</strong>");
		expect(html).not.toContain("**内置浏览器");
	});

	it("clamps the note to a fixed height so it cannot cover the rows below", () => {
		const html = renderDetail(FEED_HTML);

		expect(html).toContain("max-height:240px");
		expect(html).toContain("overflow-hidden");
	});

	it("exports the release-note normaliser through the package barrel", () => {
		expect(normalizeReleaseNote(FEED_HTML)).toBe(notesMarkdown);
	});
});
