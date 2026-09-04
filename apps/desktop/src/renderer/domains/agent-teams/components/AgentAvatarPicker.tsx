import { useTranslation } from "react-i18next";
import { AGENT_AVATAR_OPTIONS } from "@shared/agent-teams/agent-avatar";

interface AgentAvatarPickerProps {
	readonly value: string;
	readonly onChange: (avatar: string) => void;
}

/** Controlled visual picker for the built-in Agent avatar catalog. */
export function AgentAvatarPicker({
	value,
	onChange,
}: AgentAvatarPickerProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return (
		<fieldset>
			<legend className="mb-2 text-sm text-muted-foreground">{t("profile.avatar")}</legend>
			<div className="flex flex-wrap gap-2" role="group" aria-label={t("profile.avatar")}>
				{AGENT_AVATAR_OPTIONS.map((avatar, index) => (
					<button
						key={avatar}
						type="button"
						aria-label={t("profile.avatarOption", { index: index + 1 })}
						aria-pressed={value === avatar}
						onClick={() => onChange(avatar)}
						className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-border/60 bg-card/30 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-primary/40 aria-pressed:border-primary/60 aria-pressed:bg-primary/10 aria-pressed:hover:border-primary/60 aria-pressed:hover:bg-primary/10"
					>
						<img src={avatar} alt="" className="h-10 w-10 object-contain" />
					</button>
				))}
			</div>
		</fieldset>
	);
}
