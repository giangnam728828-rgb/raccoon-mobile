#!/usr/bin/env python3
"""把设备操作插件（无障碍服务）装进 Capacitor 生成的 Android 工程。

CI 每次都会 `npx cap add android` 重新生成 android/ 目录，所以插件不能直接放进去，
必须在生成之后由这个脚本注入：

  1. 复制 RaccoonDevicePlugin.java 到 app 的包目录
  2. 复制 RaccoonA11yService.java 到 app 的包目录
  3. 在 MainActivity 里注册插件（必须写在 super.onCreate 之前）
  4. 在 AndroidManifest.xml 声明 AccessibilityService

可重复执行。
"""

import json, os, re, shutil, sys

def main():
    android_dir = sys.argv[1] if len(sys.argv) > 1 else "android"
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    cfg_path = os.path.join(root, "capacitor.config.json")
    with open(cfg_path, encoding="utf-8") as f:
        app_id = json.load(f)["appId"]

    pkg_dir = os.path.join(android_dir, "app/src/main/java", *app_id.split("."))
    if not os.path.isdir(pkg_dir):
        print(f"✗ 找不到包目录：{pkg_dir}")
        return 1

    # 1. 复制插件与 Service
    for name in ("RaccoonDevicePlugin.java", "RaccoonA11yService.java"):
        src = os.path.join(root, "android-ext", name)
        dst = os.path.join(pkg_dir, name)
        shutil.copyfile(src, dst)
        print(f"✓ {name} → {dst}")

    # 2. MainActivity 注册插件
    activity = os.path.join(pkg_dir, "MainActivity.java")
    with open(activity, encoding="utf-8") as f:
        code = f.read()

    if "registerPlugin(RaccoonDevicePlugin.class)" in code:
        print("✓ MainActivity 已注册设备插件，跳过")
    else:
        if "super.onCreate(" in code:
            code = code.replace(
                "super.onCreate(",
                "registerPlugin(RaccoonDevicePlugin.class);\n        super.onCreate(",
                1,
            )
        else:
            method = (
                "\n    @Override\n"
                "    public void onCreate(android.os.Bundle savedInstanceState) {\n"
                "        registerPlugin(RaccoonDevicePlugin.class);\n"
                "        super.onCreate(savedInstanceState);\n"
                "    }\n"
            )
            m = re.search(r"\s*public class MainActivity extends BridgeActivity\s*\{", code)
            if m:
                code = code[:m.end()] + "\n" + method + "\n" + code[m.end():]
            else:
                print("⚠ MainActivity 结构不匹配，未注入 onCreate 方法")
        with open(activity, "w", encoding="utf-8") as f:
            f.write(code)
        print("✓ MainActivity 已注册设备插件")

    # 3. AndroidManifest.xml：声明 AccessibilityService
    manifest = os.path.join(android_dir, "app/src/main/AndroidManifest.xml")
    if not os.path.isfile(manifest):
        print(f"✗ 找不到 Manifest：{manifest}")
        return 1
    with open(manifest, encoding="utf-8") as f:
        mtext = f.read()

    svc_name = f"{app_id}.RaccoonA11yService"
    pattern = r'<service[^>]+android:name="[^"]+RaccoonA11yService[^"]*"[^>]*/>'
    if re.search(pattern, mtext):
        print("✓ AndroidManifest 已有 RaccoonA11yService 声明，跳过")
    else:
        service_decl = f'''    <service
        android:name="{svc_name}"
        android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
        android:exported="true">
      <intent-filter>
        <action android:name="android.accessibilityservice.AccessibilityService" />
      </intent-filter>
      <meta-data
        android:name="android.accessibilityservice"
        android:resource="@xml/accessibility_service_config" />
    </service>'''
        mtext = re.sub(
            r'(</application>)',
            service_decl + '\n\\1',
            mtext,
            flags=re.IGNORECASE,
        )
        with open(manifest, "w", encoding="utf-8") as f:
            f.write(mtext)
        print("✓ AndroidManifest 已声明 RaccoonA11yService")

    # 4. res/xml/accessibility_service_config.xml
    xml_dir = os.path.join(android_dir, "app/src/main/res/xml")
    os.makedirs(xml_dir, exist_ok=True)
    xml_file = os.path.join(xml_dir, "accessibility_service_config.xml")
    config = '''<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/app_name"
    android:accessibilityEventTypes="typeAllMask"
    android:accessibilityFlags="flagDefault|flagIncludeNotImportantViews|flagReportViewIds|flagRetrieveInteractiveWindows"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:notificationTimeout="60"
    android:canPerformGestures="true"
    android:canRetrieveWindowContent="true"
    android:settingsActivity=".MainActivity" />
'''
    with open(xml_file, "w", encoding="utf-8") as f:
        f.write(config)
    print(f"✓ accessibility_service_config.xml → {xml_file}")

    print("\n✅ 设备操作插件注入完成")
    return 0

if __name__ == "__main__":
    sys.exit(main())
