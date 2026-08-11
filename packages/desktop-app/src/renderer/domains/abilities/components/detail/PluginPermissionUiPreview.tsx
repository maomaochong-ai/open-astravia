import { cn } from "@vetta/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PluginUiPreview } from "../../lib/plugin-permission-labels";

function MiniWindow({ children }: { children: ReactNode }): JSX.Element {
	return (
		<div
			className="relative aspect-[16/10] overflow-hidden rounded-xl border border-border/60 bg-background"
			aria-hidden
		>
			<div className="flex h-5 items-center gap-1.5 border-b border-border/50 bg-muted/45 px-2">
				<span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
				<span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20" />
				<span className="ml-1 h-1.5 w-14 rounded-full bg-muted-foreground/15" />
			</div>
			<div className="absolute inset-x-0 bottom-0 top-5">{children}</div>
		</div>
	);
}

function MiniLines({ widths = ["w-16", "w-12", "w-14"] }: { widths?: string[] }): JSX.Element {
	return (
		<div className="space-y-1.5">
			{widths.map((width, index) => (
				<div key={`${width}-${index}`} className={cn("h-1.5 rounded-full bg-muted-foreground/15", width)} />
			))}
		</div>
	);
}

function MiniFileRows({ decorated = false }: { decorated?: boolean }): JSX.Element {
	return (
		<div className="space-y-1.5">
			{[0, 1, 2, 3].map((index) => (
				<div key={index} className="flex h-3 items-center gap-1.5 rounded px-1">
					<span className="icon-[solar--file-linear] h-2.5 w-2.5 text-muted-foreground/35" />
					<span className={cn("h-1.5 rounded-full bg-muted-foreground/15", index % 2 === 0 ? "w-12" : "w-9")} />
					{decorated ? (
						<span
							className={cn(
								"ml-auto h-1.5 w-1.5 rounded-full",
								index === 1 ? "bg-amber-500/70" : "bg-primary/70",
							)}
						/>
					) : null}
				</div>
			))}
		</div>
	);
}

function GlobalScene(): JSX.Element {
	return (
		<div className="flex h-full">
			<div className="w-[27%] border-r border-border/50 bg-muted/25 p-2">
				<MiniLines widths={["w-12", "w-16", "w-10"]} />
			</div>
			<div className="relative flex-1 p-3">
				<MiniLines widths={["w-20", "w-28", "w-16"]} />
				<div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg border border-primary/60 bg-primary/15 px-2 py-1.5 ring-1 ring-inset ring-primary/20">
					<span className="icon-[solar--plug-circle-linear] h-3.5 w-3.5 text-primary" />
					<span className="h-1.5 flex-1 rounded-full bg-primary/30" />
					<span className="h-4 w-4 rounded bg-primary/20" />
				</div>
			</div>
		</div>
	);
}

function FilePreviewScene(): JSX.Element {
	return (
		<div className="flex h-full">
			<div className="w-[30%] border-r border-border/50 bg-muted/25 p-2">
				<MiniFileRows />
			</div>
			<div className="flex flex-1 flex-col p-2">
				<div className="mb-2 flex items-center gap-1.5 border-b border-border/40 pb-1.5">
					<span className="icon-[solar--file-linear] h-3 w-3 text-primary" />
					<span className="h-1.5 w-16 rounded-full bg-muted-foreground/20" />
				</div>
				<div className="flex flex-1 items-center justify-center rounded-lg border border-primary/50 bg-primary/10 ring-1 ring-inset ring-primary/15">
					<div className="w-[72%] space-y-2">
						<div className="h-2 w-1/2 rounded-full bg-primary/25" />
						<MiniLines widths={["w-full", "w-[84%]", "w-[92%]", "w-[65%]"]} />
					</div>
				</div>
			</div>
		</div>
	);
}

function ActivityTabScene(): JSX.Element {
	return (
		<div className="flex h-full">
			<div className="flex flex-1 flex-col gap-2 p-3">
				<div className="ml-auto h-4 w-[55%] rounded-lg bg-muted/60" />
				<div className="h-6 w-[72%] rounded-lg border border-border/40 bg-card/40" />
				<div className="h-5 w-[64%] self-end rounded-lg bg-muted/45" />
			</div>
			<div className="w-[35%] border-l border-primary/40 bg-primary/5">
				<div className="flex h-6 items-end gap-1 border-b border-border/50 px-1.5">
					<span className="h-4 flex-1 rounded-t bg-muted/55" />
					<span className="flex h-5 flex-1 items-center justify-center rounded-t border border-b-0 border-primary/50 bg-primary/15">
						<span className="icon-[solar--plug-circle-linear] h-2.5 w-2.5 text-primary" />
					</span>
				</div>
				<div className="p-2">
					<div className="mb-2 h-8 rounded-lg border border-primary/40 bg-primary/10" />
					<MiniLines widths={["w-full", "w-[78%]", "w-[90%]"]} />
				</div>
			</div>
		</div>
	);
}

function InputActionScene(): JSX.Element {
	return (
		<div className="relative h-full p-3">
			<div className="ml-auto h-4 w-[55%] rounded-lg bg-muted/55" />
			<div className="mt-2 h-6 w-[68%] rounded-lg border border-border/40 bg-card/40" />
			<div className="absolute inset-x-3 bottom-3 flex h-8 items-center rounded-lg border border-border/60 bg-muted/25 px-2">
				<span className="h-1.5 flex-1 rounded-full bg-muted-foreground/15" />
				<span className="ml-2 flex h-5 w-5 items-center justify-center rounded-lg border border-primary/60 bg-primary/15 ring-1 ring-inset ring-primary/20">
					<span className="icon-[solar--plug-circle-linear] h-3 w-3 text-primary" />
				</span>
				<span className="ml-1.5 h-5 w-5 rounded-lg bg-muted/70" />
			</div>
		</div>
	);
}

function MessageScene(): JSX.Element {
	return (
		<div className="space-y-2.5 p-3">
			<div className="ml-auto h-4 w-[48%] rounded-lg bg-muted/60" />
			<div className="w-[76%] rounded-lg border border-border/40 bg-card/35 p-2">
				<MiniLines widths={["w-full", "w-[82%]"]} />
			</div>
			<div className="flex w-[76%] items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-2 py-1.5 ring-1 ring-inset ring-primary/15">
				<span className="icon-[solar--plug-circle-linear] h-3 w-3 text-primary" />
				<span className="h-1.5 flex-1 rounded-full bg-primary/25" />
				<span className="h-3.5 w-3.5 rounded bg-primary/20" />
			</div>
		</div>
	);
}

function ToolCallScene(): JSX.Element {
	return (
		<div className="p-3">
			<div className="mb-2 h-4 w-[58%] rounded-lg bg-muted/55" />
			<div className="rounded-lg border border-primary/55 bg-primary/5 p-2 ring-1 ring-inset ring-primary/15">
				<div className="flex items-center gap-2 border-b border-border/40 pb-2">
					<span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-primary">
						<span className="icon-[solar--command-linear] h-3.5 w-3.5" />
					</span>
					<div className="flex-1">
						<MiniLines widths={["w-20", "w-12"]} />
					</div>
					<span className="h-2 w-2 rounded-full bg-primary/70" />
				</div>
				<div className="mt-2 rounded bg-background/60 p-2">
					<MiniLines widths={["w-full", "w-[74%]"]} />
				</div>
			</div>
		</div>
	);
}

function TurnCardScene(): JSX.Element {
	return (
		<div className="p-3">
			<div className="rounded-lg border border-primary/55 bg-primary/5 ring-1 ring-inset ring-primary/15">
				<div className="flex items-center gap-2 border-b border-border/45 px-2 py-1.5">
					<span className="h-4 w-4 rounded-lg bg-primary/20" />
					<span className="h-1.5 w-20 rounded-full bg-muted-foreground/20" />
					<span className="ml-auto h-1.5 w-8 rounded-full bg-primary/35" />
				</div>
				<div className="space-y-2 p-2.5">
					<div className="ml-auto h-3.5 w-[45%] rounded-lg bg-muted/60" />
					<div className="h-5 w-[78%] rounded-lg bg-card/50" />
					<div className="flex items-center gap-1.5 border-t border-border/40 pt-2">
						<span className="icon-[solar--plug-circle-linear] h-3 w-3 text-primary" />
						<span className="h-1.5 w-16 rounded-full bg-primary/25" />
					</div>
				</div>
			</div>
		</div>
	);
}

/** 侧边栏多出一个入口 + 内容区整页由插件接管。 */
function WorkspaceViewScene(): JSX.Element {
	return (
		<div className="flex h-full gap-2 p-3">
			<div className="flex w-[30%] flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2">
				<span className="h-2.5 w-full rounded bg-muted-foreground/15" />
				<span className="h-2.5 w-full rounded bg-muted-foreground/15" />
				<span className="flex h-2.5 w-full items-center gap-1 rounded bg-primary/20 px-1">
					<span className="icon-[solar--plug-circle-linear] h-2 w-2 text-primary" />
				</span>
				<span className="h-2.5 w-[70%] rounded bg-muted-foreground/15" />
			</div>
			<div className="flex-1 rounded-lg border border-primary/55 bg-primary/5 p-2 ring-1 ring-inset ring-primary/15">
				<span className="block h-2 w-[45%] rounded-full bg-primary/35" />
				<div className="mt-2 grid grid-cols-3 gap-1.5">
					<span className="h-10 rounded bg-card/60" />
					<span className="h-10 rounded bg-card/60" />
					<span className="h-10 rounded bg-card/60" />
				</div>
			</div>
		</div>
	);
}

function ShortcutScene(): JSX.Element {
	return (
		<div className="flex h-full items-center gap-4 px-5">
			<div className="grid flex-1 grid-cols-5 gap-1 rounded-lg border border-border/60 bg-muted/20 p-2">
				{Array.from({ length: 15 }, (_, index) => (
					<span
						key={index}
						className={cn(
							"h-3 rounded border border-border/50 bg-muted/60",
							index === 7 && "border-primary/60 bg-primary/25 ring-1 ring-inset ring-primary/20",
						)}
					/>
				))}
				<span className="col-span-5 h-3 rounded border border-border/50 bg-muted/60" />
			</div>
			<span className="icon-[solar--arrow-right-linear] h-4 w-4 text-muted-foreground/50" />
			<span className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/60 bg-primary/15 text-primary ring-1 ring-inset ring-primary/20">
				<span className="icon-[solar--plug-circle-linear] h-5 w-5" />
			</span>
		</div>
	);
}

function FileDecorationsScene(): JSX.Element {
	return (
		<div className="flex h-full">
			<div className="w-[58%] border-r border-primary/35 bg-primary/5 p-3">
				<div className="mb-2 h-2 w-14 rounded-full bg-muted-foreground/20" />
				<MiniFileRows decorated />
			</div>
			<div className="flex flex-1 items-center justify-center">
				<div className="space-y-2">
					<span className="block h-2 w-2 rounded-full bg-primary/70" />
					<span className="block h-2 w-2 rounded-full bg-amber-500/70" />
					<span className="block h-2 w-2 rounded-full bg-primary/40" />
				</div>
			</div>
		</div>
	);
}

function FileContextMenuScene(): JSX.Element {
	return (
		<div className="relative h-full p-3">
			<div className="w-[55%]">
				<MiniFileRows />
			</div>
			<div className="absolute left-[38%] top-[27%] w-[48%] rounded-lg border border-border/70 bg-popover p-1.5 shadow-md">
				<div className="h-4 rounded px-1 py-1">
					<span className="block h-1.5 w-[58%] rounded-full bg-muted-foreground/15" />
				</div>
				<div className="flex h-5 items-center gap-1.5 rounded border border-primary/50 bg-primary/15 px-1.5 ring-1 ring-inset ring-primary/15">
					<span className="icon-[solar--plug-circle-linear] h-2.5 w-2.5 text-primary" />
					<span className="h-1.5 flex-1 rounded-full bg-primary/25" />
				</div>
				<div className="h-4 rounded px-1 py-1">
					<span className="block h-1.5 w-[72%] rounded-full bg-muted-foreground/15" />
				</div>
			</div>
		</div>
	);
}

function FileToolbarScene(): JSX.Element {
	return (
		<div className="flex h-full">
			<div className="w-[62%] border-r border-primary/35 bg-primary/5">
				<div className="flex h-7 items-center gap-1 border-b border-border/50 px-2">
					<span className="h-4 w-4 rounded bg-muted/70" />
					<span className="h-4 w-4 rounded bg-muted/70" />
					<span className="ml-auto flex h-5 w-5 items-center justify-center rounded-lg border border-primary/60 bg-primary/15 ring-1 ring-inset ring-primary/20">
						<span className="icon-[solar--plug-circle-linear] h-3 w-3 text-primary" />
					</span>
				</div>
				<div className="p-2">
					<MiniFileRows />
				</div>
			</div>
			<div className="flex flex-1 items-center justify-center">
				<span className="icon-[solar--cursor-square-linear] h-5 w-5 text-primary/70" />
			</div>
		</div>
	);
}

function UiPreviewScene({ preview }: { preview: PluginUiPreview }): JSX.Element {
	if (preview === "global") return <GlobalScene />;
	if (preview === "filePreview") return <FilePreviewScene />;
	if (preview === "activityTab") return <ActivityTabScene />;
	if (preview === "inputAction") return <InputActionScene />;
	if (preview === "message") return <MessageScene />;
	if (preview === "toolCall") return <ToolCallScene />;
	if (preview === "turnCard") return <TurnCardScene />;
	if (preview === "workspaceView") return <WorkspaceViewScene />;
	if (preview === "shortcuts") return <ShortcutScene />;
	if (preview === "fileDecorations") return <FileDecorationsScene />;
	if (preview === "fileContextMenu") return <FileContextMenuScene />;
	return <FileToolbarScene />;
}

export function PluginPermissionUiPreview({ preview }: { preview: PluginUiPreview }): JSX.Element {
	const { t } = useTranslation("abilities");
	return (
		<figure>
			<MiniWindow>
				<UiPreviewScene preview={preview} />
			</MiniWindow>
			<figcaption className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
				<span className="h-1.5 w-1.5 rounded-full bg-primary" />
				{t(`permission.page.preview.${preview}`)}
			</figcaption>
		</figure>
	);
}
