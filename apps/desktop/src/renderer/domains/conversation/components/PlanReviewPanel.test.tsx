// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
	}),
}));
vi.mock("./blocks/TextBlock", () => ({
	MarkdownContent: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));
vi.mock("@vetta-org/theme-ui/appearance", () => ({ ThemeSurface: () => null }));

const { PlanReviewPanel } = await import("./PlanReviewPanel.js");

const PLAN = ["## Goal", "Ship plan mode.", "", "1. Add the gate", "2. Wire the UI", "3. Write tests"].join("\n");
const pending = { requestId: "review-1", sessionId: "session-1", plan: PLAN };

describe("PlanReviewPanel", () => {
	const respondToPlanReview = vi.fn(async () => undefined);

	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(window, "vetta", { configurable: true, value: { session: { respondToPlanReview } } });
	});
	afterEach(cleanup);

	it("shows the plan and approves it unchanged in one click", async () => {
		const user = userEvent.setup();
		render(<PlanReviewPanel pending={pending} />);

		expect(screen.getByRole("heading", { name: "planMode.review.title" })).toBeTruthy();
		expect(screen.getAllByTestId("markdown").map((node) => node.textContent)).toEqual([
			"## Goal\nShip plan mode.",
			"1. Add the gate",
			"2. Wire the UI",
			"3. Write tests",
		]);

		await user.click(screen.getByRole("button", { name: "planMode.review.approve" }));
		expect(respondToPlanReview).toHaveBeenCalledWith("review-1", { decision: "approve" });
	});

	it("sends step comments and overall feedback back as one revision request", async () => {
		const user = userEvent.setup();
		render(<PlanReviewPanel pending={pending} />);

		await user.click(screen.getByRole("button", { name: 'planMode.review.commentOnStep:{"number":2}' }));
		await user.type(screen.getByRole("textbox", { name: 'planMode.review.commentOnStep:{"number":2}' }), "拆成两步");

		// 写了逐条意见后，主操作变成把意见发回去。
		await user.click(screen.getByRole("button", { name: 'planMode.review.sendFeedbackWithComments:{"count":1}' }));
		await user.type(screen.getByRole("textbox", { name: "planMode.review.feedbackLabel" }), "先别动数据库");
		await user.click(screen.getByRole("button", { name: 'planMode.review.sendFeedbackWithComments:{"count":1}' }));

		expect(respondToPlanReview).toHaveBeenCalledWith("review-1", {
			decision: "revise",
			feedback: "先别动数据库\n\nComments on specific steps:\n- Step 2 (Wire the UI): 拆成两步",
		});
	});

	it("requires something to send before a revision request can be submitted", async () => {
		const user = userEvent.setup();
		render(<PlanReviewPanel pending={pending} />);

		await user.click(screen.getByRole("button", { name: "planMode.review.requestChanges" }));
		const send = screen.getByRole("button", { name: "planMode.review.sendFeedback" });
		expect(send).toHaveProperty("disabled", true);

		await user.click(screen.getByRole("button", { name: "planMode.review.back" }));
		expect(screen.getByRole("button", { name: "planMode.review.approve" })).toBeTruthy();
		expect(respondToPlanReview).not.toHaveBeenCalled();
	});

	it("approves the user's edited plan and lets them reset the edit", async () => {
		const user = userEvent.setup();
		render(<PlanReviewPanel pending={pending} />);

		await user.click(screen.getByRole("button", { name: "planMode.review.edit" }));
		const editor = screen.getByRole("textbox", { name: "planMode.review.editorLabel" });
		await user.clear(editor);
		await user.type(editor, "1. Only the gate");
		await user.click(screen.getByRole("button", { name: "planMode.review.doneEditing" }));

		expect(screen.getByText("planMode.review.edited")).toBeTruthy();
		expect(screen.getByTestId("markdown").textContent).toBe("1. Only the gate");
		await user.click(screen.getByRole("button", { name: "planMode.review.approve" }));
		expect(respondToPlanReview).toHaveBeenCalledWith("review-1", { decision: "approve", plan: "1. Only the gate" });
	});

	it("restores the submitted plan when the edit is reset", async () => {
		const user = userEvent.setup();
		render(<PlanReviewPanel pending={pending} />);
		await user.click(screen.getByRole("button", { name: "planMode.review.edit" }));
		await user.type(screen.getByRole("textbox", { name: "planMode.review.editorLabel" }), " extra");
		await user.click(screen.getByRole("button", { name: "planMode.review.doneEditing" }));
		await user.click(screen.getByRole("button", { name: "planMode.review.resetEdits" }));

		expect(screen.queryByText("planMode.review.edited")).toBeNull();
		await user.click(screen.getByRole("button", { name: "planMode.review.approve" }));
		expect(respondToPlanReview).toHaveBeenCalledWith("review-1", { decision: "approve" });
	});

	it("leaves the plan undecided when the user postpones, and locks the panel while the answer is in flight", async () => {
		const user = userEvent.setup();
		render(<PlanReviewPanel pending={pending} />);
		const panel = screen.getByRole("region", { name: "planMode.review.title" });

		await user.click(within(panel).getByRole("button", { name: "planMode.review.dismiss" }));
		await waitFor(() => expect(respondToPlanReview).toHaveBeenCalledWith("review-1", { decision: "cancelled" }));
		// 决定已发出、面板等待主进程收起期间，不能再发出第二个相互矛盾的决定。
		expect(within(panel).getByRole("button", { name: "planMode.review.approve" })).toHaveProperty("disabled", true);
	});
});
