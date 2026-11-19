#!/usr/bin/env python3
"""把 CI 的运行序号写进 versionCode / versionName，保证每次构建都能覆盖安装。

用法： python3 scripts/set-version.py <run_number> [build.gradle 路径]
"""
import pathlib
import re
import sys

run_number = sys.argv[1] if len(sys.argv) > 1 else "1"
target = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "android/app/build.gradle")

if not target.exists():
    print(f"[set-version] 找不到 {target}", file=sys.stderr)
    sys.exit(1)

src = target.read_text(encoding="utf-8")

try:
    vc = int(run_number)
except ValueError:
    vc = 1

new = re.sub(r"versionCode\s+\d+", f"versionCode {vc}", src, count=1)
new = re.sub(r'versionName\s+"[^"]*"', f'versionName "1.2.{vc}"', new, count=1)

if new != src:
    target.write_text(new, encoding="utf-8")

shown = [line.strip() for line in new.splitlines() if "version" in line.lower()]
print("[set-version] " + " | ".join(shown[:4]))

if f"versionCode {vc}" not in new:
    print("[set-version] 警告: versionCode 未按预期更新", file=sys.stderr)
