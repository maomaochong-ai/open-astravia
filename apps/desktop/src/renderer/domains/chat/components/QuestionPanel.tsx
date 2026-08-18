import type { PendingQuestion } from "@shared/store/atoms";
import { useThemeComponent } from "@vetta/theme-sdk";
import { useQuestionPanelModel } from "../hooks/useQuestionPanelModel";
import { QuestionPanelView } from "./question-panel/QuestionPanelView";
import type { QuestionPanelClassNames } from "./question-panel/types";

export function QuestionPanel({
	pending,
	className,
	classNames,
}: {
	pending: PendingQuestion;
	className?: string;
	classNames?: QuestionPanelClassNames;
}): JSX.Element {
	const model = useQuestionPanelModel(pending);
	const ThemedQuestionPanelView = useThemeComponent("chat.questionPanelView", QuestionPanelView);

	return (
		<ThemedQuestionPanelView
			pending={pending}
			className={className}
			classNames={classNames}
			labels={model.labels}
			onSubmitAnswers={model.onSubmitAnswers}
			onCancel={model.onCancel}
		/>
	);
}

export type { QuestionPanelViewProps } from "./question-panel/types";
