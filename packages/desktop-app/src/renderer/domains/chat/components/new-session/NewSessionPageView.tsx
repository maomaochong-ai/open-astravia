import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@vetta/theme-sdk";
import { NewSessionPageLayoutView } from "@vetta/theme-ui/chat";
import { NewSessionBackground } from "./NewSessionBackground";
import { NewSessionHero } from "./NewSessionHero";
import { InputBar } from "../InputBar";
import { SessionDropZone } from "../SessionDropZone";

interface NewSessionPageViewProps {
	avatarAutoplay: boolean;
	className?: string;
	cwd: string;
	greetingTitle: string;
	isShort: boolean;
	mounted: boolean;
	onAbort: () => Promise<void>;
	onSend: () => Promise<void>;
	subtitle: string;
}

export function NewSessionPageView({
	avatarAutoplay,
	className,
	cwd,
	greetingTitle,
	isShort,
	mounted,
	onAbort,
	onSend,
	subtitle,
}: NewSessionPageViewProps): JSX.Element {
	const ThemedNewSessionBackground = useThemeComponent(
		"chat.newSessionBackground",
		EmptyNewSessionBackground,
	);

	return (
		<NewSessionPageLayoutView
			isShort={isShort}
			background={<NewSessionBackground />}
			themedBackground={<ThemedNewSessionBackground />}
			dropZone={(children) => (
				<SessionDropZone
					cwdOverride={cwd}
					className={cn(
						"relative flex h-full flex-1 flex-col overflow-hidden bg-background",
						className,
					)}
				>
					{children}
				</SessionDropZone>
			)}
			hero={
				<NewSessionHero
					avatarAutoplay={avatarAutoplay}
					greetingTitle={greetingTitle}
					mounted={mounted}
					subtitle={subtitle}
				/>
			}
			inputBar={<InputBar onSend={onSend} onAbort={onAbort} cwdOverride={cwd} />}
		/>
	);
}

function EmptyNewSessionBackground(): null {
	return null;
}
