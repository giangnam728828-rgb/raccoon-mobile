#!/usr/bin/env python3
"""在 Capacitor 生成的 android/app/build.gradle 中注入固定签名配置。

用法： python3 scripts/inject-signing.py [build.gradle 路径]

签名材料不写进仓库：storeFile 是 CI 里现解码出来的 jks，
密码全部从环境变量（KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD）读取。
"""
import pathlib
import re
import sys

TARGET = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "android/app/build.gradle")
KEYSTORE_NAME = "raccoon-release.jks"

SIGNING_BLOCK = f"""    signingConfigs {{
        release {{
            storeFile file("{KEYSTORE_NAME}")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }}
    }}

"""


def fail(msg):
    print("[inject-signing] 失败: " + msg, file=sys.stderr)
    sys.exit(1)


if not TARGET.exists():
    fail(f"找不到 {TARGET}")

src = TARGET.read_text(encoding="utf-8")
orig = src

# 1) 插入 signingConfigs 块（放在 buildTypes 之前）
if "signingConfigs" not in src:
    anchor = src.find("    buildTypes {")
    if anchor < 0:
        anchor = src.find("buildTypes {")
    if anchor < 0:
        fail("build.gradle 里找不到 buildTypes 块")
    src = src[:anchor] + SIGNING_BLOCK + src[anchor:]
    print("[inject-signing] 已插入 signingConfigs.release")
else:
    print("[inject-signing] signingConfigs 已存在，跳过插入")

# 2) 让 release buildType 使用它
if "signingConfig signingConfigs.release" not in src:
    m = re.search(r"buildTypes\s*\{[\s\S]*?release\s*\{", src)
    if not m:
        fail("找不到 buildTypes.release 块")
    src = src[: m.end()] + "\n            signingConfig signingConfigs.release" + src[m.end():]
    print("[inject-signing] 已为 release 绑定 signingConfig")
else:
    print("[inject-signing] release 已绑定签名，跳过")

if src != orig:
    TARGET.write_text(src, encoding="utf-8")

# 3) 校验
final = TARGET.read_text(encoding="utf-8")
checks = {
    "signingConfigs 块": "signingConfigs {" in final,
    "release 签名引用": "signingConfig signingConfigs.release" in final,
    "keystore 路径": KEYSTORE_NAME in final,
    "密码取自环境变量": 'System.getenv("KEYSTORE_PASSWORD")' in final,
}
ok = True
for name, passed in checks.items():
    print(f"  [{'OK' if passed else 'X '}] {name}")
    ok = ok and passed
if not ok:
    fail("注入结果校验未通过")
print("[inject-signing] 完成")
