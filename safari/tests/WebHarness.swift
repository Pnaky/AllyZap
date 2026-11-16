// Spustí testovací stránku ve WKWebView (WebKit – stejný engine jako Safari) a vypíše výsledky.
// Stránka hlásí řádky zprávou { log } a konec zprávou { done: true | false }.
//
//   WebHarness <stránka.html[#kotva]> <kořen pro čtení souborů>
//
// Prostředí: HARNESS_SIZE=šířkaxvýška (výchozí 900x700), HARNESS_SNAPSHOT=soubor.png – po dokončení uloží snímek stránky
// (kontrola vzhledu očima)

import AppKit
import WebKit

/// Jako Safari na Macu – rozšíření podle toho volí rady (notifikace přes aplikaci AllyZap, verze prohlížeče v hlášení)
let safariUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"

final class Harness: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    let window: NSWindow
    let snapshotPath: String?

    init(page: URL, root: URL, size: NSSize, snapshotPath: String?) {
        self.snapshotPath = snapshotPath
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = WKUserContentController()
        // Spuštěno přes SSH (bez přihlášené obrazovky) WebKit okno nevidí a stránku přiškrtí (~1 úloha za sekundu)
        if #available(macOS 14.0, *) { configuration.preferences.inactiveSchedulingPolicy = .none }
        webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        webView.customUserAgent = safariUserAgent
        // V okně mimo obrazovku – skrytá stránka by měla přiškrcené časovače
        window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -6000, y: -6000), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        configuration.userContentController.add(self, name: "test")
        webView.navigationDelegate = self
        window.contentView = webView
        window.orderBack(nil)
        webView.loadFileURL(page, allowingReadAccessTo: root)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let line = body["log"] as? String { print(line) }
        if let done = body["done"] as? Bool {
            fflush(stdout)
            guard let snapshotPath else { exit(done ? 0 : 1) }
            webView.takeSnapshot(with: nil) { image, error in
                if let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                   let png = bitmap.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: snapshotPath))
                } else {
                    print("snímek se nepovedl: \(error?.localizedDescription ?? "?")")
                }
                exit(done ? 0 : 1)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("navigation failed: \(error.localizedDescription)")
        exit(2)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("navigation failed: \(error.localizedDescription)")
        exit(2)
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    print("usage: WebHarness <page.html[#anchor]> <read-access-root>")
    exit(2)
}
// Kotva za # vybírá záložku stránky (nastavení #s-notifications, novinky #news)
let parts = arguments[1].split(separator: "#", maxSplits: 1).map(String.init)
var page = URL(fileURLWithPath: parts[0])
if parts.count == 2, var components = URLComponents(url: page, resolvingAgainstBaseURL: false) {
    components.fragment = parts[1]
    page = components.url ?? page
}
let environment = ProcessInfo.processInfo.environment
let dimensions = (environment["HARNESS_SIZE"] ?? "900x700").split(separator: "x").compactMap { Double($0) }
let size = dimensions.count == 2 ? NSSize(width: dimensions[0], height: dimensions[1]) : NSSize(width: 900, height: 700)

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let harness = Harness(page: page, root: URL(fileURLWithPath: arguments[2]), size: size, snapshotPath: environment["HARNESS_SNAPSHOT"])
DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
    print("TIMEOUT – stránka nedokončila testy do 60 s")
    exit(2)
}
app.run()
