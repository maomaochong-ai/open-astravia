import type { ReactNode } from "react";
import type { ActivityTabDefinition, ActivityTabId, ActivityTabMeta } from "./types";

type MetaRender = (metaById: ReadonlyMap<ActivityTabId, ActivityTabMeta | null>) => ReactNode;

function MetaFoldStep({
	def,
	metas,
	children,
}: {
	def: ActivityTabDefinition;
	metas: Map<ActivityTabId, ActivityTabMeta | null>;
	children: ReactNode;
}): JSX.Element {
	// 本步调用 useMeta（hooks 归属本组件），写入共享 map 后渲染后续步骤。
	metas.set(def.id, def.useMeta());
	return <>{children}</>;
}

function MetaFold({
	definitions,
	index,
	metas,
	render,
}: {
	definitions: readonly ActivityTabDefinition[];
	index: number;
	metas: Map<ActivityTabId, ActivityTabMeta | null>;
	render: MetaRender;
}): JSX.Element {
	if (index >= definitions.length) {
		return <>{render(metas)}</>;
	}
	return (
		<MetaFoldStep def={definitions[index]!} metas={metas}>
			<MetaFold definitions={definitions} index={index + 1} metas={metas} render={render} />
		</MetaFoldStep>
	);
}

interface ActivityTabMetaHostProps {
	definitions: readonly ActivityTabDefinition[];
	children: MetaRender;
}

/**
 * 嵌套 fold：每个 definition 一层 MetaFoldStep 调用 `useMeta`，收齐后同一 render
 * 内执行 children。避免 effect 收集的首帧空栏，且每个 step 的 hook 序列固定。
 */
export function ActivityTabMetaHost({ definitions, children }: ActivityTabMetaHostProps): JSX.Element {
	const metas = new Map<ActivityTabId, ActivityTabMeta | null>();
	return <MetaFold definitions={definitions} index={0} metas={metas} render={children} />;
}
