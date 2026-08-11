import { useState } from "react";
import { ProbePanel } from "./ProbePanel";

export function GlobalProbeSlot() {
	const [open, setOpen] = useState(true);

	if (!open) {
		return (
			<button
				type="button"
				className="fixed right-[16px] bottom-[16px] z-[120] cursor-pointer rounded-[8px] border border-transparent bg-[var(--primary)] px-[11px] py-[7px] font-[var(--font-sans)] text-[13px] font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-md)] hover:opacity-90"
				onClick={() => setOpen(true)}
			>
				Security Probe
			</button>
		);
	}

	return (
		<section
			className="fixed right-[12px] bottom-[12px] z-[120] flex h-[min(72vh,640px)] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-[12px] border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color-mix(in_srgb,var(--popover)_96%,transparent)] p-[12px] shadow-[var(--shadow-lg)]"
			aria-label="Security probe floating panel"
		>
			<div className="mb-[6px] flex shrink-0 items-center justify-end">
				<button
					type="button"
					className="h-[26px] w-[26px] cursor-pointer rounded-[8px] border border-transparent bg-[var(--accent)] text-[13px] leading-none font-semibold text-[var(--foreground)] hover:opacity-90"
					onClick={() => setOpen(false)}
					aria-label="Hide security probe"
				>
					x
				</button>
			</div>
			<div className="min-h-0 flex-1">
				<ProbePanel compact />
			</div>
		</section>
	);
}
