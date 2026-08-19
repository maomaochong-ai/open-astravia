import { memo, useEffect, useRef, useState, type JSX } from "react";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { ThemeSurface } from "../appearance/ThemeSurface";
import "./send-button.css";

export interface SendButtonLabels {
	sendMessage: string;
	stopGenerating: string;
}

export interface SendButtonProps {
	canSend: boolean;
	isStreaming: boolean;
	labels: SendButtonLabels;
	/**
	 * 发送前还有一步必须先跑完（例如新会话页要先把待创建的项目落盘）。
	 * 传入后按钮就地展开成带文案的胶囊、显示指示器并拒绝点击，跑完后传 undefined 收回。
	 */
	pending?: { readonly label: string };
	onSend: () => void;
	onAbort: () => void | Promise<void>;
}

type IconState = "send" | "to-stop" | "stop" | "to-send";

export const SendButton = memo(function SendButton({
	canSend,
	isStreaming,
	labels,
	pending: externalPending,
	onSend,
	onAbort,
}: SendButtonProps): JSX.Element {
	const surface = useThemeSurface("chat.sendButton");
	const [abortPending, setAbortPending] = useState(false);
	const abortRequestRef = useRef(0);
	const isActive = isStreaming || canSend || Boolean(externalPending);
	const wasStreamingRef = useRef(isStreaming);
	const [iconState, setIconState] = useState<IconState>(isStreaming ? "stop" : "send");
	const [showOutgoingArrow, setShowOutgoingArrow] = useState(false);

	useEffect(() => {
		if (!isStreaming) {
			abortRequestRef.current += 1;
			setAbortPending(false);
		}
		if (!wasStreamingRef.current && isStreaming) {
			setShowOutgoingArrow(true);
			setIconState("to-stop");
		} else if (wasStreamingRef.current && !isStreaming) {
			setShowOutgoingArrow(false);
			setIconState("to-send");
		}
		wasStreamingRef.current = isStreaming;
	}, [isStreaming]);

	function handleAbort(): void {
		const request = ++abortRequestRef.current;
		setAbortPending(true);
		void Promise.resolve()
			.then(onAbort)
			.catch(() => undefined)
			.finally(() => {
				if (abortRequestRef.current === request) setAbortPending(false);
			});
	}

	function handleStemAnimationEnd(): void {
		if (iconState === "to-stop") {
			setIconState("stop");
		} else if (iconState === "to-send") {
			setIconState("send");
		}
	}

	return (
		<span
			className={[
				"send-button-wrap relative inline-flex h-8 min-w-8 items-center justify-center",
				surface?.rootClassName,
			]
				.filter(Boolean)
				.join(" ")}
			data-active={isActive}
			data-streaming={isStreaming}
			data-pending={Boolean(externalPending)}
			data-aborting={abortPending}
			data-theme-surface-root="chat.sendButton"
		>
			<ThemeSurface slot="chat.sendButton" />
			{isStreaming && !externalPending ? (
				<>
					<span aria-hidden className="send-button-ripple send-button-ripple-1" />
					<span aria-hidden className="send-button-ripple send-button-ripple-2" />
				</>
			) : null}
			<button
				type="button"
				onClick={externalPending || abortPending ? undefined : isStreaming ? handleAbort : onSend}
				disabled={Boolean(externalPending) || abortPending || (!isStreaming && !canSend)}
				aria-busy={Boolean(externalPending) || abortPending}
				className="send-button relative z-10 flex h-8 min-w-8 items-center justify-center overflow-hidden rounded-full transition-shadow disabled:cursor-not-allowed"
				data-icon-state={iconState}
				title={externalPending ? externalPending.label : isStreaming ? labels.stopGenerating : labels.sendMessage}
			>
				{externalPending ? (
					<span className="send-button-pending">
						<span className="icon-[mdi--loading] h-4 w-4 shrink-0 animate-spin" aria-hidden />
						{/* 0fr → 1fr 的栅格过渡：宽度形变全部交给 CSS，不引入第二条 JS 动画。 */}
						<span className="send-button-pending-label">
							<span className="min-w-0 truncate">{externalPending.label}</span>
						</span>
					</span>
				) : null}
				{showOutgoingArrow && !externalPending ? (
					<span
						aria-hidden
						className="send-button-outgoing-arrow"
						onAnimationEnd={() => setShowOutgoingArrow(false)}
					>
						<span className="send-button-outgoing-stem" />
						<span className="send-button-outgoing-side send-button-outgoing-side-left" />
						<span className="send-button-outgoing-side send-button-outgoing-side-right" />
					</span>
				) : null}

				<span aria-hidden className="send-button-icon" data-hidden={Boolean(externalPending)}>
					<span className="send-button-stem" onAnimationEnd={handleStemAnimationEnd} />
					<span className="send-button-side send-button-side-left" />
					<span className="send-button-side send-button-side-right" />
				</span>
			</button>
		</span>
	);
});
