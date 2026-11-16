// Nativní část rozšíření: Safari sem doručí zprávy z browser.runtime.sendNativeMessage
// (src/safari/notifications.js). Odpověď je vždy { ok: true, … } nebo { ok: false, error }.
//
//   { type: "ping" }                                        → { ok, version }
//   { type: "permission" }                                  → { ok, level: granted | denied | notDetermined | provisional }
//   { type: "notify", id, title, message, url?, image? }    → { ok } – url jen https www.alza.cz/sk/hu, image = data URL
//   { type: "clear", id }                                   → { ok }
//   { type: "openNotificationSettings" }                    → { ok } – Nastavení systému → Oznámení → AllyZap

import AppKit
import Foundation
import SafariServices
import UserNotifications
import os

/// Kliknutí na notifikaci, kterou vytvořilo rozšíření: produkt v Safari
final class ExtensionNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ExtensionNotificationDelegate()
    private static let log = Logger(subsystem: "AllyZap.Extension", category: "notifications")

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let url = AlzaShared.alzaURL(response.notification.request.content.userInfo[AlzaShared.urlKey])
        let clicked = response.actionIdentifier == UNNotificationDefaultActionIdentifier
        Self.log.notice("Notification response in extension, clicked: \(clicked, privacy: .public), url: \(url != nil, privacy: .public)")
        // Vždy v Safari – výchozí prohlížeč může být jiný (např. Chrome) a v něm rozšíření není
        if clicked, let url {
            DispatchQueue.main.async { AlzaShared.openInSafari(url) }
        }
        // macOS k tomu spouští aplikaci – ať okno neukazuje. Opakovaně: aplikace se může přihlásit až po prvním signálu
        for delay in [0, 0.4, 0.8, 1.5] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                DistributedNotificationCenter.default().postNotificationName(AlzaShared.clickedSignal, object: nil, userInfo: nil, deliverImmediately: true)
            }
        }
        completionHandler()
    }
}

@objc(SafariWebExtensionHandler)
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let log = Logger(subsystem: "AllyZap.Extension", category: "native-messaging")

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]

        Self.handle(message) { reply in
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: reply]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

    static func handle(_ message: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        let type = message["type"] as? String ?? ""
        log.notice("Native message: \(type, privacy: .public)") // Jen druh zprávy – texty a adresy do logu nepatří
        switch type {
        case "ping":
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
            reply(["ok": true, "version": version])

        case "permission":
            AlzaNotifications.authorizationStatus { status in
                reply(["ok": true, "level": AlzaNotifications.level(status)])
            }

        case "notify":
            // Notifikaci vytváří tento proces – kliknutí na ni může macOS doručit sem místo aplikaci
            UNUserNotificationCenter.current().delegate = ExtensionNotificationDelegate.shared
            AlzaNotifications.post(
                id: message["id"] as? String,
                title: String((message["title"] as? String ?? "").prefix(500)),
                body: String((message["message"] as? String ?? "").prefix(4000)),
                url: AlzaShared.alzaURL(message["url"]),
                imageDataURL: message["image"] as? String
            ) { error in
                if let error {
                    log.error("Notification failed: \(error, privacy: .public)")
                    reply(["ok": false, "error": error])
                } else {
                    reply(["ok": true])
                }
            }

        case "clear":
            if let id = message["id"] as? String { AlzaNotifications.clear(id: id) }
            reply(["ok": true])

        case "openNotificationSettings":
            // Tlačítko pod radou k notifikacím (nastavení a průvodce rozšíření): rovnou oznámení aplikace AllyZap
            DispatchQueue.main.async { AlzaShared.openNotificationSettings() }
            reply(["ok": true])

        default:
            log.error("Unknown native message type: \(type, privacy: .public)")
            reply(["ok": false, "error": "unknown message type: \(type)"])
        }
    }
}
