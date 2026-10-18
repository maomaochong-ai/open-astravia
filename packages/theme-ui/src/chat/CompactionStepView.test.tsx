import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactionStepView } from "./CompactionStepView";

describe("CompactionStepView", () => {
	it("shows the summary that replaced earlier context once opened", () => {
		const closed = renderToStaticMarkup(
			<CompactionStepView status="success" label="Context compacted" detail="120k tokens before" summary="earlier work" />,
		);
		expect(closed).toContain("Context compacted");
		expect(closed).toContain("120k tokens before");
		expect(closed).toContain('aria-expanded="false"');
		expect(closed).not.toContain("earlier work");

		const open = renderToStaticMarkup(
			<CompactionStepView status="success" label="Context compacted" summary="earlier work" expanded />,
		);
		expect(open).toContain('aria-expanded="true"');
		expect(open).toContain("earlier work");
	});

	it("cannot open while running because there is no summary yet", () => {
		const markup = renderToStaticMarkup(<CompactionStepView status="running" label="Compacting context…" />);
		expect(markup).toContain('data-compaction-step="running"');
		expect(markup).toContain("disabled");
		expect(markup).toContain("tool-call-shimmer-text");
	});

	it("auto-expands summary panel while streaming so user can follow in real time", () => {
		const markup = renderToStaticMarkup(
			<CompactionStepView status="running" label="Compacting context…" summary="Partial summary so far…" />,
		);
		expect(markup).toContain('data-compaction-step="running"');
		expect(markup).not.toContain("disabled");
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).toContain("Partial summary so far…");
		expect(markup).toContain("tool-call-shimmer-text");
	});

	it("keeps a failed compaction visibly distinct", () => {
		const markup = renderToStaticMarkup(<CompactionStepView status="error" label="Context compaction failed" />);
		expect(markup).toContain("icon-[solar--danger-circle-linear]");
		expect(markup).toContain("text-destructive/80");
	});

	it("renders the summary through the host-supplied renderer when given one", () => {
		// 摘要是模型写的叙述，宿主注入的渲染器负责把它变成 Markdown 预览；
		// 注入时不能再退化成 whitespace-pre-wrap 的原文墙。
		const markup = renderToStaticMarkup(
			<CompactionStepView
				status="success"
				label="Context compacted"
				summary="**bold** summary"
				expanded
				renderSummary={(summary) => <strong data-testid="rendered-summary">{summary.toUpperCase()}</strong>}
			/>,
		);
		expect(markup).toContain("**BOLD** SUMMARY");
		expect(markup).not.toContain("whitespace-pre-wrap");
	});
});
