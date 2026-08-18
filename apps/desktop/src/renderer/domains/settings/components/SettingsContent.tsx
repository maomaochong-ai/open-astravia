import { cn } from "@shared/lib/utils";

export interface SettingsContentProps {
	children: React.ReactNode;
	rootClassName?: string;
}

export function SettingsContent({ children, rootClassName }: SettingsContentProps): JSX.Element {
	return (
		<div
			className={cn(
				"no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background",
				rootClassName,
			)}
		>
			{children}
		</div>
	);
}
