#!/usr/bin/env python3
"""把品牌图标装进 Capacitor 生成的 Android 工程。

CI 每次都 `npx cap add android` 重新生成 android/，所以图标不能直接提交，
必须在生成之后由这个脚本注入：

  1. 复制 assets/icons/mipmap-*/ 下的全密度图标到 res/
  2. 生成自适应图标（mipmap-anydpi-v26/ic_launcher.xml + ic_launcher_round.xml）
  3. 写入背景色（与图标纸白一致，避免系统图标底色突兀）
  4. 设置应用名

可重复执行。
"""

import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "icons")

# 自适应图标背景色：与插画纸白一致
ICON_BG = "#FAF1EE"

DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]


def copy_density_icons(res_dir):
    copied = 0
    for d in DENSITIES:
        src = os.path.join(SRC, f"mipmap-{d}")
        if not os.path.isdir(src):
            print(f"✗ 缺少 {src}")
            return 1
        dst = os.path.join(res_dir, f"mipmap-{d}")
        os.makedirs(dst, exist_ok=True)
        for name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
            s = os.path.join(src, name)
            if not os.path.exists(s):
                print(f"✗ 缺少图标 {s}")
                return 1
            shutil.copyfile(s, os.path.join(dst, name))
            copied += 1
    print(f"✓ 已复制 {copied} 个位图图标（{len(DENSITIES)} 个密度）")
    return 0


def write_adaptive_icons(res_dir):
    """API 26+ 用自适应图标：前景全出血 + 纯色背景，由系统套遮罩。"""
    anydpi = os.path.join(res_dir, "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)

    square = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""
    round_icon = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""
    for name, body in (("ic_launcher.xml", square), ("ic_launcher_round.xml", round_icon)):
        with open(os.path.join(anydpi, name), "w", encoding="utf-8") as f:
            f.write(body)
    print(f"✓ 已写入自适应图标（API 26+），背景 {ICON_BG}")
    return 0


def write_background_color(res_dir):
    """自适应图标的背景色。

    Capacitor 模板里已经有 res/values/ic_launcher_background.xml，
    再往 colors.xml 加一份同名 <color> 会让 aapt 报 Duplicate resources。
    所以优先就地改写那个文件；不存在时才新建。
    """
    values = os.path.join(res_dir, "values")
    os.makedirs(values, exist_ok=True)
    entry = f'    <color name="ic_launcher_background">{ICON_BG}</color>'

    dedicated = os.path.join(values, "ic_launcher_background.xml")
    colors = os.path.join(values, "colors.xml")

    target = dedicated if os.path.exists(dedicated) else colors

    if os.path.exists(target):
        with open(target, encoding="utf-8") as f:
            text = f.read()
        if 'name="ic_launcher_background"' in text:
            text = re.sub(
                r'<color name="ic_launcher_background">[^<]*</color>', entry.strip(), text
            )
        elif "</resources>" in text:
            text = text.replace("</resources>", entry + "\n</resources>")
        else:
            text = (
                '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                + entry
                + "\n</resources>\n"
            )
    else:
        text = (
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            + entry
            + "\n</resources>\n"
        )

    with open(target, "w", encoding="utf-8") as f:
        f.write(text)

    # 若两个文件都存在且都定义了同名颜色，清掉 colors.xml 里那份
    if os.path.exists(dedicated) and os.path.exists(colors) and dedicated != colors:
        with open(colors, encoding="utf-8") as f:
            ctext = f.read()
        if 'name="ic_launcher_background"' in ctext:
            ctext = re.sub(
                r'\s*<color name="ic_launcher_background">[^<]*</color>', '', ctext
            )
            with open(colors, "w", encoding="utf-8") as f:
                f.write(ctext)
            print("  （已清理 colors.xml 中重复的同名颜色）")

    print(f"✓ 已写入 ic_launcher_background = {ICON_BG} → {os.path.basename(target)}")
    return 0


def write_app_name(res_dir):
    values = os.path.join(res_dir, "values")
    strings = os.path.join(values, "strings.xml")
    name = "小浣熊"
    if os.path.exists(strings):
        with open(strings, encoding="utf-8") as f:
            text = f.read()
        if 'name="app_name"' in text:
            text = re.sub(
                r'<string name="app_name">[^<]*</string>',
                f'<string name="app_name">{name}</string>',
                text,
            )
        else:
            text = text.replace("</resources>", f'    <string name="app_name">{name}</string>\n</resources>')
        with open(strings, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        with open(strings, "w", encoding="utf-8") as f:
            f.write(
                '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                f'    <string name="app_name">{name}</string>\n</resources>\n'
            )
    print(f"✓ 应用名 = {name}")
    return 0


def main():
    android_dir = sys.argv[1] if len(sys.argv) > 1 else "android"
    res_dir = os.path.join(android_dir, "app", "src", "main", "res")

    if not os.path.isdir(res_dir):
        print(f"✗ 找不到 res 目录: {res_dir}")
        return 1

    for step in (copy_density_icons, write_adaptive_icons, write_background_color, write_app_name):
        code = step(res_dir)
        if code:
            return code

    print("✓ 图标注入完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
