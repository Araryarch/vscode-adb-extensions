import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AvdInfo {
  name: string;
  status: 'running' | 'stopped';
  /** adb serial (e.g. "emulator-5554") when running, otherwise undefined */
  serial?: string;
}

export interface SdkPaths {
  sdkRoot: string;
  emulator: string;
  adb: string;
  avdmanager: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the Android SDK root directory, or undefined if it cannot be found.
 * Priority:
 *   1. User setting (vsAndroidRunner.sdkPath)
 *   2. ANDROID_HOME environment variable
 *   3. ANDROID_SDK_ROOT environment variable
 *   4. Common default install paths per platform
 */
export function detectSdkRoot(userOverride?: string): string | undefined {
  // 1. User setting
  if (userOverride && userOverride.trim() !== '') {
    const p = userOverride.trim();
    if (existsDir(p)) {
      return p;
    }
  }

  // 2. & 3. Environment variables
  const fromEnv =
    process.env['ANDROID_HOME'] || process.env['ANDROID_SDK_ROOT'];
  if (fromEnv && existsDir(fromEnv)) {
    return fromEnv;
  }

  // 4. Common defaults
  const defaults = getDefaultSdkPaths();
  for (const candidate of defaults) {
    if (existsDir(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Returns all resolved SDK binary paths, or throws an error if the SDK root
 * cannot be determined.
 */
export function resolveSdkPaths(userOverride?: string): SdkPaths {
  const root = detectSdkRoot(userOverride);
  if (!root) {
    throw new Error(
      'Android SDK not found. Please set vsAndroidRunner.sdkPath in VS Code settings, ' +
        'or define the ANDROID_HOME / ANDROID_SDK_ROOT environment variable.'
    );
  }

  const isWin = process.platform === 'win32';
  const ext = isWin ? '.exe' : '';
  const batExt = isWin ? '.bat' : '';

  return {
    sdkRoot: root,
    emulator: path.join(root, 'emulator', `emulator${ext}`),
    adb: path.join(root, 'platform-tools', `adb${ext}`),
    avdmanager: path.join(
      root,
      'cmdline-tools',
      'latest',
      'bin',
      `avdmanager${batExt}`
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a command synchronously and returns stdout as a trimmed string.
 * Throws an error on non-zero exit.
 */
export function runSync(cmd: string, args: string[]): string {
  const result = cp.spawnSync(cmd, args, {
    encoding: 'utf-8',
    // Needed on Windows so we can find .bat / .cmd files
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? '';
    throw new Error(
      `Command "${cmd} ${args.join(' ')}" failed (exit ${result.status}): ${stderr}`
    );
  }
  return (result.stdout ?? '').trim();
}

/**
 * Launches an emulator as a **detached** background process so VS Code is
 * never blocked.  Returns the spawned ChildProcess.
 */
export function spawnDetached(
  cmd: string,
  args: string[]
): cp.ChildProcess {
  const child = cp.spawn(cmd, args, {
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  child.unref();
  return child;
}

// ─────────────────────────────────────────────────────────────────────────────
// AVD Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lists all AVD names registered on this machine.
 */
export function listAvdNames(paths: SdkPaths): string[] {
  const output = runSync(paths.emulator, ['-list-avds']);
  if (!output) {
    return [];
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        // emulator sometimes prints INFO lines or warnings before the list
        !line.startsWith('INFO') &&
        !line.startsWith('WARNING') &&
        !line.startsWith('ERROR') &&
        !line.startsWith('ANDROID_')
    );
}

/**
 * Returns a map of { avdName → adb serial } for all *currently running*
 * emulators using `adb devices` + `adb -s <serial> emu avd name`.
 *
 * We cache the result per-call so we don't hammer adb when there are many
 * AVDs.
 */
export async function getRunningAvds(
  paths: SdkPaths
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  let devicesOutput: string;
  try {
    devicesOutput = runSync(paths.adb, ['devices']);
  } catch {
    // adb not available yet — treat everything as stopped
    return result;
  }

  // Parse lines like "emulator-5554\tdevice"
  const lines = devicesOutput.split('\n').slice(1); // skip header
  const serials: string[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (
      parts.length >= 2 &&
      parts[0].startsWith('emulator-') &&
      parts[1] === 'device'
    ) {
      serials.push(parts[0]);
    }
  }

  // Resolve AVD name for each serial in parallel
  await Promise.all(
    serials.map(async (serial) => {
      try {
        const name = runSync(paths.adb, ['-s', serial, 'emu', 'avd', 'name']);
        // Output is "MyAVD\nOK" — take the first line
        const avdName = name.split('\n')[0].trim();
        if (avdName) {
          result.set(avdName, serial);
        }
      } catch {
        // ignore per-device failures
      }
    })
  );

  return result;
}

/**
 * Builds the full list of AvdInfo objects, merging saved names with running
 * status from ADB.
 */
export async function listAvds(paths: SdkPaths): Promise<AvdInfo[]> {
  const names = listAvdNames(paths);
  const running = await getRunningAvds(paths);

  return names.map((name) => ({
    name,
    status: running.has(name) ? 'running' : 'stopped',
    serial: running.get(name),
  }));
}

/**
 * Launches an AVD in a detached background process.
 * @param coldBoot  Pass true to add the `-no-snapshot` flag (cold boot).
 */
export function runAvd(
  paths: SdkPaths,
  avdName: string,
  coldBoot = false
): void {
  const args = ['-avd', avdName];
  if (coldBoot) {
    args.push('-no-snapshot-load');
  }
  spawnDetached(paths.emulator, args);
}

/**
 * Stops a running emulator by sending "emu kill" via adb.
 */
export function stopAvd(paths: SdkPaths, serial: string): void {
  try {
    runSync(paths.adb, ['-s', serial, 'emu', 'kill']);
  } catch {
    // The emulator may have already closed — ignore
  }
}

/**
 * Opens a Logcat stream in a new VS Code terminal.
 * Returns the terminal label so the caller can show it.
 */
export function buildLogcatArgs(
  paths: SdkPaths,
  serial: string
): { cmd: string; args: string[] } {
  return {
    cmd: paths.adb,
    args: ['-s', serial, 'logcat'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function getDefaultSdkPaths(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return [
        path.join(home, 'AppData', 'Local', 'Android', 'Sdk'),
        'C:\\Android\\Sdk',
        'C:\\Android\\android-sdk',
      ];
    case 'darwin':
      return [
        path.join(home, 'Library', 'Android', 'sdk'),
        '/opt/android-sdk',
      ];
    default:
      // Linux
      return [
        path.join(home, 'Android', 'Sdk'),
        '/opt/android-sdk',
        '/usr/local/android-sdk',
      ];
  }
}
