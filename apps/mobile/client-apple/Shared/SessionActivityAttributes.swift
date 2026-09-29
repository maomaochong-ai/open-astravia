import ActivityKit
import VettaKit

/// The Live Activity for the paired desktop's busy sessions, shared by the app,
/// which starts and updates it, and the widget extension, which draws it.
/// `nonisolated` because ActivityKit encodes it off the main actor.
nonisolated struct SessionActivityAttributes: ActivityAttributes {
	typealias ContentState = LiveDigest
}
