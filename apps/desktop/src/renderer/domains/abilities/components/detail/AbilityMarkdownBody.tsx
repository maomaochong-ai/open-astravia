import { MarkdownPreviewView } from "@vetta/theme-ui/activity";
import { resolvedThemeAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback } from "react";

/** 详情正文：`raw.detail.content` 的 markdown（ADR-0049 用 markdown 换运营编辑成本）。 */
export function AbilityMarkdownBody({ content }: { content: string }): JSX.Element | null {
	const theme = useAtomValue(resolvedThemeAtom);
	const onOpenExternal = useCallback((href: string) => {
		void window.vetta.shell.openExternal(href);
	}, []);

	if (!content.trim()) return null;

	// MarkdownPreviewView 自带 p-4，详情页正文不需要内边距
	return (
		<section className="text-[13px] leading-relaxed [&_.markdown-body]:p-0">
			<MarkdownPreviewView content={content} theme={theme} onOpenExternal={onOpenExternal} />
		</section>
	);
}
