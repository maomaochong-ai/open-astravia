export interface PlaywrightAttachFailureDetails {
  sessionName: string;
  status: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout?: string | null;
  stderr?: string | null;
  devtoolsTargetCount?: number;
}

const inlineRunCodeLimit = 1_800;
const outputTailLimit = 1_200;

export function validatePlaywrightArguments(args: string[]): string | null {
  if (args[0] !== "run-code" || args.some((argument) => argument.startsWith("--filename"))) {
    return null;
  }
  if (args.join(" ").length <= inlineRunCodeLimit) return null;
  return "Inline run-code is too long for the Windows Bun launcher. Save the callback in a file and pass --filename=<path>.";
}

export function formatPlaywrightAttachFailure(details: PlaywrightAttachFailureDetails): string {
  const exit = details.timedOut
    ? "The attach command timed out"
    : `The attach command exited with status ${details.status ?? "unknown"}${details.signal ? ` (${details.signal})` : ""}`;
  const hints: string[] = [];
  if ((details.devtoolsTargetCount ?? 0) > 0) {
    hints.push(
      `CDP currently exposes ${details.devtoolsTargetCount} DevTools target(s). If the output stops after <ws connected>, close stale DevTools windows and retry; keep the Vetta Desktop window open.`,
    );
  }
  hints.push("Run verify:ui:status:<profile> again before retrying to confirm that the main renderer target is still ready.");

  const output = [details.stderr, details.stdout]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .slice(-outputTailLimit);
  return [
    `Unable to attach Playwright session ${details.sessionName}. ${exit}.`,
    ...hints,
    ...(output ? [`Playwright output:\n${output}`] : []),
  ].join("\n");
}
