import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FlutterDevice {
  name: string;
  id: string;
  platform: string;
  isEmulator: boolean;
  sdk: string;
  isSupported: boolean;
}

// ─── Detection ───────────────────────────────────────────────────────────────

export function detectFlutter(): string | undefined {
  // 1. User-set PATH (works if `flutter` is on PATH)
  const fromPath = tryExec('flutter', ['--version', '--machine']);
  if (fromPath) { return 'flutter'; }

  // 2. Common install paths
  const home = os.homedir();
  const candidates = [
    process.env['FLUTTER_HOME']
      ? path.join(process.env['FLUTTER_HOME'], 'bin', isWin() ? 'flutter.bat' : 'flutter')
      : null,
    path.join(home, 'flutter', 'bin', isWin() ? 'flutter.bat' : 'flutter'),
    path.join(home, 'snap', 'flutter', 'common', 'flutter', 'bin', 'flutter'),
    '/opt/flutter/bin/flutter',
    '/usr/local/bin/flutter',
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) { return p; }
  }
  return undefined;
}

// ─── Devices ─────────────────────────────────────────────────────────────────

export async function getFlutterDevices(flutter: string): Promise<FlutterDevice[]> {
  return new Promise((resolve) => {
    const opts: cp.ExecOptionsWithStringEncoding = { encoding: 'utf-8' };
      cp.exec(
        `"${flutter}" devices --machine`,
        opts,
        (err, stdout) => {
          if (err || !stdout?.trim()) { resolve([]); return; }
        try {
          // flutter outputs some warnings before JSON — find first '['
          const jsonStart = stdout.indexOf('[');
          const json = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
          const raw: Record<string, unknown>[] = JSON.parse(json);
          resolve(
            raw.map(d => ({
              name: String(d['name'] ?? d['id']),
              id: String(d['id']),
              platform: String(d['targetPlatform'] ?? d['platform'] ?? 'unknown'),
              isEmulator: Boolean(d['emulator']),
              sdk: String(d['sdk'] ?? ''),
              isSupported: Boolean(d['isSupported'] ?? true),
            }))
          );
          } catch { resolve([]); }
        }
      );
  });
}

// ─── Terminal Helpers ─────────────────────────────────────────────────────────

export function runFlutterInTerminal(
  flutter: string,
  args: string[],
  name = 'Flutter',
  cwd?: string
): void {
  const dir = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const term = vscode.window.createTerminal({ name, cwd: dir });
  term.show();
  term.sendText(`"${flutter}" ${args.join(' ')}`);
}

// ─── Tree Items ───────────────────────────────────────────────────────────────

export class FlutterDeviceItem extends vscode.TreeItem {
  constructor(public readonly device: FlutterDevice) {
    super(device.name, vscode.TreeItemCollapsibleState.None);

    const running = false; // flutter doesn't expose "is currently running" via CLI easily
    this.description = device.platform + (device.isEmulator ? ' · emu' : '');
    this.tooltip = `${device.name}\nID: ${device.id}\nSDK: ${device.sdk}`;
    this.contextValue = 'flutter-device';
    this.iconPath = new vscode.ThemeIcon(
      device.isEmulator ? 'device-mobile' : 'plug',
      new vscode.ThemeColor('charts.green')
    );
    this.command = {
      command: 'droidStudio.flutterRun',
      title: 'Run Flutter',
      arguments: [this],
    };
  }
}

export class FlutterActionItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly command_id: string,
    icon: string,
    description?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = {
      command: command_id,
      title: label,
    };
  }
}

// ─── Tree Providers ───────────────────────────────────────────────────────────

export class FlutterDeviceProvider
  implements vscode.TreeDataProvider<FlutterDeviceItem>
{
  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onChange.event;
  private items: FlutterDeviceItem[] = [];

  constructor(private getFlutter: () => string | undefined) {}

  refresh(): void { this._onChange.fire(); }

  getTreeItem(el: FlutterDeviceItem): vscode.TreeItem { return el; }

  async getChildren(): Promise<FlutterDeviceItem[]> {
    const flutter = this.getFlutter();
    if (!flutter) { return []; }
    try {
      const devices = await getFlutterDevices(flutter);
      this.items = devices.map(d => new FlutterDeviceItem(d));
      return this.items;
    } catch { return []; }
  }
}

export class FlutterActionProvider
  implements vscode.TreeDataProvider<FlutterActionItem>
{
  getTreeItem(el: FlutterActionItem): vscode.TreeItem { return el; }

  getChildren(): FlutterActionItem[] {
    return [
      new FlutterActionItem('New Flutter Project', 'droidStudio.flutterNew', 'add', 'wizard'),
      new FlutterActionItem('flutter pub get', 'droidStudio.flutterPubGet', 'package'),
      new FlutterActionItem('flutter pub upgrade', 'droidStudio.flutterPubUpgrade', 'arrow-up'),
      new FlutterActionItem('flutter clean', 'droidStudio.flutterClean', 'trash'),
      new FlutterActionItem('flutter doctor', 'droidStudio.flutterDoctor', 'pulse'),
      new FlutterActionItem('flutter analyze', 'droidStudio.flutterAnalyze', 'search'),
      new FlutterActionItem('Build APK (debug)', 'droidStudio.flutterBuildApk', 'package'),
      new FlutterActionItem('Build APK (release)', 'droidStudio.flutterBuildApkRelease', 'package'),
      new FlutterActionItem('Build AAB (release)', 'droidStudio.flutterBuildAab', 'cloud-upload'),
      new FlutterActionItem('Build Web', 'droidStudio.flutterBuildWeb', 'globe'),
      new FlutterActionItem('flutter run (all)', 'droidStudio.flutterRunAll', 'play-circle'),
      new FlutterActionItem('flutter test', 'droidStudio.flutterTest', 'beaker'),
    ];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWin(): boolean { return process.platform === 'win32'; }

function tryExec(cmd: string, args: string[]): boolean {
  try {
    const r = cp.spawnSync(cmd, args, { encoding: 'utf-8', shell: true, timeout: 5000 });
    return !r.error && r.status === 0;
  } catch { return false; }
}
