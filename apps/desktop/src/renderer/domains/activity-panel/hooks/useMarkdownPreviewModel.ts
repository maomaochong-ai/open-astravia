import { resolvedThemeAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback } from "react";

export interface MarkdownPreviewModel {
	theme: "light" | "dark";
	onOpenExternal: (href: string) => void;
}

export function useMarkdownPreviewModel(): MarkdownPreviewModel {
	const theme = useAtomValue(resolvedThemeAtom);

	const onOpenExternal = useCallback((href: string) => {
		void window.vetta.shell.openExternal(href);
	}, []);

	return {
		theme,
		onOpenExternal,
	};
}
