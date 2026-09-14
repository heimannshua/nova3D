#!/usr/bin/env python3
"""Flatten the pinned Bambu process inheritance for an isolated CLI probe."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-root", type=Path, required=True, help="BBL/process profile directory")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    profiles = {}
    for path in args.profile_root.glob("*.json"):
        profile = json.loads(path.read_text())
        if profile.get("name"):
            profiles[profile["name"]] = profile

    chain = []
    name = "0.20mm Standard @BBL A1M"
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
    flattened.update(
        {
            "name": "nova3D R-3 effective process override",
            "from": "user",
            "instantiation": "true",
            "layer_height": "0.2",
            "wall_loops": "3",
        }
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(flattened, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"chain": [p["name"] for p in chain], "layer_height": flattened["layer_height"], "wall_loops": flattened["wall_loops"], "keys": len(flattened)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
