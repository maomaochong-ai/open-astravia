export interface PlanReviewPanelLabels {
	title: string;
	subtitle: string;
	approve: string;
	requestChanges: string;
	sendFeedback: (commentCount: number) => string;
	back: string;
	dismiss: string;
	edit: string;
	doneEditing: string;
	edited: string;
	resetEdits: string;
	editorLabel: string;
	feedbackLabel: string;
	feedbackPlaceholder: string;
	commentOnStep: (stepNumber: number) => string;
	stepCommentPlaceholder: string;
}

export interface PlanReviewPanelViewProps {
	/** 模型提交的计划正文（Markdown）。 */
	plan: string;
	labels: PlanReviewPanelLabels;
	/** `editedPlan` 仅在用户改过正文时提供。 */
	onApprove: (editedPlan?: string) => void;
	onRequestChanges: (feedback: string, editedPlan?: string) => void;
	onDismiss: () => void;
	className?: string;
}
