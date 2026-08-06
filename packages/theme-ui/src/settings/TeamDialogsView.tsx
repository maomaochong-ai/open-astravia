import { useState, type JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	cn,
} from "@vetta/ui";

const inputClassName =
	"h-8 w-full min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 py-1 text-base shadow-none transition-[border-color,background-color] outline-none placeholder:text-muted-foreground hover:border-border focus-visible:border-ring/60 md:text-sm dark:bg-input/20";

export interface TeamDialogLabelsView {
	readonly createTitle: string;
	readonly createPlaceholder: string;
	readonly createFailed: string;
	readonly creating: string;
	readonly createButton: string;
	readonly joinTitle: string;
	readonly joinPlaceholder: string;
	readonly joinFailed: string;
	readonly joining: string;
	readonly joinButton: string;
	readonly cancel: string;
}

export interface CreateTeamDialogViewProps {
	readonly open: boolean;
	readonly labels: TeamDialogLabelsView;
	readonly onOpenChange: (open: boolean) => void;
	readonly onCreate: (name: string) => Promise<void>;
}

export function CreateTeamDialogView({
	open,
	labels,
	onOpenChange,
	onCreate,
}: CreateTeamDialogViewProps): JSX.Element {
	const [name, setName] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	const handleCreate = async () => {
		if (!name.trim()) return;
		setLoading(true);
		setError("");
		try {
			await onCreate(name.trim());
			setName("");
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : labels.createFailed);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{labels.createTitle}</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<input
						placeholder={labels.createPlaceholder}
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
						// biome-ignore lint/a11y/noAutofocus: preserve original dialog focus
						autoFocus
						className={cn(inputClassName)}
					/>
					{error && <p className="text-[12px] text-destructive">{error}</p>}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{labels.cancel}
					</Button>
					<Button onClick={() => void handleCreate()} disabled={loading || !name.trim()}>
						{loading ? labels.creating : labels.createButton}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export interface JoinTeamDialogViewProps {
	readonly open: boolean;
	readonly labels: TeamDialogLabelsView;
	readonly onOpenChange: (open: boolean) => void;
	readonly onJoin: (code: string) => Promise<void>;
}

export function JoinTeamDialogView({
	open,
	labels,
	onOpenChange,
	onJoin,
}: JoinTeamDialogViewProps): JSX.Element {
	const [code, setCode] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	const handleJoin = async () => {
		if (!code.trim()) return;
		setLoading(true);
		setError("");
		try {
			await onJoin(code.trim());
			setCode("");
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : labels.joinFailed);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{labels.joinTitle}</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<input
						placeholder={labels.joinPlaceholder}
						value={code}
						onChange={(e) => setCode(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void handleJoin()}
						// biome-ignore lint/a11y/noAutofocus: preserve original dialog focus
						autoFocus
						className={cn(inputClassName)}
					/>
					{error && <p className="text-[12px] text-destructive">{error}</p>}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{labels.cancel}
					</Button>
					<Button onClick={() => void handleJoin()} disabled={loading || !code.trim()}>
						{loading ? labels.joining : labels.joinButton}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
