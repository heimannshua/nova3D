#!/usr/bin/env python3
"""Flatten one pinned Bambu machine or filament inheritance chain for CLI use."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-root", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    profiles = {}
    for path in args.profile_root.glob("*.json"):
        profile = json.loads(path.read_text())
        if profile.get("name"):
            profiles[profile["name"]] = profile

    chain = []
    name = args.name
    while name:
        if name not in profiles:
            raise SystemExit(f"missing inherited profile: {name}")
        profile = profiles[name]
        chain.append(profile)
        name = profile.get("inherits")

    flattened = {}
    for profile in reversed(chain):
        flattened.update(profile)
    flattened.pop("inherits", None)
    # Preserve the target profile identity, source classification, and
    # compatibility selectors while making the file self-contained.
    flattened["name"] = args.name

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(flattened, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"chain": [p["name"] for p in chain], "keys": len(flattened), "name": args.name}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
