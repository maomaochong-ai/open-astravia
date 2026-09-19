import type { ReactNode } from "react";
import type { ActivityTabDefinition, ActivityTabId, ActivityTabMeta } from "./types";

type MetaById = ReadonlyMap<ActivityTabId, ActivityTabMeta | null>;
type MetaRender = (metaById: MetaById) => ReactNode;

interface MetaFoldProps {
	definitions: readonly ActivityTabDefinition[];
	index: number;
	/** 上游各步已经收集到的 meta；每一步产出新的 Map，而不是改写共享对象。 */
	metas: MetaById;
	render: MetaRender;
}

/**
 * 调用本步 definition 的 `useMeta`（hooks 归属本组件），并在**自己的 render 里**创建下游。
 *
 * 下游必须由本步渲染、meta 必须经 props 向下传：`useMeta` 订阅的数据变化时只有这一步会重渲，
 * 如果下游是父级传进来的现成 children，React 会因 props 引用未变而跳过它，tab 栏就停在旧状态，
 * 直到面板因为别的原因整体重渲（表现为待办 / 计划页要退出会话再进来才出现）。
 */
function MetaFoldStep({ definitions, index, metas, render }: MetaFoldProps): JSX.Element {
	const definition = definitions[index]!;
	const meta = definition.useMeta();
	const next = new Map(metas);
	next.set(definition.id, meta);
	return <MetaFold definitions={definitions} index={index + 1} metas={next} render={render} />;
}

function MetaFold(props: MetaFoldProps): JSX.Element {
	if (props.index >= props.definitions.length) return <>{props.render(props.metas)}</>;
	return <MetaFoldStep {...props} />;
}

interface ActivityTabMetaHostProps {
	definitions: readonly ActivityTabDefinition[];
	children: MetaRender;
}

const NO_METAS: MetaById = new Map();

/**
 * 嵌套 fold：每个 definition 一层 MetaFoldStep 调用 `useMeta`，收齐后同一 render
 * 内执行 children。避免 effect 收集的首帧空栏，且每个 step 的 hook 序列固定。
 */
export function ActivityTabMetaHost({ definitions, children }: ActivityTabMetaHostProps): JSX.Element {
	return <MetaFold definitions={definitions} index={0} metas={NO_METAS} render={children} />;
}
