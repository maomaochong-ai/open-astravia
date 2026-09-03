import {
	AskUserQuestionView as ThemeAskUserQuestionView,
	type AskUserQuestionItem,
} from "@vetta/theme-ui/chat";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** Minimal block shape; avoid @shared/store so inventory is not dataHeavy. */
interface AskUserQuestionBlock {
	toolCallId: string;
	args: Record<string, unknown>;
	uiDetails?: {
		askUserQuestion?: {
			cancelled?: boolean;
			answers?: Array<{ question: string; answers: string[] }>;
		};
	};
}

interface AskUserQuestionViewProps {
	block: AskUserQuestionBlock;
}

function parseQuestions(args: Record<string, unknown>): AskUserQuestionItem[] {
	const raw = args.questions;
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((q): q is Record<string, unknown> => typeof q === "object" && q !== null)
		.map((q) => ({
			question: typeof q.question === "string" ? q.question : "",
			header: typeof q.header === "string" ? q.header : "",
			multiSelect: q.multiSelect === true,
			options: Array.isArray(q.options)
				? (q.options as Array<Record<string, unknown>>).map((o) => ({
						label: typeof o.label === "string" ? o.label : "",
						description: typeof o.description === "string" ? o.description : "",
						badges: Array.isArray(o.badges)
							? (o.badges.filter((b) => typeof b === "string") as string[])
							: undefined,
					}))
				: [],
		}));
}

/**
 * ask_user_question 的 transcript 富视图：回显问题与用户最终所选答案。
 * Desktop adapter: parse block + i18n labels → theme-ui view.
 */
export function AskUserQuestionView({ block }: AskUserQuestionViewProps): JSX.Element | null {
	const { t } = useTranslation("chat");
	const questions = parseQuestions(block.args);
	const resolution = block.uiDetails?.askUserQuestion;
	const cancelled = resolution?.cancelled === true;
	const answersByQuestion = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const a of resolution?.answers ?? []) map.set(a.question, a.answers);
		return map;
	}, [resolution?.answers]);

	return (
		<ThemeAskUserQuestionView
			toolCallId={block.toolCallId}
			questions={questions}
			cancelled={cancelled}
			answersByQuestion={answersByQuestion}
			labels={{
				defaultQuestionLabel: (number) => t("askUserQuestion.defaultQuestionLabel", { number }),
				cancelledMessage: t("askUserQuestion.cancelledMessage"),
			}}
		/>
	);
}
