/**
 * 新会话页输入框下方的「设计资源」区。
 *
 * 选中设计师（或含设计师的团队）、或在输入框里提到本插件的 skill 时由宿主唤起。摆出当前
 * 项目已有的设计稿，让「接着改哪一份」变成点一下，而不是让用户回忆并手打一个路径。
 */
import type { PluginNewSessionContext } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { getPluginCtx } from "../plugin-context";
import { type GalleryDesign, scanProjectDesigns } from "../gallery/gallery-model";

export interface DesignResourcesBlockProps {
	readonly context: PluginNewSessionContext;
}

export function DesignResourcesBlock({ context }: DesignResourcesBlockProps): JSX.Element {
	const { cwd } = context;
	const [designs, setDesigns] = useState<readonly GalleryDesign[] | undefined>(undefined);

	useEffect(() => {
		if (!cwd) {
			setDesigns([]);
			return;
		}
		let cancelled = false;
		setDesigns(undefined);
		// 只扫项目根一层，与画廊同一条规则：递归一个大仓库会让这块区域迟迟出不来。
		void scanProjectDesigns(getPluginCtx().fs, cwd).then(
			(found) => {
				if (!cancelled) setDesigns(found);
			},
			() => {
				if (!cancelled) setDesigns([]);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	if (designs === undefined) {
		return <p className="px-1 py-2 text-[12px] text-muted-foreground">正在查找设计稿…</p>;
	}

	if (designs.length === 0) {
		return (
			<p className="px-1 py-2 text-[12px] text-muted-foreground">
				{cwd ? "这个项目里还没有设计稿，直接描述你想要的界面即可。" : "先选一个项目，这里会列出其中的设计稿。"}
			</p>
		);
	}

	return (
		<div className="flex flex-wrap gap-1.5">
			{designs.map((design) => (
				<button
					key={design.vetdPath}
					type="button"
					title={design.vetdPath}
					onClick={() => {
						// 目录附件 + 一句话草稿：模型既拿到确切路径，用户也看得见自己选了什么。
						context.composer.attach({
							id: `vetta-ui-design:${design.vetdPath}`,
							label: design.name,
							metadata: { vetdPath: design.vetdPath },
						});
						context.composer.insertText(`继续编辑 ${design.name}.vetd`);
					}}
					className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-[12px] text-foreground transition-colors hover:border-primary/40 hover:bg-accent/40"
				>
					<span className="icon-[solar--figma-linear] h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
					<span className="truncate">{design.name}</span>
				</button>
			))}
		</div>
	);
}
