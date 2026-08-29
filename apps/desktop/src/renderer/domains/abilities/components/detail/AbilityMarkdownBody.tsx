import { MarkdownPreviewView } from "@vetta/theme-ui/activity";
import { resolvedThemeAtom } from "@shared/store/atoms";
import { cn } from "@vetta/ui";
import { useAtomValue } from "jotai";
import { useCallback } from "react";
import { DETAIL_CARD } from "./ability-detail-surface";

/** 详情正文：`raw.detail.content` 的 markdown（ADR-0049 用 markdown 换运营编辑成本）。 */
export function AbilityMarkdownBody({ content }: { content: string }): JSX.Element | null {
	const theme = useAtomValue(resolvedThemeAtom);
	const onOpenExternal = useCallback((href: string) => {
		void window.vetta.shell.openExternal(href);
	}, []);

	if (!content.trim()) return null;

	return (
		<section className={cn(DETAIL_CARD, "px-3.5 py-3 text-[13px] leading-relaxed [&_.markdown-body]:p-0")}>
			<MarkdownPreviewView content={content} theme={theme} onOpenExternal={onOpenExternal} />
		</section>
	);
}
