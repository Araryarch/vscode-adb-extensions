# VS Android Runner

**Manage and run Android Emulators directly inside VS Code — no Android Studio required.**

---

## Features

| Feature | Description |
|---|---|
| 🔍 **Auto SDK Detection** | Finds your SDK via `ANDROID_HOME` / `ANDROID_SDK_ROOT` env vars or common default paths |
| 📋 **AVD List** | Lists all your Android Virtual Devices in the Activity Bar sidebar |
| ▶️ **Run Emulator** | Click an AVD to launch it as a background (detached) process |
| ❄️ **Cold Boot** | Right-click → *Run Cold Boot* to start without restoring snapshot |
| 🛑 **Stop Emulator** | Right-click a running device → *Stop Emulator* |
| 📋 **Logcat** | Right-click a running device → *Show Logcat* to tail logs in a VS Code terminal |
| 🔄 **Auto-Refresh** | Status (running/stopped) updates automatically every 10 seconds |
| ⚙️ **Settings Override** | Set `vsAndroidRunner.sdkPath` to point to a custom SDK location |

---

## Requirements

- Android SDK Command-Line Tools installed
- `emulator` and `adb` must be present under your SDK folder
- Node.js ≥ 18 (for building from source)

---

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `vsAndroidRunner.sdkPath` | string | `""` | Manual override for the Android SDK root path |
| `vsAndroidRunner.autoRefreshInterval` | number | `10` | Seconds between auto status refresh (0 = disabled) |

---

## Getting Started

1. Install the extension
2. Open the **Android Runner** panel in the Activity Bar (left sidebar)
3. If your SDK is not detected automatically, set the path in Settings → `vsAndroidRunner.sdkPath`
4. Click an AVD to launch it, or right-click for more options

---

## Building from Source

```bash
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

---

## License

MIT
