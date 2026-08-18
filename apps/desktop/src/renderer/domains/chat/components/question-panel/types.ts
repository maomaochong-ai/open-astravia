/** Local question shapes (avoid importing @shared/store so inventory is not dataHeavy). */
export interface QuestionOption {
	label: string;
	description: string;
	badges?: string[];
}

export interface QuestionItem {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect?: boolean;
}

export interface PendingQuestionModel {
	requestId: string;
	sessionId: string;
	questions: QuestionItem[];
}

export interface QuestionPanelClassNames {
	root?: string;
	panel?: string;
	content?: string;
	body?: string;
	footer?: string;
}

export interface QuestionPanelLabels {
	title: string;
	questionTabLabel: (number: number) => string;
	keyboardHint: string;
	cancel: string;
	/** 多题且未到最后一题时的主按钮文案。 */
	next: string;
	/** 单题或最后一题时的主按钮文案。 */
	submit: string;
	multiSelectHint: string;
	otherOption: string;
	otherPlaceholder: string;
}

export interface QuestionPanelProps {
	pending: PendingQuestionModel;
	className?: string;
	classNames?: QuestionPanelClassNames;
}

export interface QuestionPanelViewProps extends QuestionPanelProps {
	labels: QuestionPanelLabels;
	onSubmitAnswers: (answers: Array<{ question: string; answers: string[] }>) => void;
	onCancel: () => void;
}
