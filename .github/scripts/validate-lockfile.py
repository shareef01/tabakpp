#!/usr/bin/env python3
"""
Validate that webApp/package-lock.json does not contain platform-specific
libc metadata that is incompatible with the npm audit endpoint.

npm 11.11.0+ on Linux writes `libc` fields for platform-specific optional
dependencies (e.g. @rollup/rollup-linux-*). The npm audit quick endpoint
rejects dependency trees containing these fields with HTTP 400 "Invalid
package tree". npm 10.9.8 (the canonical version) does not write `libc`
fields, so their presence indicates the lockfile was regenerated with an
incompatible npm version.
"""

import json
import sys
from pathlib import Path


def check(path: Path) -> int:
    """Return number of packages with `libc` metadata fields."""
    with open(path, "rb") as f:
        lock = json.load(f)

    offenders = []
    for key, pkg in lock.get("packages", {}).items():
        if isinstance(pkg, dict) and "libc" in pkg:
            offenders.append((key, pkg["libc"]))

    if offenders:
        print("FAIL: package-lock.json contains `libc` metadata fields")
        print("      (indicates regeneration with npm >= 11.11.0 on Linux)")
        for key, libc in offenders:
            print(f"  {key}: libc={libc}")
        return 1

    print("OK: no libc metadata in package-lock.json")
    return 0


if __name__ == "__main__":
    lockfile = Path(__file__).resolve().parents[2] / "webApp" / "package-lock.json"
    sys.exit(check(lockfile))
