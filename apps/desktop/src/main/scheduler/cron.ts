import { AsyncTask, CronJob } from "toad-scheduler";

export function isValidCronExpression(cronExpression: string): boolean {
	try {
		const validationTask = new AsyncTask(
			"cron-validation",
			async () => {},
			() => {},
		);
		const validationJob = new CronJob({ cronExpression }, validationTask);
		validationJob.start();
		validationJob.stop();
		return true;
	} catch {
		return false;
	}
}
