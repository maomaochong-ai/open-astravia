import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { CodeBlockCopyButtonView } from "../shared/CodeBlockCopyButton";
import { SyntaxHighlightedCode } from "../shared/SyntaxHighlightedCode";
import type { MarkdownCodeBlockProps } from "./definition";

interface CodeBlockState extends MarkdownCodeBlockProps {
	copied: boolean;
	copy: () => void;
}
const CodeBlockContext = createContext<CodeBlockState | null>(null);

function useCodeBlock(): CodeBlockState {
	const context = useContext(CodeBlockContext);
	if (!context) throw new Error("CodeBlock parts must be used within CodeBlock.Root");
	return context;
}

export function CodeBlockRoot({ children, ...props }: MarkdownCodeBlockProps & { children: ReactNode }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const version = useRef(0);
	useEffect(() => {
		version.current++;
		setCopied(false);
		return () => {
			version.current++;
			clearTimeout(timer.current);
		};
	}, [props.code]);
	const copy = useCallback(() => {
		const current = version.current;
		void navigator.clipboard
			.writeText(props.code)
			.then(() => {
				if (version.current !== current) return;
				setCopied(true);
				clearTimeout(timer.current);
				timer.current = setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {
				if (version.current === current) setCopied(false);
			});
	}, [props.code]);
	return <CodeBlockContext.Provider value={{ ...props, copied, copy }}>{children}</CodeBlockContext.Provider>;
}

export function CodeBlockCopy({ children }: { children: ReactNode }) {
	const { copied, copy, labels } = useCodeBlock();
	return (
		<CodeBlockCopyButtonView copied={copied} onCopy={copy} labels={labels}>
			{children}
		</CodeBlockCopyButtonView>
	);
}

export function CodeBlockFrame({ className, ...props }: ComponentPropsWithoutRef<"div">) {
	return (
		<div
			{...props}
			className={["my-2 overflow-hidden rounded-lg border border-border bg-muted", className]
				.filter(Boolean)
				.join(" ")}
		/>
	);
}

export function CodeBlockLanguage() {
	const { lang } = useCodeBlock();
	return lang ? (
		<div className="border-b border-border px-3 py-1 text-[10px] font-medium text-muted-foreground/50">{lang}</div>
	) : null;
}

export function CodeBlockContent() {
	const { code, lang, theme, live } = useCodeBlock();
	return (
		<SyntaxHighlightedCode code={code} lang={lang} theme={theme} fontSizeClass="text-[13px]" live={live} />
	);
}

export function DefaultCodeBlock(props: MarkdownCodeBlockProps) {
	return (
		<CodeBlockRoot {...props}>
			<CodeBlockCopy>
				<CodeBlockFrame>
					<CodeBlockLanguage />
					<CodeBlockContent />
				</CodeBlockFrame>
			</CodeBlockCopy>
		</CodeBlockRoot>
	);
}

export const CodeBlock = {
	Root: CodeBlockRoot,
	Copy: CodeBlockCopy,
	Frame: CodeBlockFrame,
	Language: CodeBlockLanguage,
	Content: CodeBlockContent,
};
