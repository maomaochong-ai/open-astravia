import type { ReactNode } from "react";
import { CodeBlockCopyButtonView } from "@vetta/theme-ui/shared";
import { useCodeClipboard } from "@shared/hooks/useCodeClipboard";

interface CodeBlockCopyButtonProps {
	children: ReactNode;
	language?: string;
	code: string;
}

/** Desktop adapter: clipboard state via useCodeClipboard; pure chrome in theme-ui. */
export function CodeBlockCopyButton({ children, code }: CodeBlockCopyButtonProps): JSX.Element {
	const { copied, copy } = useCodeClipboard(code);

	return (
		<CodeBlockCopyButtonView
			copied={copied}
			onCopy={() => {
				void copy();
			}}
			labels={{ copy: "Copy code", copied: "Copied" }}
		>
			{children}
		</CodeBlockCopyButtonView>
	);
}
