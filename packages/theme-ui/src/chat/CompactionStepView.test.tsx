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

	it("keeps a failed compaction visibly distinct", () => {
		const markup = renderToStaticMarkup(<CompactionStepView status="error" label="Context compaction failed" />);
		expect(markup).toContain("icon-[solar--danger-circle-linear]");
		expect(markup).toContain("text-destructive/80");
	});
});
