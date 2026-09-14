import type { JSX, ReactNode } from "react";
import {
	Button,
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface AppearanceApprovalDrawerViewLabels {
	readonly confirm: string;
	readonly permission: string;
	readonly reject: string;
	readonly responding: string;
}

export interface AppearanceApprovalDrawerViewProps {
	readonly canConfirm: boolean;
	readonly children: ReactNode;
	readonly countdown: string;
	readonly error: string | null;
	readonly labels: AppearanceApprovalDrawerViewLabels;
	readonly onConfirm: () => void;
	readonly onReject: () => void;
	readonly responding: boolean;
	readonly summary: string;
	readonly title: string;
}

export function AppearanceApprovalDrawerView({
	canConfirm,
	children,
	countdown,
	error,
	labels,
	onConfirm,
	onReject,
	responding,
	summary,
	title,
}: AppearanceApprovalDrawerViewProps): JSX.Element {
	return (
		<Drawer open direction="right" dismissible={false}>
			<DrawerContent className="w-[min(520px,calc(100vw-2rem))] overflow-visible sm:max-w-[520px]">
				<ThemeSurface slot="root.approval.appearance.panel" />
				<DrawerHeader className="relative z-10 border-b border-border/60">
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{summary}</DrawerDescription>
				</DrawerHeader>
				<div className="relative z-10 min-h-0 flex-1 overflow-y-auto p-4">
					{children}
					<div className="mt-4 text-[11px] text-muted-foreground">{labels.permission}</div>
					{error && <div className="mt-2 text-[11px] text-destructive">{error}</div>}
				</div>
				<DrawerFooter className="relative z-10 border-t border-border/60">
					<Button variant="outline" size="sm" disabled={responding} onClick={onReject}>
						{labels.reject}（{countdown}）
					</Button>
					<Button size="sm" disabled={responding || !canConfirm} onClick={onConfirm}>
						{responding ? labels.responding : labels.confirm}
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}
