import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SdkPaths, listAvds, runAvd } from './avdManager';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunConfig {
  projectRoot: string;
  gradlew: string;       // path to gradlew / gradlew.bat
  packageName: string;
  mainActivity: string;
  sdkPaths: SdkPaths;
  avdName: string;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function runAndroidApp(sdkPaths: SdkPaths): Promise<void> {
  // 1. Locate project root (find gradlew in workspace)
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    vscode.window.showErrorMessage(
      'Droid Studio: No Android project found in workspace. Open a project folder with gradlew first.'
    );
    return;
  }

  // 2. Read package name from manifest / build.gradle
  const packageName = readPackageName(projectRoot);
  if (!packageName) {
    vscode.window.showErrorMessage(
      'Droid Studio: Could not detect package name. Check your AndroidManifest.xml or app/build.gradle.kts.'
    );
    return;
  }

  // 3. Pick the AVD
  const avdName = await pickAvd(sdkPaths);
  if (!avdName) { return; }

  const gradlew = isWin()
    ? path.join(projectRoot, 'gradlew.bat')
    : path.join(projectRoot, 'gradlew');

  const cfg: RunConfig = {
    projectRoot,
    gradlew,
    packageName,
    mainActivity: `${packageName}/.MainActivity`,
    sdkPaths,
    avdName,
  };

  // 4. Run everything in a single terminal sequence
  await runSequence(cfg);
}

// ─── Step: Pick AVD ───────────────────────────────────────────────────────────

async function pickAvd(sdkPaths: SdkPaths): Promise<string | undefined> {
  let avds: Awaited<ReturnType<typeof listAvds>>;
  try {
    avds = await listAvds(sdkPaths);
  } catch {
    vscode.window.showErrorMessage('Droid Studio: Could not list AVDs.');
    return undefined;
  }

  if (!avds.length) {
    vscode.window.showErrorMessage(
      'Droid Studio: No AVDs found. Create one in the Android Emulators panel first.'
    );
    return undefined;
  }

  // If one is already running, prefer that
  const running = avds.filter(a => a.status === 'running');
  if (running.length === 1) {
    const use = await vscode.window.showInformationMessage(
      `Use running emulator: ${running[0].name}?`,
      'Yes', 'Pick another'
    );
    if (use === 'Yes') { return running[0].name; }
  }

  const picked = await vscode.window.showQuickPick(
    avds.map(a => ({
      label: a.name,
      description: a.status === 'running' ? '● Running' : '○ Stopped',
      avd: a,
    })),
    { title: 'Run App — Select Emulator', placeHolder: 'Pick an AVD to run on' }
  );
  return picked?.label;
}

// ─── Step: Run Sequence ───────────────────────────────────────────────────────

async function runSequence(cfg: RunConfig): Promise<void> {
  const { projectRoot, gradlew, packageName, mainActivity, sdkPaths, avdName } = cfg;
  const adb = sdkPaths.adb;
  const emulatorExe = sdkPaths.emulator;

  // Check if AVD is already running
  const runningSerial = await getRunningEmulatorSerial(adb, avdName);

  // Build the full shell script that runs in one terminal
  const serial = runningSerial ?? 'emulator-5554'; // will be refined after boot

  const script = isWin()
    ? buildWindowsScript(cfg, runningSerial, emulatorExe, adb, serial)
    : buildUnixScript(cfg, runningSerial, emulatorExe, adb);

  const term = vscode.window.createTerminal({
    name: `▶ Run — ${packageName.split('.').pop()}`,
    cwd: projectRoot,
    iconPath: new vscode.ThemeIcon('play-circle'),
  });
  term.show();
  term.sendText(script);
}

function buildWindowsScript(
  cfg: RunConfig,
  runningSerial: string | null,
  emulatorExe: string,
  adb: string,
  _serial: string
): string {
  const { gradlew, packageName, mainActivity, avdName } = cfg;
  const lines: string[] = [];

  lines.push(`Write-Host "🎯 Droid Studio — Run App" -ForegroundColor Cyan`);
  lines.push(`Write-Host "Project: ${cfg.projectRoot}" -ForegroundColor Gray`);
  lines.push('');

  if (!runningSerial) {
    lines.push(`Write-Host "🚀 Starting emulator: ${avdName}..." -ForegroundColor Yellow`);
    lines.push(`Start-Process -FilePath "${emulatorExe}" -ArgumentList "-avd","${avdName}" -WindowStyle Normal`);
    lines.push('');
    lines.push(`Write-Host "⏳ Waiting for emulator to boot..." -ForegroundColor Yellow`);
    lines.push(`& "${adb}" wait-for-device`);
    lines.push(`do { Start-Sleep -Seconds 2; $boot = & "${adb}" shell getprop sys.boot_completed 2>$null } while ($boot.Trim() -ne "1")`);
    lines.push(`Start-Sleep -Seconds 2 # allow system to settle`);
    lines.push(`Write-Host "✅ Emulator ready!" -ForegroundColor Green`);
  } else {
    lines.push(`Write-Host "✅ Using running emulator: ${runningSerial}" -ForegroundColor Green`);
  }

  lines.push('');
  lines.push(`Write-Host "🔨 Building with Gradle..." -ForegroundColor Yellow`);
  lines.push(`& "${gradlew}" installDebug`);
  lines.push(`if ($LASTEXITCODE -ne 0) { Write-Host "❌ Build failed!" -ForegroundColor Red; exit 1 }`);
  lines.push('');
  lines.push(`Write-Host "🚀 Launching ${packageName}..." -ForegroundColor Green`);
  lines.push(`& "${adb}" shell am start -n "${mainActivity}"`);
  lines.push(`Write-Host "✅ App launched!" -ForegroundColor Green`);

  return lines.join('\n');
}

function buildUnixScript(
  cfg: RunConfig,
  runningSerial: string | null,
  emulatorExe: string,
  adb: string
): string {
  const { gradlew, packageName, mainActivity, avdName } = cfg;
  const lines: string[] = [];

  lines.push(`echo "\\033[36m🎯 Droid Studio — Run App\\033[0m"`);
  lines.push('');

  if (!runningSerial) {
    lines.push(`echo "\\033[33m🚀 Starting emulator: ${avdName}...\\033[0m"`);
    lines.push(`"${emulatorExe}" -avd "${avdName}" &`);
    lines.push(`EMU_PID=$!`);
    lines.push('');
    lines.push(`echo "\\033[33m⏳ Waiting for emulator to boot...\\033[0m"`);
    lines.push(`"${adb}" wait-for-device`);
    lines.push(`until [ "$("${adb}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r')" = "1" ]; do sleep 2; done`);
    lines.push(`sleep 2 # allow system to settle`);
    lines.push(`echo "\\033[32m✅ Emulator ready!\\033[0m"`);
  } else {
    lines.push(`echo "\\033[32m✅ Using running emulator: ${runningSerial}\\033[0m"`);
  }

  lines.push('');
  lines.push(`echo "\\033[33m🔨 Building with Gradle...\\033[0m"`);
  lines.push(`chmod +x "${gradlew}"`);
  lines.push(`"${gradlew}" installDebug || { echo "\\033[31m❌ Build failed!\\033[0m"; exit 1; }`);
  lines.push('');
  lines.push(`echo "\\033[32m🚀 Launching ${packageName}...\\033[0m"`);
  lines.push(`"${adb}" shell am start -n "${mainActivity}"`);
  lines.push(`echo "\\033[32m✅ App launched!\\033[0m"`);

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findProjectRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { return undefined; }

  for (const folder of folders) {
    const root = folder.uri.fsPath;
    // Look for gradlew or gradlew.bat in root or one level deep
    const candidates = [
      path.join(root, 'gradlew'),
      path.join(root, 'gradlew.bat'),
    ];
    if (candidates.some(fs.existsSync)) { return root; }

    // Check subdirectories (in case user opened parent folder)
    for (const sub of safeDirRead(root)) {
      const subPath = path.join(root, sub);
      if (fs.statSync(subPath).isDirectory()) {
        if (fs.existsSync(path.join(subPath, 'gradlew')) ||
            fs.existsSync(path.join(subPath, 'gradlew.bat'))) {
          return subPath;
        }
      }
    }
  }
  return undefined;
}

function readPackageName(root: string): string | undefined {
  // 1. Try AndroidManifest.xml
  const manifestPath = path.join(root, 'app/src/main/AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const m = content.match(/package\s*=\s*["']([^"']+)["']/);
    if (m) { return m[1]; }
  }

  // 2. Try app/build.gradle.kts → namespace = "com.example.app"
  const buildGradle = path.join(root, 'app/build.gradle.kts');
  if (fs.existsSync(buildGradle)) {
    const content = fs.readFileSync(buildGradle, 'utf-8');
    const m = content.match(/namespace\s*=\s*["']([^"']+)["']/);
    if (m) { return m[1]; }
    // applicationId fallback
    const m2 = content.match(/applicationId\s*=\s*["']([^"']+)["']/);
    if (m2) { return m2[1]; }
  }

  // 3. Try app/build.gradle (Groovy)
  const groovy = path.join(root, 'app/build.gradle');
  if (fs.existsSync(groovy)) {
    const content = fs.readFileSync(groovy, 'utf-8');
    const m = content.match(/applicationId\s+['"]([\w.]+)['"]/);
    if (m) { return m[1]; }
  }

  return undefined;
}

async function getRunningEmulatorSerial(adb: string, avdName: string): Promise<string | null> {
  return new Promise((resolve) => {
    cp.exec(`"${adb}" devices`, { encoding: 'utf-8' }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      // Check if any emulator is connected
      const lines = stdout.split('\n').filter(l => l.includes('emulator') && l.includes('device'));
      if (!lines.length) { resolve(null); return; }

      // Try to match by AVD name using `adb -s <serial> emu avd name`
      const serials = lines.map(l => l.split('\t')[0].trim());
      let resolved = false;
      let checked = 0;
      for (const serial of serials) {
        cp.exec(`"${adb}" -s ${serial} emu avd name`, { encoding: 'utf-8' }, (e2, out2) => {
          checked++;
          if (!resolved && !e2 && out2.trim().split('\n')[0].trim() === avdName) {
            resolved = true;
            resolve(serial);
          } else if (checked === serials.length && !resolved) {
            // Return first emulator even if we can't match by name
            resolve(serials[0] ?? null);
          }
        });
      }
    });
  });
}

function safeDirRead(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function isWin(): boolean { return process.platform === 'win32'; }
