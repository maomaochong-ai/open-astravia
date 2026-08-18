import type { PendingQuestion } from "@shared/store/atoms";
import { pendingQuestionsAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { QuestionPanelLabels } from "../components/question-panel/types";

export interface QuestionPanelModel {
	labels: QuestionPanelLabels;
	onSubmitAnswers: (answers: Array<{ question: string; answers: string[] }>) => void;
	onCancel: () => void;
}

export function useQuestionPanelModel(pending: PendingQuestion): QuestionPanelModel {
	const { t } = useTranslation(["chat", "common"]);
	const setPendingQuestions = useSetAtom(pendingQuestionsAtom);

	const remove = useCallback(() => {
		setPendingQuestions((prev) => {
			const next = { ...prev };
			delete next[pending.sessionId];
			return next;
		});
	}, [pending.sessionId, setPendingQuestions]);

	const onSubmitAnswers = useCallback(
		(answers: Array<{ question: string; answers: string[] }>) => {
			void window.vetta.session.respondToQuestion(pending.requestId, { cancelled: false, answers });
			remove();
		},
		[pending.requestId, remove],
	);

	const onCancel = useCallback(() => {
		void window.vetta.session.respondToQuestion(pending.requestId, { cancelled: true, answers: [] });
		remove();
	}, [pending.requestId, remove]);

	const labels = useMemo<QuestionPanelLabels>(
		() => ({
			title: t("questionPanel.title"),
			questionTabLabel: (number) => t("questionPanel.questionTabLabel", { number }),
			keyboardHint: t("questionPanel.keyboardHint"),
			cancel: t("common:actions.cancel"),
			next: t("questionPanel.nextButton"),
			submit: t("questionPanel.submitButton"),
			multiSelectHint: t("questionPanel.multiSelectHint"),
			otherOption: t("questionPanel.otherOption"),
			otherPlaceholder: t("questionPanel.otherPlaceholder"),
		}),
		[t],
	);

	return { labels, onSubmitAnswers, onCancel };
}
