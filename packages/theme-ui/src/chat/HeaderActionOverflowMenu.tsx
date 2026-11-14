import { Fragment, type JSX, type ReactNode, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@astravia-org/ui";
import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
import type { HeaderActionBarItem } from "./HeaderActionBarView";
import { narrowOverflowBadge } from "./header-action-narrow";

function MenuIcon({ children }: { readonly children: ReactNode }): JSX.Element {
	return (
		<span className="pointer-events-none flex size-4 shrink-0 items-center justify-center overflow-hidden text-[14px] [&>*]:max-h-4 [&>*]:max-w-4">
			{children}
		</span>
	);
}

function OverflowRowBody({ item }: { readonly item: HeaderActionBarItem }): JSX.Element {
	const count = typeof item.badge === "number" && item.badge > 0 ? item.badge : undefined;
	return (
		<>
			<MenuIcon>{item.icon}</MenuIcon>
			<span className="min-w-0 flex-1 truncate">{item.title}</span>
			{item.badge === true ? <span className="size-1.5 shrink-0 rounded-full bg-red-500" /> : null}
			{count !== undefined ? (
				<span className="flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] leading-none font-semibold text-white tabular-nums">
					{count > 99 ? "99+" : count}
				</span>
			) : null}
		</>
	);
}

function OverflowEntry({
	item,
	onClose,
}: {
	readonly item: HeaderActionBarItem;
	readonly onClose: () => void;
}): JSX.Element {
	const { behavior } = item;
	const activeClass = item.active ? "bg-foreground/[0.06]" : undefined;
	if (behavior.type === "menu") {
		return (
			<DropdownMenuSub>
				<DropdownMenuSubTrigger
					disabled={item.disabled}
					className={activeClass}
					data-header-action-overflow-item={item.key}
				>
					<OverflowRowBody item={item} />
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="min-w-40">
					{behavior.items.map((entry) => (
						<Fragment key={entry.id}>
							{entry.separatorBefore ? <DropdownMenuSeparator /> : null}
							<DropdownMenuItem
								disabled={entry.disabled}
								onSelect={() => {
									entry.onSelect();
									onClose();
								}}
								className={entry.destructive ? "text-destructive focus:text-destructive" : undefined}
							>
								{entry.icon ? <MenuIcon>{entry.icon}</MenuIcon> : null}
								{entry.label}
							</DropdownMenuItem>
						</Fragment>
					))}
				</DropdownMenuSubContent>
			</DropdownMenuSub>
		);
	}
	if (behavior.type === "popover") {
		return (
			<DropdownMenuSub>
				<DropdownMenuSubTrigger
					disabled={item.disabled}
					className={activeClass}
					data-header-action-overflow-item={item.key}
				>
					<OverflowRowBody item={item} />
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="w-max max-h-[min(70vh,32rem)] max-w-[min(92vw,32rem)] overflow-auto p-2">
					{behavior.render({ close: onClose })}
				</DropdownMenuSubContent>
			</DropdownMenuSub>
		);
	}
	return (
		<DropdownMenuItem
			disabled={item.disabled}
			className={activeClass}
			data-header-action-overflow-item={item.key}
			onSelect={() => behavior.onClick()}
		>
			<OverflowRowBody item={item} />
		</DropdownMenuItem>
	);
}

/** 页头挤窄时替代整排按钮的那一个下拉：点开仍能用到原来的动作。 */
export function HeaderActionOverflowMenu({
	items,
	label,
}: {
	readonly items: readonly HeaderActionBarItem[];
	readonly label: string;
}): JSX.Element {
	const [menuOpen, setMenuOpen] = useState(false);
	return (
		<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<ButtonGroup blur={false}>
				<DropdownMenuTrigger asChild>
					<ButtonGroupItem
						title={label}
						aria-label={label}
						data-header-action-overflow="true"
						badge={narrowOverflowBadge(items)}
						icon={<span className="icon-[solar--menu-dots-bold] pointer-events-none text-[14px]" />}
					/>
				</DropdownMenuTrigger>
			</ButtonGroup>
			<DropdownMenuContent align="end" sideOffset={6} className="min-w-44">
				{items.map((item) => (
					<OverflowEntry key={item.key} item={item} onClose={() => setMenuOpen(false)} />
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
