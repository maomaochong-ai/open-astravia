import { ThinkingBlock } from "@vetta/theme-ui/chat";
import { useTranslation } from "react-i18next";

interface ThinkingBlockProps {
	readonly text: string;
	readonly exportMode?: boolean;
	readonly title?: string;
}

export function ThinkingBlockView({
	text,
	exportMode = false,
	title,
}: ThinkingBlockProps): JSX.Element {
	const { t } = useTranslation("chat");
	const resolvedTitle = title ?? t("thinkingBlock.title");
	return (
		<ThinkingBlock.Root exportMode={exportMode}>
			<ThinkingBlock.Frame>
				<ThinkingBlock.Trigger
					data-export-label-collapsed={resolvedTitle}
					data-export-label-expanded={resolvedTitle}
				>
					<ThinkingBlock.Icon />
					<ThinkingBlock.Title>{resolvedTitle}</ThinkingBlock.Title>
					<ThinkingBlock.LineCount>
						{t("thinkingBlock.lineCount", { count: text.split("\n").length })}
					</ThinkingBlock.LineCount>
					<ThinkingBlock.Chevron />
				</ThinkingBlock.Trigger>
				<ThinkingBlock.Content>{text}</ThinkingBlock.Content>
			</ThinkingBlock.Frame>
		</ThinkingBlock.Root>
	);
}

/** Work narration keeps the same behavior and layout but omits the technical line count. */
export function ConciseThinkingBlockView({
	text,
	exportMode = false,
	title,
}: ThinkingBlockProps): JSX.Element {
	const { t } = useTranslation("chat");
	const resolvedTitle = title ?? t("thinkingBlock.title");
	return (
		<ThinkingBlock.Root exportMode={exportMode}>
			<ThinkingBlock.Frame>
				<ThinkingBlock.Trigger
					data-export-label-collapsed={resolvedTitle}
					data-export-label-expanded={resolvedTitle}
				>
					<ThinkingBlock.Icon />
					<ThinkingBlock.Title>{resolvedTitle}</ThinkingBlock.Title>
					<ThinkingBlock.Chevron />
				</ThinkingBlock.Trigger>
				<ThinkingBlock.Content>{text}</ThinkingBlock.Content>
			</ThinkingBlock.Frame>
		</ThinkingBlock.Root>
	);
}
