import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteErrorPageView, type RouteErrorPageViewLabels } from "./RouteErrorPageView";

const labels: RouteErrorPageViewLabels = {
	bannerTitle: "Page kept re-rendering",
	detailsToggle: "Error details",
	home: "Back home",
	pageTitle: "This page got stuck",
	reloadWindow: "Reload window",
	retry: "Retry",
	retryPage: "Retry this page",
	suggestion: "Reload the window to recover.",
};

const homeAction = <button type="button">Back home</button>;

function render(overrides: Partial<Parameters<typeof RouteErrorPageView>[0]> = {}) {
	return renderToStaticMarkup(
		<RouteErrorPageView
			labels={labels}
			message="Components kept triggering each other (#185)."
			onReloadWindow={() => {}}
			onRetry={() => {}}
			homeAction={homeAction}
			{...overrides}
		/>,
	);
}

describe("RouteErrorPageView", () => {
	it("offers both recovery paths and keeps the home action", () => {
		const markup = render();
		expect(markup).toContain("Retry this page");
		expect(markup).toContain("Reload window");
		expect(markup).toContain("Back home");
	});

	it("puts the reload action first when retrying cannot work", () => {
		const reloadFirst = render({ preferredAction: "reload" });
		expect(reloadFirst.indexOf("Reload window")).toBeLessThan(reloadFirst.indexOf("Retry this page"));

		const retryFirst = render({ preferredAction: "retry" });
		expect(retryFirst.indexOf("Retry this page")).toBeLessThan(retryFirst.indexOf("Reload window"));
	});

	it("folds the technical details behind a disclosure", () => {
		const withoutDetails = render();
		expect(withoutDetails).not.toContain("<details");

		const withDetails = render({ details: "Minified React error #185\n\nComponent stack\n    at QueueCardView" });
		expect(withDetails).toContain("<details");
		expect(withDetails).toContain("Error details");
		expect(withDetails).toContain("at QueueCardView");
	});
});
