#!/usr/bin/env python3
"""把文件读写插件装进 Capacitor 生成的 Android 工程。

CI 每次都会 `npx cap add android` 重新生成 android/ 目录，所以插件不能直接放进去，
必须在生成之后由这个脚本注入：

  1. 复制 android-ext/RaccoonFilePlugin.java 到 app 的包目录
  2. 在 MainActivity 里注册插件（必须写在 super.onCreate 之前）

本插件不使用外部存储权限，沙箱目录基于 getFilesDir() + Documents/Raccoon，文件选择用 SAF，
所以无需修改 AndroidManifest.xml。

可重复执行。
"""

import json
import os
import re
import shutil
import sys


def main():
    android_dir = sys.argv[1] if len(sys.argv) > 1 else "android"
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    cfg_path = os.path.join(root, "capacitor.config.json")
    with open(cfg_path, encoding="utf-8") as f:
        app_id = json.load(f)["appId"]

    pkg_dir = os.path.join(android_dir, "app/src/main/java", *app_id.split("."))
    if not os.path.isdir(pkg_dir):
        print(f"✗ 找不到包目录: {pkg_dir}")
        return 1

    # 1. 复制插件源码
    src = os.path.join(root, "android-ext/RaccoonFilePlugin.java")
    dst = os.path.join(pkg_dir, "RaccoonFilePlugin.java")
    shutil.copyfile(src, dst)
    print(f"✓ 插件已复制 → {dst}")

    # 2. MainActivity 注册插件（在 super.onCreate 之前）
    activity = os.path.join(pkg_dir, "MainActivity.java")
    with open(activity, encoding="utf-8") as f:
        code = f.read()

    if "registerPlugin(RaccoonFilePlugin.class)" in code:
        print("✓ MainActivity 已注册文件插件，跳过")
        return 0

    if "super.onCreate(" in code:
        code = code.replace(
            "super.onCreate(",
            "registerPlugin(RaccoonFilePlugin.class);\n        super.onCreate(",
            1,
        )
    else:
        method = (
            "\n    @Override\n"
            "    public void onCreate(android.os.Bundle savedInstanceState) {\n"
            "        registerPlugin(RaccoonFilePlugin.class);\n"
            "        super.onCreate(savedInstanceState);\n"
            "    }\n"
        )
        m = re.search(r"(public class MainActivity extends BridgeActivity\s*)\{\s*\}", code)
        if m:
            code = code[: m.start()] + m.group(1) + "{" + method + "}" + code[m.end():]
        else:
            code = re.sub(
                r"(public class MainActivity extends BridgeActivity\s*\{)",
                r"\1" + method,
                code,
                count=1,
            )

    if "RaccoonFilePlugin" not in code:
        print("✗ MainActivity 注入失败，请检查模板结构")
        return 1

    with open(activity, "w", encoding="utf-8") as f:
        f.write(code)
    print("✓ MainActivity 已注册 RaccoonFilePlugin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
