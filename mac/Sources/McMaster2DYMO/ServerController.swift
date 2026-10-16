import AppKit
import Foundation
import ServiceManagement

/// Runs `node server/index.js` as a child process, polls its /status endpoint,
/// and edits the settings file (restarting the server so changes take effect).
@MainActor
final class ServerController: ObservableObject {
  enum State: Equatable {
    case stopped, starting, running, external, failed(String)
    var label: String {
      switch self {
      case .stopped: return "Server stopped"
      case .starting: return "Server starting…"
      case .running: return "Server running"
      case .external: return "Server running (started elsewhere)"
      case .failed(let why): return "Server failed: \(why)"
      }
    }
  }

  struct Status {
    var printerOK = false
    var printerText = "DYMO Connect: unknown"
    var printers: [String] = []
    var lastJob: String?
  }

  @Published var config = ServerConfig.load()
  @Published var catalog = Catalog.fallback
  @Published var state: State = .stopped
  @Published var status = Status()
  @Published var launchdAgentInstalled = false

  /// Baked into Info.plist by mac/build.sh; overridable in Settings.
  let repo: URL
  @Published var nodePath: String {
    didSet { UserDefaults.standard.set(nodePath, forKey: "nodePath") }
  }

  private var process: Process?
  private var timer: Timer?
  private let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/mcmaster2dymo.log")
  private let agentPlist = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/LaunchAgents/com.davidnichols.mcmaster2dymo.plist")

  var baseURL: URL { URL(string: "http://127.0.0.1:\(config.int("port"))")! }
  var statusPageURL: URL {
    let host = ProcessInfo.processInfo.hostName.replacingOccurrences(of: ".local", with: "")
    return URL(string: "http://\(host).local:\(config.int("port"))/")!
  }
  var isRunning: Bool { process?.isRunning ?? false }

  init() {
    let info = Bundle.main.infoDictionary ?? [:]
    let repoPath = info["MCM2DYMORepo"] as? String
      ?? URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().path
    repo = URL(fileURLWithPath: repoPath)
    nodePath = UserDefaults.standard.string(forKey: "nodePath")
      ?? (info["MCM2DYMONode"] as? String) ?? "/usr/local/bin/node"
    catalog = Catalog.load(node: nodePath, repo: repo)
    launchdAgentInstalled = FileManager.default.fileExists(atPath: agentPlist.path)
    timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
      Task { @MainActor in await self?.poll() }
    }
    start()
    Task { await poll() }
  }

  // MARK: process

  func start() {
    guard !isRunning else { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: nodePath)
    p.arguments = [repo.appendingPathComponent("server/index.js").path]
    p.currentDirectoryURL = repo
    var env = ProcessInfo.processInfo.environment
    let nodeDir = URL(fileURLWithPath: nodePath).deletingLastPathComponent().path
    env["PATH"] = "\(nodeDir):/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
    env["MCM2DYMO_WATCH_PARENT"] = "1"
    p.environment = env
    if !FileManager.default.fileExists(atPath: logURL.path) {
      FileManager.default.createFile(atPath: logURL.path, contents: nil)
    }
    if let fh = try? FileHandle(forWritingTo: logURL) {
      fh.seekToEndOfFile()
      p.standardOutput = fh
      p.standardError = fh
    }
    p.terminationHandler = { [weak self] proc in
      Task { @MainActor in
        guard let self, self.process === proc else { return }
        self.process = nil
        self.state = proc.terminationStatus == 0 || proc.terminationReason == .uncaughtSignal
          ? .stopped : .failed("exit \(proc.terminationStatus), see ~/Library/Logs/mcmaster2dymo.log")
      }
    }
    do {
      try p.run()
      process = p
      state = .starting
    } catch {
      state = .failed("\(error.localizedDescription) (node: \(nodePath))")
    }
  }

  func stop() {
    guard let p = process else { return }
    p.terminate()  // SIGTERM: server closes headless Chrome and exits
  }

  func restart() {
    if let p = process {
      process = nil
      p.terminationHandler = { [weak self] _ in Task { @MainActor in self?.start() } }
      p.terminate()
    } else {
      start()
    }
  }

  // MARK: settings

  func set(_ key: String, _ value: Any) {
    config.values[key] = value
    saveAndRestart()
  }

  func saveAndRestart() {
    do {
      try config.save()
    } catch {
      state = .failed("couldn't write \(ServerConfig.path.path): \(error.localizedDescription)")
      return
    }
    config = ServerConfig.load()
    restart()
  }

  func reloadCatalog() { catalog = Catalog.load(node: nodePath, repo: repo) }

  // MARK: status polling

  func poll() async {
    var req = URLRequest(url: baseURL.appendingPathComponent("status"))
    req.timeoutInterval = 2
    guard let (data, _) = try? await URLSession.shared.data(for: req),
          let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      if case .failed = state { return }
      state = process == nil ? .stopped : .starting
      return
    }
    state = process == nil ? .external : .running
    var s = Status()
    if let pr = j["printer"] as? [String: Any] {
      s.printerOK = pr["ok"] as? Bool ?? false
      let list = (pr["printers"] as? [[String: Any]]) ?? []
      s.printers = list.compactMap { $0["name"] as? String }
      if s.printerOK {
        let names = list.map { ($0["name"] as? String ?? "?") + (($0["connected"] as? Bool) == false ? " (offline)" : "") }
        s.printerText = names.isEmpty ? "DYMO Connect: no printers" : "DYMO: " + names.joined(separator: ", ")
      } else {
        s.printerText = "DYMO Connect: " + (pr["error"] as? String ?? "unreachable")
      }
    }
    if let job = (j["jobs"] as? [[String: Any]])?.first, let m = job["message"] as? String {
      s.lastJob = m
    }
    status = s
    launchdAgentInstalled = FileManager.default.fileExists(atPath: agentPlist.path)
  }

  // MARK: login item / old launchd agent

  var launchAtLogin: Bool {
    get { SMAppService.mainApp.status == .enabled }
    set {
      do {
        if newValue { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
      } catch {
        NSLog("launch at login: \(error)")
      }
      objectWillChange.send()
    }
  }

  /// `npm run server:install` registered the server with launchd; that fights
  /// this app for the port, so offer to remove it.
  func removeLaunchdAgent() {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    p.arguments = ["bootout", "gui/\(getuid())", agentPlist.path]
    try? p.run(); p.waitUntilExit()
    try? FileManager.default.removeItem(at: agentPlist)
    launchdAgentInstalled = false
    restart()
  }

  func openStatusPage() { NSWorkspace.shared.open(statusPageURL) }
  func openLog() { NSWorkspace.shared.open(logURL) }
  func openConfigFile() { NSWorkspace.shared.open(ServerConfig.path) }

  func quit() {
    stop()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { NSApp.terminate(nil) }
  }
}
