#!/usr/bin/env python3
"""生成密码学安全的随机字符串（可用于 JWT_SECRET 等）。

用法:
  python3 gen-random.py            # 默认 32 位
  python3 gen-random.py 64         # 指定位数
  python3 gen-random.py 20 --hex  # 十六进制（openssl rand -hex 风格）
"""
import argparse
import secrets
import string

# 去掉易混淆字符（0O1lIi）的可读字符集，避免人工抄录出错
SAFE_CHARS = "".join(c for c in string.ascii_letters + string.digits if c not in "0O1lIi")


def main() -> None:
    parser = argparse.ArgumentParser(description="生成密码学安全的随机字符串")
    parser.add_argument("length", nargs="?", type=int, default=32, help="位数（默认 32）")
    parser.add_argument("--hex", action="store_true", help="只使用十六进制字符 0-9a-f")
    args = parser.parse_args()

    if args.length < 1:
        parser.error("位数必须 ≥ 1")

    pool = string.hexdigits[:16] if args.hex else SAFE_CHARS
    print("".join(secrets.choice(pool) for _ in range(args.length)))


if __name__ == "__main__":
    main()
