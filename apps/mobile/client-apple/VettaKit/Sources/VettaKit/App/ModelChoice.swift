import Foundation

/// The model and thinking level picked in the model sheet, which New Session
/// and the chat title share. `nil` model is the desktop's default; `nil` level
/// leaves the model's own.
public struct ModelChoice: Equatable, Codable, Sendable {
	public var modelKey: String?
	public var thinkingLevel: String?

	public init(modelKey: String? = nil, thinkingLevel: String? = nil) {
		self.modelKey = modelKey
		self.thinkingLevel = thinkingLevel
	}

	/// Levels the chosen model offers. None for the desktop's default: the phone
	/// does not know which model that is.
	public func levels(in options: [RemoteModelOption]) -> [String] {
		guard let modelKey else { return [] }
		return options.first { $0.key == modelKey }?.thinkingLevels ?? []
	}

	/// What of this choice the desktop still offers: a model it no longer lists falls
	/// back to its default, a level the model lacks to the model's own. An empty list
	/// is not known yet and keeps everything.
	public func available(in options: [RemoteModelOption]) -> ModelChoice {
		guard let modelKey, !options.isEmpty else { return self }
		guard options.contains(where: { $0.key == modelKey }) else { return ModelChoice() }
		var choice = self
		if let level = thinkingLevel, !levels(in: options).contains(level) { choice.thinkingLevel = nil }
		return choice
	}

	/// Switches model, keeping the level only where the new model offers it.
	public mutating func pick(_ modelKey: String?, in options: [RemoteModelOption]) {
		self.modelKey = modelKey
		if let level = thinkingLevel, !levels(in: options).contains(level) { thinkingLevel = nil }
	}

	/// Models by provider, providers in the order the desktop lists them.
	public static func groups(_ options: [RemoteModelOption]) -> [(provider: String, models: [RemoteModelOption])] {
		var order: [String] = []
		var byProvider: [String: [RemoteModelOption]] = [:]
		for option in options {
			if byProvider[option.provider] == nil { order.append(option.provider) }
			byProvider[option.provider, default: []].append(option)
		}
		return order.map { ($0, byProvider[$0] ?? []) }
	}
}
