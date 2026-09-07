import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AGENT_AVATAR_OPTIONS } from "../../../shared/agent-teams/agent-avatar";

interface AgentAvatarPickerProps {
	readonly value: string;
	readonly onChange: (avatar: string) => void;
}

/** Controlled visual picker for the built-in Agent avatar catalog, plus a user upload slot. */
export function AgentAvatarPicker({ value, onChange }: AgentAvatarPickerProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string>();
	// 上传来的头像不在内置目录里，得单独占一格，否则选完就从列表里消失了。
	const isCustom = value.length > 0 && !AGENT_AVATAR_OPTIONS.includes(value);

	async function upload(): Promise<void> {
		setUploading(true);
		setError(undefined);
		try {
			const uploaded = await window.vetta.agentTeams.uploadAvatar();
			if (uploaded) onChange(uploaded);
		} catch (cause) {
			setError(t("profile.avatarUploadFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
		} finally {
			setUploading(false);
		}
	}

	return (
		<fieldset>
			<legend className="mb-2.5 text-xs font-semibold tracking-wider uppercase text-muted-foreground/80">
				{t("profile.avatar")}
			</legend>
			<div
				className="grid grid-cols-5 sm:grid-cols-10 gap-2.5 rounded-xl border border-border/40 bg-card/20 p-2.5"
				role="group"
				aria-label={t("profile.avatar")}
			>
				{AGENT_AVATAR_OPTIONS.map((avatar, index) => (
					<AvatarOption
						key={avatar}
						avatar={avatar}
						label={t("profile.avatarOption", { index: index + 1 })}
						selected={value === avatar}
						onSelect={() => onChange(avatar)}
					/>
				))}

				{isCustom && (
					<AvatarOption
						avatar={value}
						label={t("profile.avatarUpload")}
						selected
						onSelect={() => onChange(value)}
					/>
				)}

				<button
					type="button"
					aria-label={t("profile.avatarUpload")}
					title={t("profile.avatarUploadHint")}
					disabled={uploading}
					onClick={() => void upload()}
					className="flex aspect-square items-center justify-center rounded-full border border-dashed border-border/60 text-muted-foreground outline-none transition-colors hover:border-primary/60 hover:text-foreground disabled:opacity-50"
				>
					<span
						className={
							uploading
								? "icon-[solar--refresh-linear] h-4 w-4 animate-spin"
								: "icon-[solar--gallery-add-linear] h-4 w-4"
						}
						aria-hidden="true"
					/>
				</button>
			</div>
			{error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
		</fieldset>
	);
}

interface AvatarOptionProps {
	readonly avatar: string;
	readonly label: string;
	readonly selected: boolean;
	readonly onSelect: () => void;
}

function AvatarOption({ avatar, label, selected, onSelect }: AvatarOptionProps): JSX.Element {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={selected}
			onClick={onSelect}
			className={[
				"group relative flex aspect-square items-center justify-center rounded-full outline-none ring-2 transition-all duration-200",
				selected ? "ring-primary" : "ring-border/40 hover:ring-border",
			].join(" ")}
		>
			<img
				src={avatar}
				alt=""
				className="h-full w-full rounded-full object-cover transition-transform duration-200 group-hover:scale-105"
			/>
			{selected && (
				<div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
					<span className="icon-[solar--check-read-linear] h-2.5 w-2.5" aria-hidden="true" />
				</div>
			)}
		</button>
	);
}
