import Foundation

/// Untyped JSON as it crosses the wire. Payloads are decoded tolerantly by the
/// `read*` functions in `RemoteAPI.swift`, mirroring the TypeScript readers.
public enum JSONValue: Equatable, Sendable {
	case null
	case bool(Bool)
	case number(Double)
	case string(String)
	case array([JSONValue])
	case object([String: JSONValue])

	public subscript(key: String) -> JSONValue? {
		if case let .object(fields) = self { return fields[key] }
		return nil
	}

	public var stringValue: String? {
		if case let .string(value) = self { return value }
		return nil
	}

	/// Finite numbers only, like the TypeScript `num()` helper.
	public var numberValue: Double? {
		if case let .number(value) = self, value.isFinite { return value }
		return nil
	}

	public var boolValue: Bool? {
		if case let .bool(value) = self { return value }
		return nil
	}

	public var arrayValue: [JSONValue]? {
		if case let .array(value) = self { return value }
		return nil
	}

	public var objectValue: [String: JSONValue]? {
		if case let .object(value) = self { return value }
		return nil
	}

	public var isObject: Bool { objectValue != nil }
}

public struct JSONParseError: Error {}

extension JSONValue {
	public static func parse(_ text: String) throws -> JSONValue {
		try parse(Data(text.utf8))
	}

	public static func parse(_ data: Data) throws -> JSONValue {
		let raw: Any
		do {
			raw = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
		} catch {
			throw JSONParseError()
		}
		return try from(raw)
	}

	private static func from(_ raw: Any) throws -> JSONValue {
		switch raw {
		case is NSNull:
			return .null
		case let number as NSNumber:
			if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
			return .number(number.doubleValue)
		case let text as String:
			return .string(text)
		case let list as [Any]:
			return .array(try list.map(from))
		case let fields as [String: Any]:
			var object: [String: JSONValue] = [:]
			for (key, value) in fields { object[key] = try from(value) }
			return .object(object)
		default:
			throw JSONParseError()
		}
	}

	/// Compact serialization equivalent to `JSON.stringify` for the values the protocol carries.
	public func serialized() -> String {
		var output = ""
		write(into: &output)
		return output
	}

	private func write(into output: inout String) {
		switch self {
		case .null:
			output += "null"
		case let .bool(value):
			output += value ? "true" : "false"
		case let .number(value):
			output += JSONValue.formatNumber(value)
		case let .string(value):
			JSONValue.writeString(value, into: &output)
		case let .array(values):
			output += "["
			for (index, value) in values.enumerated() {
				if index > 0 { output += "," }
				value.write(into: &output)
			}
			output += "]"
		case let .object(fields):
			output += "{"
			for (index, key) in fields.keys.sorted().enumerated() {
				if index > 0 { output += "," }
				JSONValue.writeString(key, into: &output)
				output += ":"
				fields[key]!.write(into: &output)
			}
			output += "}"
		}
	}

	static func formatNumber(_ value: Double) -> String {
		guard value.isFinite else { return "null" }
		if value == value.rounded(), abs(value) < 9_007_199_254_740_992 { return String(Int64(value)) }
		return "\(value)"
	}

	private static func writeString(_ value: String, into output: inout String) {
		output += "\""
		for scalar in value.unicodeScalars {
			switch scalar {
			case "\"": output += "\\\""
			case "\\": output += "\\\\"
			case "\n": output += "\\n"
			case "\r": output += "\\r"
			case "\t": output += "\\t"
			case "\u{08}": output += "\\b"
			case "\u{0C}": output += "\\f"
			default:
				if scalar.value < 0x20 {
					output += String(format: "\\u%04x", scalar.value)
				} else {
					output.unicodeScalars.append(scalar)
				}
			}
		}
		output += "\""
	}
}

extension JSONValue: Codable {
	public init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if container.decodeNil() {
			self = .null
		} else if let value = try? container.decode(Bool.self) {
			self = .bool(value)
		} else if let value = try? container.decode(Double.self) {
			self = .number(value)
		} else if let value = try? container.decode(String.self) {
			self = .string(value)
		} else if let value = try? container.decode([JSONValue].self) {
			self = .array(value)
		} else {
			self = .object(try container.decode([String: JSONValue].self))
		}
	}

	public func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		switch self {
		case .null: try container.encodeNil()
		case let .bool(value): try container.encode(value)
		case let .number(value): try container.encode(value)
		case let .string(value): try container.encode(value)
		case let .array(value): try container.encode(value)
		case let .object(value): try container.encode(value)
		}
	}
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral,
	ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByFloatLiteral, ExpressibleByNilLiteral
{
	public init(stringLiteral value: String) { self = .string(value) }
	public init(integerLiteral value: Int) { self = .number(Double(value)) }
	public init(floatLiteral value: Double) { self = .number(value) }
	public init(booleanLiteral value: Bool) { self = .bool(value) }
	public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
	public init(dictionaryLiteral elements: (String, JSONValue)...) {
		self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
	}
	public init(nilLiteral: ()) { self = .null }
}
