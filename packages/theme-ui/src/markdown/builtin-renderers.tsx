import { lazy, Suspense } from "react";
import { CodeBlock, DefaultCodeBlock } from "./CodeBlock";
import type { MarkdownCodeBlockProps } from "./definition";

const LazyMath = lazy(() => import("./MathFormula").then((module) => ({ default: module.MathFormula })));
const LazyRichCode = lazy(() => import("./RichCodeBlock").then((module) => ({ default: module.RichCodeBlock })));

export function Formula(props: { source: string; display: boolean; live?: boolean }) {
	return (
		<Suspense fallback={<code>{props.source}</code>}>
			<LazyMath {...props} />
		</Suspense>
	);
}

export function BuiltinCodeBlock(props: MarkdownCodeBlockProps) {
	if (/^(?:html|svg)$/i.test(props.lang)) {
		return (
			<Suspense fallback={<DefaultCodeBlock {...props} live />}>
				<LazyRichCode {...props} />
			</Suspense>
		);
	}
	if (/^(?:math|latex|tex)$/i.test(props.lang))
		return (
			<CodeBlock.Root {...props}>
				<CodeBlock.Copy>
					<CodeBlock.Frame>
						<Formula source={props.code} display live={props.live} />
					</CodeBlock.Frame>
				</CodeBlock.Copy>
			</CodeBlock.Root>
		);
	return <DefaultCodeBlock {...props} />;
}
