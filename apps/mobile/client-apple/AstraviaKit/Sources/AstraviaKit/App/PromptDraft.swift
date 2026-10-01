import Foundation

/// One picture or file the user attached to a prompt, held in memory until it is sent.
public struct PromptAttachment: Equatable, Identifiable, Sendable {
	public enum Kind: String, Codable, Sendable {
		case image, file
	}

	public var id: String
	public var kind: Kind
	public var name: String
	public var mimeType: String
	public var data: Data

	public init(id: String = UUID().uuidString, kind: Kind, name: String, mimeType: String, data: Data) {
		self.id = id
		self.kind = kind
		self.name = name
		self.mimeType = mimeType
		self.data = data
	}

	var json: JSONValue {
		[
			"kind": .string(kind.rawValue),
			"name": .string(name),
			"mimeType": .string(mimeType),
			"data": .string(data.base64EncodedString()),
		]
	}
}

public enum PromptAttachmentError: Error, Equatable {
	case tooLarge(name: String)
	case tooMany
}

/// What the composer holds before sending: text, attachments and referenced
/// skills, within the limits the link can carry in one encrypted frame.
public struct PromptDraft: Equatable, Sendable {
	/// Per attachment, before base64: what one `session.upload` frame carries.
	/// Pictures are downscaled to fit; other files are refused.
	public static let maxAttachmentBytes = RemoteAPI.maxUploadBytes
	public static let maxAttachments = 6

	public var text = ""
	public private(set) var attachments: [PromptAttachment] = []
	/// In the order they were picked; at most one scene, as on the desktop.
	public private(set) var skills: [SkillReference] = []

	public init(text: String = "", attachments: [PromptAttachment] = [], skills: [SkillReference] = []) {
		self.text = text
		self.attachments = attachments
		for skill in skills { add(skill) }
	}

	public var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

	/// What goes to the desktop: the skill tokens, then the words.
	public var promptText: String { SkillTokens.prompt(skills, trimmedText) }

	/// A prompt needs words or a skill, which is often a whole instruction by
	/// itself; attachments ride along with them.
	public var canSend: Bool { !trimmedText.isEmpty || !skills.isEmpty }

	public var isEmpty: Bool { trimmedText.isEmpty && attachments.isEmpty && skills.isEmpty }

	public mutating func add(_ attachment: PromptAttachment) throws {
		guard attachments.count < Self.maxAttachments else { throw PromptAttachmentError.tooMany }
		guard !attachment.data.isEmpty, attachment.data.count <= Self.maxAttachmentBytes else {
			throw PromptAttachmentError.tooLarge(name: attachment.name)
		}
		attachments.append(attachment)
	}

	public mutating func remove(_ id: String) {
		attachments.removeAll { $0.id == id }
	}

	/// Adds a skill once. A prompt may name one scene, so a new scene replaces the old one.
	public mutating func add(_ skill: SkillReference) {
		guard !skills.contains(skill) else { return }
		if skill.kind == .scene { skills.removeAll { $0.kind == .scene } }
		skills.append(skill)
	}

	public mutating func removeSkill(_ id: String) {
		skills.removeAll { $0.id == id }
	}

	public mutating func clear() {
		text = ""
		attachments = []
		skills = []
	}
}
