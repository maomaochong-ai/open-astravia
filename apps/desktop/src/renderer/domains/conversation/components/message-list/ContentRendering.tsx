import type { ContentBlock } from "@shared/conversation";
import { createContext, useContext, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";

export interface ContentRendererProps {
	readonly block: ContentBlock;
	readonly isStreamingTail?: boolean;
	readonly exportMode?: boolean;
	/** The scenario's default presentation; an extension may replace or decorate it. */
	readonly children: ReactNode;
}

export type ContentRenderers = Partial<Record<ContentBlock["type"], ComponentType<ContentRendererProps>>>;
const ContentRenderingContext = createContext<ContentRenderers>({});

export function ContentRenderingProvider({
	renderers,
	children,
}: {
	renderers: ContentRenderers;
	children: ReactNode;
}) {
	const inherited = useContext(ContentRenderingContext);
	const composed = useMemo(() => ({ ...inherited, ...renderers }), [inherited, renderers]);
	return <ContentRenderingContext.Provider value={composed}>{children}</ContentRenderingContext.Provider>;
}

export function ContentRenderer(props: ContentRendererProps) {
	const Renderer = useContext(ContentRenderingContext)[props.block.type];
	return Renderer ? <Renderer {...props} /> : <>{props.children}</>;
}
