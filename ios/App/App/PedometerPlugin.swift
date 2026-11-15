import Foundation
import CoreMotion
import Capacitor

@objc(PedometerPlugin)
public class PedometerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PedometerPlugin"
    public let jsName = "Pedometer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "today", returnType: CAPPluginReturnPromise)
    ]
    private let pedometer = CMPedometer()
    private func state() -> String {
        guard CMPedometer.isStepCountingAvailable() else { return "unsupported" }
        switch CMPedometer.authorizationStatus() {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "restricted"
        }
    }
    @objc public func status(_ call: CAPPluginCall) { call.resolve(["status": state()]) }
    @objc public func today(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let status = self.state()
            guard status != "unsupported" else { call.reject("当前设备不支持自动计步", "UNSUPPORTED"); return }
            guard status != "denied" && status != "restricted" else { call.reject("请在 iPhone 设置的运动与健身中允许小卡日记访问", "MOTION_DENIED"); return }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .autoupdatingCurrent
            let end = Date(), start = calendar.startOfDay(for: end)
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = "yyyy-MM-dd"
            let date = formatter.string(from: start)
            self.pedometer.queryPedometerData(from: start, to: end) { data, error in
                if let error = error { call.reject("步数读取失败，请检查运动与健身权限后重试", "MOTION_QUERY_FAILED", error); return }
                guard let data = data else { call.reject("系统暂未返回步数，请稍后刷新", "NO_DATA"); return }
                call.resolve(["date": date, "steps": data.numberOfSteps.intValue])
            }
        }
    }
}
