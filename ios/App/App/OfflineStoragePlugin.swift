import Foundation
import UIKit
import Capacitor
import SQLite3
import Security

@objc(OfflineStoragePlugin)
public class OfflineStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OfflineStoragePlugin"
    public let jsName = "OfflineStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "credential", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "local.xiaoka.offline")
    private var database: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private func open() throws {
        if database != nil { return }
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let file = directory.appendingPathComponent("xiaoka-local.sqlite")
        if sqlite3_open_v2(file.path, &database, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) != SQLITE_OK { throw NSError(domain: "SQLiteOpen", code: 1) }
        sqlite3_busy_timeout(database, 5000)
        if sqlite3_exec(database, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS snapshots(partition TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records(partition TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(partition,key));", nil, nil, nil) != SQLITE_OK { throw NSError(domain: "SQLiteSchema", code: 2) }
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file.path)
    }
    @objc public func load(_ call: CAPPluginCall) {
        queue.async { do {
            try self.open()
            guard let key = call.getString("key") else { call.reject("Missing partition"); return }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(self.database, "SELECT value FROM snapshots WHERE partition=?", -1, &statement, nil) == SQLITE_OK else { call.reject("SQLite read failed"); return }
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_text(statement, 1, key, -1, self.transient)
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { call.resolve(["value": NSNull()]); return }
            guard status == SQLITE_ROW, let raw = sqlite3_column_text(statement, 0), let data = String(cString: raw).data(using: .utf8), var value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { call.reject("SQLite read failed"); return }
            var rows: OpaquePointer?
            guard sqlite3_prepare_v2(self.database, "SELECT key,value FROM records WHERE partition=?", -1, &rows, nil) == SQLITE_OK else { call.reject("SQLite records read failed"); return }
            defer { sqlite3_finalize(rows) }
            sqlite3_bind_text(rows, 1, key, -1, self.transient)
            var records = value["records"] as? [String: Any] ?? [:]
            var step = sqlite3_step(rows)
            while step == SQLITE_ROW {
                guard let k = sqlite3_column_text(rows, 0), let v = sqlite3_column_text(rows, 1), let json = String(cString: v).data(using: .utf8) else { call.reject("Corrupt local record"); return }
                records[String(cString: k)] = try JSONSerialization.jsonObject(with: json)
                step = sqlite3_step(rows)
            }
            guard step == SQLITE_DONE else { call.reject("SQLite records read failed"); return }
            value["records"] = records
            let encoded = try JSONSerialization.data(withJSONObject: value)
            call.resolve(["value": String(data: encoded, encoding: .utf8)!])
        } catch { call.reject("Local database unavailable", nil, error) } }
    }
    @objc public func save(_ call: CAPPluginCall) {
        queue.async { do {
            try self.open()
            guard let key = call.getString("key"), let value = call.getString("value"), let raw = call.getString("records")?.data(using: .utf8), let changes = try JSONSerialization.jsonObject(with: raw) as? [[String: Any]] else { call.reject("Missing data"); return }
            guard sqlite3_exec(self.database, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK else { call.reject("SQLite transaction failed"); return }
            var committed = false
            defer { if !committed { sqlite3_exec(self.database, "ROLLBACK", nil, nil, nil) } }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(self.database, "INSERT INTO snapshots VALUES(?,?) ON CONFLICT(partition) DO UPDATE SET value=excluded.value", -1, &statement, nil) == SQLITE_OK else { call.reject("SQLite write failed"); return }
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_text(statement, 1, key, -1, self.transient)
            sqlite3_bind_text(statement, 2, value, -1, self.transient)
            guard sqlite3_step(statement) == SQLITE_DONE else { call.reject("Local save failed; check device space"); return }
            for change in changes {
                guard let recordKey = change["key"] as? String else { throw NSError(domain: "RecordKey", code: 3) }
                var row: OpaquePointer?
                let deleting = change["value"] is NSNull
                let sql = deleting ? "DELETE FROM records WHERE partition=? AND key=?" : "INSERT INTO records VALUES(?,?,?) ON CONFLICT(partition,key) DO UPDATE SET value=excluded.value"
                guard sqlite3_prepare_v2(self.database, sql, -1, &row, nil) == SQLITE_OK else { throw NSError(domain: "RecordWrite", code: 4) }
                defer { sqlite3_finalize(row) }
                sqlite3_bind_text(row, 1, key, -1, self.transient)
                sqlite3_bind_text(row, 2, recordKey, -1, self.transient)
                if !deleting { let json = try JSONSerialization.data(withJSONObject: change["value"]!); sqlite3_bind_text(row, 3, String(data: json, encoding: .utf8)!, -1, self.transient) }
                guard sqlite3_step(row) == SQLITE_DONE else { throw NSError(domain: "RecordWrite", code: 5) }
            }
            guard sqlite3_exec(self.database, "COMMIT", nil, nil, nil) == SQLITE_OK else { throw NSError(domain: "Commit", code: 6) }
            committed = true
            call.resolve()
        } catch { call.reject("Local save failed", nil, error) } }
    }
    @objc public func credential(_ call: CAPPluginCall) {
        queue.async {
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "local.xiaoka.session", kSecAttrAccount as String: "current"]
            switch call.getString("action") {
            case "read":
                var read = query; read[kSecReturnData as String] = true; read[kSecMatchLimit as String] = kSecMatchLimitOne
                var result: CFTypeRef?
                let status = SecItemCopyMatching(read as CFDictionary, &result)
                if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
                guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else { call.reject("Keychain read failed"); return }
                call.resolve(["value": value])
            case "write":
                guard let value = call.getString("value"), let data = value.data(using: .utf8) else { call.reject("Missing credential"); return }
                let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
                var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
                if status == errSecItemNotFound { var item = query; item.merge(attributes) { _, new in new }; status = SecItemAdd(item as CFDictionary, nil) }
                guard status == errSecSuccess else { call.reject("Keychain save failed"); return }; call.resolve()
            case "delete":
                let status = SecItemDelete(query as CFDictionary)
                guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("Keychain delete failed"); return }; call.resolve()
            default: call.reject("Unknown credential action")
            }
        }
    }
    deinit { if database != nil { sqlite3_close(database) } }
}

class LocalBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(OfflineStoragePlugin()) }
}
