import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────

interface ProjectConfig {
  name: string;
  pkg: string;
  lang: 'kotlin' | 'java';
  minSdk: string;
  template: 'empty' | 'basic' | 'bottomnav';
  dir: string;
}

// ─── Wizard ──────────────────────────────────────────────────────────────────

export async function runNewProjectWizard(): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: 'New Android Project — Step 1 of 5',
    prompt: 'Application Name',
    value: 'MyAndroidApp',
    validateInput: v => v.trim() ? null : 'Name is required',
  });
  if (!name) { return; }

  const defaultPkg = `com.example.${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const pkg = await vscode.window.showInputBox({
    title: 'New Android Project — Step 2 of 5',
    prompt: 'Package Name',
    value: defaultPkg,
    validateInput: v =>
      /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,}$/.test(v)
        ? null
        : 'Invalid package (e.g. com.example.myapp)',
  });
  if (!pkg) { return; }

  const langPick = await vscode.window.showQuickPick(
    [
      { label: '$(symbol-class) Kotlin', value: 'kotlin', description: 'Recommended' },
      { label: '$(coffee) Java', value: 'java' },
    ],
    { title: 'New Android Project — Step 3 of 5', placeHolder: 'Select language' }
  );
  if (!langPick) { return; }

  const sdkPick = await vscode.window.showQuickPick(
    [
      { label: 'API 21 — Android 5.0 Lollipop', value: '21', description: '~99% devices' },
      { label: 'API 24 — Android 7.0 Nougat', value: '24', description: '~95% devices' },
      { label: 'API 26 — Android 8.0 Oreo', value: '26', description: '~90% devices' },
      { label: 'API 28 — Android 9.0 Pie', value: '28', description: '~85% devices' },
      { label: 'API 33 — Android 13', value: '33', description: '~60% devices' },
      { label: 'API 34 — Android 14', value: '34', description: 'Latest' },
    ],
    { title: 'New Android Project — Step 4 of 5', placeHolder: 'Minimum SDK API level' }
  );
  if (!sdkPick) { return; }

  const tplPick = await vscode.window.showQuickPick(
    [
      { label: '$(file) Empty Activity', value: 'empty', description: 'Blank screen with a single Activity' },
      { label: '$(layout) Basic Views Activity', value: 'basic', description: 'Toolbar + FAB + content area' },
      { label: '$(list-selection) Bottom Navigation', value: 'bottomnav', description: 'Bottom nav with 3 tabs' },
    ],
    { title: 'New Android Project — Step 5 of 5', placeHolder: 'Select template' }
  );
  if (!tplPick) { return; }

  const uris = await vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false,
    openLabel: 'Create Project Here',
    title: 'Select project location',
  });
  if (!uris?.[0]) { return; }

  const dir = path.join(uris[0].fsPath, name.replace(/\s+/g, '_'));

  const cfg: ProjectConfig = {
    name, pkg,
    lang: langPick.value as 'kotlin' | 'java',
    minSdk: sdkPick.value,
    template: tplPick.value as ProjectConfig['template'],
    dir,
  };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating "${name}"…`, cancellable: false },
    async () => { generateProject(cfg); }
  );

  const choice = await vscode.window.showInformationMessage(
    `✅ Project "${name}" created!`, 'Open Project', 'Open in New Window'
  );
  if (choice === 'Open Project') {
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir));
  } else if (choice === 'Open in New Window') {
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), true);
  }
}

// ─── Generator ───────────────────────────────────────────────────────────────

function mk(p: string): void { fs.mkdirSync(p, { recursive: true }); }
function wr(p: string, c: string): void { fs.writeFileSync(p, c, 'utf-8'); }

function generateProject(cfg: ProjectConfig): void {
  const { name, pkg, lang, minSdk, template, dir } = cfg;
  const ext = lang === 'kotlin' ? 'kt' : 'java';
  const pkgPath = pkg.replace(/\./g, '/');
  const srcMain = path.join(dir, 'app/src/main');
  const srcTest = path.join(dir, 'app/src/test/java', pkgPath);
  const srcAndroidTest = path.join(dir, 'app/src/androidTest/java', pkgPath);

  // Create all directories
  mk(path.join(srcMain, `java/${pkgPath}`));
  mk(path.join(srcMain, 'res/layout'));
  mk(path.join(srcMain, 'res/values'));
  mk(path.join(srcMain, 'res/drawable'));
  mk(path.join(srcMain, 'res/mipmap-hdpi'));
  mk(path.join(srcMain, 'res/xml'));
  mk(path.join(dir, 'gradle/wrapper'));
  mk(srcTest);
  mk(srcAndroidTest);

  // ── Root files ──────────────────────────────────────────────────────────
  wr(path.join(dir, '.gitignore'), ROOT_GITIGNORE);
  wr(path.join(dir, 'settings.gradle.kts'), settingsGradle(name));
  wr(path.join(dir, 'build.gradle.kts'), ROOT_BUILD_GRADLE);
  wr(path.join(dir, 'gradle.properties'), GRADLE_PROPERTIES);
  wr(path.join(dir, 'local.properties'), LOCAL_PROPERTIES);

  // ── Gradle Wrapper ──────────────────────────────────────────────────────
  wr(path.join(dir, 'gradle/wrapper/gradle-wrapper.properties'), GRADLE_WRAPPER_PROPERTIES);
  wr(path.join(dir, 'gradlew'), GRADLEW_UNIX);
  wr(path.join(dir, 'gradlew.bat'), GRADLEW_BAT);
  // Make gradlew executable on Unix
  try { fs.chmodSync(path.join(dir, 'gradlew'), 0o755); } catch { /* Windows */ }

  // ── Version Catalog ─────────────────────────────────────────────────────
  wr(path.join(dir, 'gradle/libs.versions.toml'), libsVersionsToml(lang));

  // ── App module ──────────────────────────────────────────────────────────
  wr(path.join(dir, 'app/build.gradle.kts'), appBuildGradle(pkg, minSdk, lang));
  wr(path.join(dir, 'app/proguard-rules.pro'), PROGUARD_RULES);
  wr(path.join(srcMain, 'AndroidManifest.xml'), manifest(pkg, name));
  wr(path.join(srcMain, 'res/values/strings.xml'), stringsXml(name));
  wr(path.join(srcMain, 'res/values/themes.xml'), themesXml(name));
  wr(path.join(srcMain, 'res/values/colors.xml'), COLORS_XML);

  // ── Test stubs ──────────────────────────────────────────────────────────
  wr(path.join(srcTest, `ExampleUnitTest.${ext}`), exampleUnitTest(pkg, lang));
  wr(path.join(srcAndroidTest, `ExampleInstrumentedTest.${ext}`), exampleInstrumentedTest(pkg, lang));

  // ── Activity + layout ───────────────────────────────────────────────────
  if (template === 'empty') {
    wr(path.join(srcMain, 'res/layout/activity_main.xml'), LAYOUT_EMPTY);
    wr(path.join(srcMain, `java/${pkgPath}/MainActivity.${ext}`),
      lang === 'kotlin' ? mainActivityKt(pkg) : mainActivityJava(pkg));

  } else if (template === 'basic') {
    wr(path.join(srcMain, 'res/layout/activity_main.xml'), LAYOUT_BASIC);
    wr(path.join(srcMain, 'res/layout/content_main.xml'), LAYOUT_CONTENT);
    mk(path.join(srcMain, 'res/menu'));
    wr(path.join(srcMain, 'res/menu/menu_main.xml'), MENU_MAIN);
    wr(path.join(srcMain, `java/${pkgPath}/MainActivity.${ext}`),
      lang === 'kotlin' ? basicActivityKt(pkg) : basicActivityJava(pkg));

  } else {
    mk(path.join(srcMain, 'res/menu'));
    wr(path.join(srcMain, 'res/layout/activity_main.xml'), LAYOUT_BOTTOMNAV);
    wr(path.join(srcMain, 'res/layout/fragment_home.xml'), LAYOUT_FRAGMENT);
    wr(path.join(srcMain, 'res/menu/bottom_nav_menu.xml'), BOTTOM_NAV_MENU);
    wr(path.join(srcMain, `java/${pkgPath}/MainActivity.${ext}`),
      lang === 'kotlin' ? mainActivityKt(pkg) : mainActivityJava(pkg));
  }
}

// ─── Templates ───────────────────────────────────────────────────────────────

const LOCAL_PROPERTIES = `## This file must *NOT* be checked into Version Control Systems,
# as it contains information specific to your local installation.
#
# Location of the SDK. This is only used by Gradle.
# For customization when using a Version Control System, please read the
# "Customization of your local build" notes in the README.
#
# sdk.dir=/path/to/Android/Sdk
`;

const GRADLE_WRAPPER_PROPERTIES = `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;

// Minimal gradlew shell script (official Gradle wrapper)
const GRADLEW_UNIX = `#!/bin/sh
##
## Gradle start up script for UN*X
##

# Attempt to set APP_HOME
PRG="$0"
while [ -h "$PRG" ] ; do
  ls=\`ls -ld "$PRG"\`
  link=\`expr "$ls" : '.*-> \\(.*\\)$'\`
  if expr "$link" : '/.*' > /dev/null; then PRG="$link"; else PRG=\`dirname "$PRG"\`"/$link"; fi
done
SAVED="\`pwd\`"
cd "\`dirname \\"$PRG\\"\`/" >/dev/null
APP_HOME="\`pwd -P\`"
cd "$SAVED" >/dev/null

CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar

exec "$JAVACMD" $DEFAULT_JVM_OPTS $JAVA_OPTS $GRADLE_OPTS \\
  -classpath "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
`;

const GRADLEW_BAT = `@rem ##########################################################################
@rem  Gradle startup script for Windows
@rem ##########################################################################
@if "%DEBUG%"=="" @echo off
@rem Set local scope for the variables with windows NT shell
if "%OS%"=="Windows_NT" setlocal
set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%
set CLASSPATH=%APP_HOME%\\gradle\\wrapper\\gradle-wrapper.jar
@rem Find java.exe
if defined JAVA_HOME goto findJavaFromJavaHome
set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto execute
set JAVA_EXE=%JAVA_HOME%/bin/java.exe
:execute
@rem Setup the command line
set CMD_LINE_ARGS=
set _SKIP=2
:win9xME_args_slurp
if "x%~1" == "x" goto execute
set CMD_LINE_ARGS=%*
"%JAVA_EXE%" %DEFAULT_JVM_OPTS% %JAVA_OPTS% %GRADLE_OPTS% -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %CMD_LINE_ARGS%
:end
if "%ERRORLEVEL%"=="0" goto mainEnd
:fail
exit /b 1
:mainEnd
if "%OS%"=="Windows_NT" endlocal
:omega
`;

const PROGUARD_RULES = `# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
`;

function libsVersionsToml(lang: 'kotlin' | 'java'): string {
  const kotlinVersionLine = lang === 'kotlin' ? '\nkotlin = "1.9.22"' : '';
  const kotlinPlugin = lang === 'kotlin'
    ? '\nkotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }'
    : '';
  const coreKtx = lang === 'kotlin'
    ? '\nandroidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }'
    : '';
  const coreKtxVersion = lang === 'kotlin' ? '\ncoreKtx = "1.12.0"' : '';

  return `[versions]
agp = "8.3.2"${kotlinVersionLine}${coreKtxVersion}
junit = "4.13.2"
junitVersion = "1.1.5"
espressoCore = "3.5.1"
appcompat = "1.6.1"
material = "1.11.0"
constraintlayout = "2.1.4"

[libraries]${coreKtx}
junit = { group = "junit", name = "junit", version.ref = "junit" }
androidx-junit = { group = "androidx.test.ext", name = "junit", version.ref = "junitVersion" }
androidx-espresso-core = { group = "androidx.test.espresso", name = "espresso-core", version.ref = "espressoCore" }
androidx-appcompat = { group = "androidx.appcompat", name = "appcompat", version.ref = "appcompat" }
material = { group = "com.google.android.material", name = "material", version.ref = "material" }
androidx-constraintlayout = { group = "androidx.constraintlayout", name = "constraintlayout", version.ref = "constraintlayout" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }${kotlinPlugin}
`;
}

function exampleUnitTest(pkg: string, lang: 'kotlin' | 'java'): string {
  if (lang === 'kotlin') {
    return `package ${pkg}

import org.junit.Test
import org.junit.Assert.*

/**
 * Example local unit test, which will execute on the development machine (host).
 *
 * See [testing documentation](http://d.android.com/tools/testing).
 */
class ExampleUnitTest {
    @Test
    fun addition_isCorrect() {
        assertEquals(4, 2 + 2)
    }
}
`;
  }
  return `package ${pkg};

import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Example local unit test, which will execute on the development machine (host).
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
public class ExampleUnitTest {
    @Test
    public void addition_isCorrect() {
        assertEquals(4, 2 + 2);
    }
}
`;
}

function exampleInstrumentedTest(pkg: string, lang: 'kotlin' | 'java'): string {
  if (lang === 'kotlin') {
    return `package ${pkg}

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.*

/**
 * Instrumented test, which will execute on an Android device.
 *
 * See [testing documentation](http://d.android.com/tools/testing).
 */
@RunWith(AndroidJUnit4::class)
class ExampleInstrumentedTest {
    @Test
    fun useAppContext() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("${pkg}", appContext.packageName)
    }
}
`;
  }
  return `package ${pkg};

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Instrumented test, which will execute on an Android device.
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
    @Test
    public void useAppContext() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("${pkg}", appContext.getPackageName());
    }
}
`;
}

const ROOT_GITIGNORE = `*.iml\n.gradle\n/local.properties\n/.idea\n/build\n/captures\n.externalNativeBuild\n.cxx\n*.keystore\n`;

const ROOT_BUILD_GRADLE = `// Top-level build file
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
}
`;

const GRADLE_PROPERTIES = `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`;

const COLORS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="purple_200">#FFBB86FC</color>
    <color name="purple_500">#FF6200EE</color>
    <color name="purple_700">#FF3700B3</color>
    <color name="teal_200">#FF03DAC5</color>
    <color name="teal_700">#FF018786</color>
    <color name="black">#FF000000</color>
    <color name="white">#FFFFFFFF</color>
</resources>
`;

const LAYOUT_EMPTY = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Hello World!"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

</androidx.constraintlayout.widget.ConstraintLayout>
`;

const LAYOUT_BASIC = `<?xml version="1.0" encoding="utf-8"?>
<androidx.coordinatorlayout.widget.CoordinatorLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <com.google.android.material.appbar.AppBarLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:theme="@style/Theme.AppCompat.Light.DarkActionBar">
        <com.google.android.material.appbar.MaterialToolbar
            android:id="@+id/toolbar"
            android:layout_width="match_parent"
            android:layout_height="?attr/actionBarSize" />
    </com.google.android.material.appbar.AppBarLayout>

    <include layout="@layout/content_main" />

    <com.google.android.material.floatingactionbutton.FloatingActionButton
        android:id="@+id/fab"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="bottom|end"
        android:layout_marginEnd="16dp"
        android:layout_marginBottom="16dp"
        android:src="@android:drawable/ic_input_add" />

</androidx.coordinatorlayout.widget.CoordinatorLayout>
`;

const LAYOUT_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    app:layout_behavior="@string/appbar_scrolling_view_behavior">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Hello World!"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

</androidx.constraintlayout.widget.ConstraintLayout>
`;

const LAYOUT_BOTTOMNAV = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <FrameLayout
        android:id="@+id/nav_host_fragment"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        app:layout_constraintBottom_toTopOf="@id/bottom_nav"
        app:layout_constraintTop_toTopOf="parent" />

    <com.google.android.material.bottomnavigation.BottomNavigationView
        android:id="@+id/bottom_nav"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        app:menu="@menu/bottom_nav_menu"
        app:layout_constraintBottom_toBottomOf="parent" />

</androidx.constraintlayout.widget.ConstraintLayout>
`;

const LAYOUT_FRAGMENT = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <TextView
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:gravity="center"
        android:text="Home" />
</FrameLayout>
`;

const MENU_MAIN = `<?xml version="1.0" encoding="utf-8"?>
<menu xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto">
    <item android:id="@+id/action_settings"
        android:orderInCategory="100"
        android:title="Settings"
        app:showAsAction="never"/>
</menu>
`;

const BOTTOM_NAV_MENU = `<?xml version="1.0" encoding="utf-8"?>
<menu xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:id="@+id/navigation_home" android:title="Home" android:icon="@android:drawable/ic_menu_compass"/>
    <item android:id="@+id/navigation_dashboard" android:title="Dashboard" android:icon="@android:drawable/ic_menu_agenda"/>
    <item android:id="@+id/navigation_notifications" android:title="Notifications" android:icon="@android:drawable/ic_menu_today"/>
</menu>
`;

function settingsGradle(name: string): string {
  return `pluginManagement {
    repositories {
        google { content { includeGroupByRegex("com\\\\.android.*"); includeGroupByRegex("com\\\\.google.*"); includeGroupByRegex("androidx.*") } }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "${name}"
include(":app")
`;
}

function appBuildGradle(pkg: string, minSdk: string, lang: 'kotlin' | 'java'): string {
  const kotlinPlugin = lang === 'kotlin' ? '\n    alias(libs.plugins.kotlin.android)' : '';
  const coreKtxDep = lang === 'kotlin' ? '\n    implementation(libs.androidx.core.ktx)' : '';
  const kotlinOptions = lang === 'kotlin' ? '\n    kotlinOptions { jvmTarget = "11" }' : '';
  return `plugins {
    alias(libs.plugins.android.application)${kotlinPlugin}
}

android {
    namespace = "${pkg}"
    compileSdk = 34

    defaultConfig {
        applicationId = "${pkg}"
        minSdk = ${minSdk}
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }${kotlinOptions}
}

dependencies {${coreKtxDep}
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.constraintlayout)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
`;
}

function manifest(pkg: string, name: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.${name.replace(/\s+/g, '')}">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
}

function stringsXml(name: string): string {
  return `<resources>\n    <string name="app_name">${name}</string>\n</resources>\n`;
}

function themesXml(name: string): string {
  const n = name.replace(/\s+/g, '');
  return `<resources>\n    <style name="Theme.${n}" parent="Theme.Material3.DayNight.NoActionBar">\n        <item name="colorPrimary">@color/purple_500</item>\n        <item name="colorPrimaryVariant">@color/purple_700</item>\n        <item name="colorOnPrimary">@color/white</item>\n    </style>\n</resources>\n`;
}

function mainActivityKt(pkg: string): string {
  return `package ${pkg}\n\nimport androidx.appcompat.app.AppCompatActivity\nimport android.os.Bundle\n\nclass MainActivity : AppCompatActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n        setContentView(R.layout.activity_main)\n    }\n}\n`;
}

function basicActivityKt(pkg: string): string {
  return `package ${pkg}\n\nimport androidx.appcompat.app.AppCompatActivity\nimport android.os.Bundle\nimport android.view.Menu\nimport android.view.MenuItem\nimport com.google.android.material.snackbar.Snackbar\nimport com.google.android.material.floatingactionbutton.FloatingActionButton\n\nclass MainActivity : AppCompatActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n        setContentView(R.layout.activity_main)\n        setSupportActionBar(findViewById(R.id.toolbar))\n        findViewById<FloatingActionButton>(R.id.fab).setOnClickListener { view ->\n            Snackbar.make(view, "Replace with your action", Snackbar.LENGTH_LONG).show()\n        }\n    }\n    override fun onCreateOptionsMenu(menu: Menu): Boolean {\n        menuInflater.inflate(R.menu.menu_main, menu); return true\n    }\n    override fun onOptionsItemSelected(item: MenuItem): Boolean {\n        return if (item.itemId == R.id.action_settings) true else super.onOptionsItemSelected(item)\n    }\n}\n`;
}

function mainActivityJava(pkg: string): string {
  return `package ${pkg};\n\nimport androidx.appcompat.app.AppCompatActivity;\nimport android.os.Bundle;\n\npublic class MainActivity extends AppCompatActivity {\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        setContentView(R.layout.activity_main);\n    }\n}\n`;
}

function basicActivityJava(pkg: string): string {
  return `package ${pkg};\n\nimport androidx.appcompat.app.AppCompatActivity;\nimport android.os.Bundle;\nimport android.view.Menu;\nimport android.view.MenuItem;\nimport com.google.android.material.floatingactionbutton.FloatingActionButton;\nimport com.google.android.material.snackbar.Snackbar;\n\npublic class MainActivity extends AppCompatActivity {\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        setContentView(R.layout.activity_main);\n        setSupportActionBar(findViewById(R.id.toolbar));\n        FloatingActionButton fab = findViewById(R.id.fab);\n        fab.setOnClickListener(view -> Snackbar.make(view, "Replace action", Snackbar.LENGTH_LONG).show());\n    }\n    @Override public boolean onCreateOptionsMenu(Menu menu) { getMenuInflater().inflate(R.menu.menu_main, menu); return true; }\n    @Override public boolean onOptionsItemSelected(MenuItem item) { return item.getItemId() == R.id.action_settings || super.onOptionsItemSelected(item); }\n}\n`;
}
