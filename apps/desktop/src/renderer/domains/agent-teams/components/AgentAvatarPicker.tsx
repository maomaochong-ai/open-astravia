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
			<legend className="mb-2.5 text-xs font-semibold tracking-wider uppercase text-muted-foreground/80">
				{t("profile.avatar")}
			</legend>
			<div
				className="grid grid-cols-5 sm:grid-cols-9 gap-2.5 rounded-xl border border-border/40 bg-card/20 p-2.5"
				role="group"
				aria-label={t("profile.avatar")}
			>
				{AGENT_AVATAR_OPTIONS.map((avatar, index) => {
					const isSelected = value === avatar;
					return (
						<button
							key={avatar}
							type="button"
							aria-label={t("profile.avatarOption", { index: index + 1 })}
							aria-pressed={isSelected}
							onClick={() => onChange(avatar)}
							className={[
								"group relative flex aspect-square items-center justify-center rounded-xl border p-1.5 outline-none transition-all duration-200",
								isSelected
									? "border-primary bg-primary/15"
									: "border-border/40 bg-card/50 hover:border-border hover:bg-card/90",
							].join(" ")}
						>
							<img
								src={avatar}
								alt=""
								className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
							/>
							{isSelected && (
								<div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
									<span className="icon-[solar--check-read-linear] h-2.5 w-2.5" aria-hidden="true" />
								</div>
							)}
						</button>
					);
				})}
			</div>
		</fieldset>
	);
}
