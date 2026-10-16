import Foundation

/// The server's settings file, ~/.mcmaster2dymo.json (or $MCM2DYMO_CONFIG).
/// Mirrors server/config.js: missing keys fall back to the same defaults, and
/// keys this app doesn't know about are preserved on save.
struct ServerConfig {
  static let defaults: [String: Any] = [
    "port": 41952, "bind": "0.0.0.0", "token": "", "printer": "",
    "size": "30336", "layout": "classic", "showImage": true, "copies": 1,
    "printWithoutDetails": true, "chromePath": "", "chromeIdleMs": 300_000
  ]

  static var path: URL {
    if let p = ProcessInfo.processInfo.environment["MCM2DYMO_CONFIG"], !p.isEmpty {
      return URL(fileURLWithPath: p)
    }
    return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".mcmaster2dymo.json")
  }

  var values: [String: Any]

  static func load() -> ServerConfig {
    var v = defaults
    if let data = try? Data(contentsOf: path),
       let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      v.merge(saved) { _, new in new }
    }
    return ServerConfig(values: v)
  }

  func save() throws {
    let data = try JSONSerialization.data(withJSONObject: values, options: [.prettyPrinted, .sortedKeys])
    try (String(decoding: data, as: UTF8.self) + "\n").write(to: Self.path, atomically: true, encoding: .utf8)
  }

  func string(_ k: String) -> String { values[k] as? String ?? (Self.defaults[k] as? String ?? "") }
  func int(_ k: String) -> Int {
    if let n = values[k] as? Int { return n }
    if let n = values[k] as? Double { return Int(n) }
    return Self.defaults[k] as? Int ?? 0
  }
  func bool(_ k: String) -> Bool { values[k] as? Bool ?? (Self.defaults[k] as? Bool ?? false) }
}

/// Label sizes and layouts, read from extension/label.js via server/catalog.js
/// so the pickers can't drift from what the server renders.
struct Catalog {
  struct Entry: Identifiable, Hashable { let id: String; let name: String }
  var sizes: [Entry]
  var layouts: [Entry]

  static let fallback = Catalog(
    sizes: [Entry(id: "30336", name: "30336 Small Multipurpose"), Entry(id: "30252", name: "30252 Address"), Entry(id: "30256", name: "30256 Shipping")],
    layouts: ["classic", "banner", "inverted", "picture", "qrleft", "textonly"].map { Entry(id: $0, name: $0) })

  static func load(node: String, repo: URL) -> Catalog {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = [repo.appendingPathComponent("server/catalog.js").path]
    p.currentDirectoryURL = repo
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else { return fallback }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    guard let j = try? JSONSerialization.jsonObject(with: data) as? [String: [[String: String]]],
          let s = j["sizes"], let l = j["layouts"], !s.isEmpty, !l.isEmpty else { return fallback }
    let conv = { (a: [[String: String]]) in a.compactMap { d in d["id"].map { Entry(id: $0, name: d["name"] ?? $0) } } }
    return Catalog(sizes: conv(s), layouts: conv(l))
  }
}
