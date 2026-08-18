/**
 * Serial queue for settings AI-assist "create session + send" jobs.
 *
 * openSession switches the active renderer subscription; concurrent calls race.
 * Jobs still run one-after-another so each prompt lands on its own new session,
 * while the assist popover UI stays free to fire more jobs.
 */

type AssistJob = () => Promise<void>;

let chain: Promise<void> = Promise.resolve();

export function enqueueSettingsAssistJob(job: AssistJob): void {
	chain = chain.then(job, job).catch((error: unknown) => {
		console.warn("[SettingsAiAssist] background job failed", error);
	});
}
