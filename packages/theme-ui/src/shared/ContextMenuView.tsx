import {
	cn,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@vetta/ui";
import type { JSX } from "react";

/**
 * 通用右键菜单节点树。支持任意层级嵌套（submenu 里还能再放 submenu），
 * 交给 radix 承担对角线移动、边界翻转、键盘导航——手写菜单做不全这些。
 */
export type ContextMenuNode =
	| {
			kind: "item";
			id: string;
			label: string;
			/** iconify class，例如 `icon-[solar--pin-linear]` */
			iconClassName?: string;
			/** 左侧圆点颜色，用于标签这类以颜色为身份的菜单项 */
			dotColor?: string;
			/** 右侧勾选态 */
			checked?: boolean;
			danger?: boolean;
			disabled?: boolean;
			onSelect: () => void;
	  }
	| {
			kind: "submenu";
			id: string;
			label: string;
			iconClassName?: string;
			items: readonly ContextMenuNode[];
	  }
	| { kind: "separator"; id: string };

export interface ContextMenuViewProps {
	items: readonly ContextMenuNode[];
	onClose: () => void;
	/** 光标位置（视口坐标） */
	x: number;
	y: number;
	className?: string;
}

const LABEL_CLASS = "flex-1 truncate text-[12px] font-medium";

function NodeIcon({
	iconClassName,
	dotColor,
}: {
	iconClassName?: string;
	dotColor?: string;
}): JSX.Element | null {
	if (dotColor) {
		return (
			<span
				aria-hidden="true"
				data-context-menu-dot="true"
				className="h-2.5 w-2.5 shrink-0 rounded-full"
				style={{ backgroundColor: dotColor }}
			/>
		);
	}
	if (iconClassName) return <span aria-hidden="true" className={cn(iconClassName, "h-3.5 w-3.5 shrink-0")} />;
	return null;
}

function renderNodes(nodes: readonly ContextMenuNode[]): JSX.Element[] {
	return nodes.map((node) => {
		if (node.kind === "separator") return <DropdownMenuSeparator key={node.id} />;
		if (node.kind === "submenu") {
			return (
				<DropdownMenuSub key={node.id}>
					<DropdownMenuSubTrigger className="px-2 py-[5px]">
						<NodeIcon iconClassName={node.iconClassName} />
						<span className={LABEL_CLASS}>{node.label}</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-[60vh] w-[180px] overflow-y-auto">
						{renderNodes(node.items)}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			);
		}
		return (
			<DropdownMenuItem
				key={node.id}
				disabled={node.disabled}
				onSelect={node.onSelect}
				className={cn("px-2 py-[5px]", node.danger && "text-destructive")}
			>
				<NodeIcon iconClassName={node.iconClassName} dotColor={node.dotColor} />
				<span className={LABEL_CLASS}>{node.label}</span>
				{node.checked ? (
					<span aria-hidden="true" className="icon-[solar--check-read-linear] h-3.5 w-3.5 shrink-0 text-primary" />
				) : null}
			</DropdownMenuItem>
		);
	});
}

/**
 * 以 `{x,y}` 处一个 0×0 的虚拟锚点驱动 radix 菜单，
 * 从而保留调用方现有的「全局单例菜单 + 坐标」模型（见 sessionContextMenuAtom）。
 */
export function ContextMenuView({ items, onClose, x, y, className }: ContextMenuViewProps): JSX.Element {
	return (
		<DropdownMenu
			open
			modal={false}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DropdownMenuTrigger asChild>
				<span aria-hidden="true" className="fixed h-0 w-0" style={{ left: `${x}px`, top: `${y}px` }} />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				side="bottom"
				sideOffset={0}
				className={cn("w-[170px]", className)}
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				{renderNodes(items)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
