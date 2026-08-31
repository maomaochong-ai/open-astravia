import type { RuntimeObservationPublisher } from "../observation/index.js";

/** Session 续接只改变后续记录的身份；scope() 捕获不可变身份，供在途 Turn 持有。 */
export function createRuntimeAgentSessionObservationPublisher(
	parent: RuntimeObservationPublisher,
	readSessionId: () => string,
): RuntimeObservationPublisher {
	const current = () => parent.scope({ sessionId: readSessionId() });
	return {
		record: (token, payload, context) => current().record(token, payload, context),
		forward: (record) => current().forward(record),
		scope: (context) => current().scope(context),
		flush: () => parent.flush(),
	};
}
