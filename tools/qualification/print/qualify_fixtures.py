#!/usr/bin/env python3
"""Generate and probe bounded synthetic print-qualification fixtures.

This is deliberately an independent fixture probe. It does not claim to be
nova3D's general wall/clearance/relief validator or a physical print test.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = ROOT / "_bmad-output/implementation-artifacts/qualification-2026-09-14/print/fixtures"
STL_QUANTIZATION_EPS_MM = 1e-3


def box(extents: tuple[float, float, float], origin: tuple[float, float, float]) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=np.asarray(extents, dtype=float))
    mesh.apply_translation(np.asarray(origin, dtype=float) + np.asarray(extents, dtype=float) / 2.0)
    return mesh


def write_mesh(path: Path, mesh: trimesh.Trimesh) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(path, file_type="stl")


def write_fixture_set(out: Path) -> dict[str, dict[str, object]]:
    fixtures: dict[str, dict[str, object]] = {}

    positive = box((40, 40, 40), (0, 0, 0))
    write_mesh(out / "positive_envelope.stl", positive)
    fixtures["positive_envelope"] = {
        "file": "positive_envelope.stl",
        "expected": "pass",
        "analytic": {"bounds_mm": [40, 40, 40], "volume_mm3": 64000},
    }

    overbound = box((90.01, 20, 20), (0, 0, 0))
    write_mesh(out / "negative_bounds_90_01mm.stl", overbound)
    fixtures["negative_bounds_90_01mm"] = {
        "file": "negative_bounds_90_01mm.stl",
        "expected": "fail",
        "analytic": {"bounds_mm": [90.01, 20, 20]},
    }

    positive_threshold = trimesh.util.concatenate(
        [
            box((1.2, 8, 8), (2, 2, 0)),
            box((0.8, 0.8, 3), (6, 2, 0)),
            box((5, 5, 2), (10, 2, 0)),
            box((5, 5, 2), (15.4, 2, 0)),  # 0.4 mm mating gap
            box((0.6, 3, 1), (25, 2, 0)),
        ]
    )
    write_mesh(out / "positive_thresholds.stl", positive_threshold)
    threshold_layout = [
        {"label": "wall", "origin": [2, 2, 0], "extents": [1.2, 8, 8]},
        {"label": "isolated_feature", "origin": [6, 2, 0], "extents": [0.8, 0.8, 3]},
        {"label": "mating_a", "origin": [10, 2, 0], "extents": [5, 5, 2]},
        {"label": "mating_b", "origin": [15.4, 2, 0], "extents": [5, 5, 2]},
        {"label": "relief", "origin": [25, 2, 0], "extents": [0.6, 3, 1]},
    ]
    fixtures["positive_thresholds"] = {
        "file": "positive_thresholds.stl",
        "expected": "pass",
        "analytic": {
            "wall_mm": 1.2,
            "isolated_feature_mm": 0.8,
            "mating_clearance_mm": 0.4,
            "relief_mm": 0.6,
            "component_layout": threshold_layout,
        },
    }

    negative_threshold = trimesh.util.concatenate(
        [
            box((1.19, 8, 8), (2, 2, 0)),
            box((0.79, 0.79, 3), (6, 2, 0)),
            box((5, 5, 2), (10, 2, 0)),
            box((5, 5, 2), (15.39, 2, 0)),  # 0.39 mm mating gap
            box((0.59, 3, 1), (25, 2, 0)),
        ]
    )
    write_mesh(out / "negative_thresholds.stl", negative_threshold)
    negative_layout = [entry.copy() for entry in threshold_layout]
    negative_layout[1] = {**negative_layout[1], "extents": [0.79, 0.79, 3]}
    negative_layout[2] = {**negative_layout[2]}
    negative_layout[3] = {**negative_layout[3], "origin": [15.39, 2, 0]}
    negative_layout[4] = {**negative_layout[4], "extents": [0.59, 3, 1]}
    negative_layout[0] = {**negative_layout[0], "extents": [1.19, 8, 8]}
    fixtures["negative_thresholds"] = {
        "file": "negative_thresholds.stl",
        "expected": "fail",
        "analytic": {
            "wall_mm": 1.19,
            "isolated_feature_mm": 0.79,
            "mating_clearance_mm": 0.39,
            "relief_mm": 0.59,
            "component_layout": negative_layout,
        },
    }

    # Two watertight cubes retain coincident internal faces, creating edges
    # incident to four triangles: a deliberately non-manifold fixture.
    nonmanifold = trimesh.util.concatenate([box((10, 10, 10), (0, 0, 0)), box((10, 10, 10), (10, 0, 0))])
    write_mesh(out / "malformed_nonmanifold.stl", nonmanifold)
    fixtures["malformed_nonmanifold"] = {
        "file": "malformed_nonmanifold.stl",
        "expected": "fail",
        "analytic": {"reason": "coincident internal face / non-manifold shared boundary"},
    }

    zero_area = positive.copy()
    zero_area.vertices = np.vstack([zero_area.vertices, [[0, 0, 0]]])
    zero_area.faces = np.vstack([zero_area.faces, [[len(zero_area.vertices) - 1] * 3]])
    write_mesh(out / "malformed_zero_area_face.stl", zero_area)
    fixtures["malformed_zero_area_face"] = {
        "file": "malformed_zero_area_face.stl",
        "expected": "fail",
        "analytic": {"reason": "deliberate zero-area triangle", "mutation_of": "positive_envelope.stl"},
    }

    (out / "fixtures.json").write_text(json.dumps(fixtures, indent=2, sort_keys=True) + "\n")
    return fixtures


def check_mesh(path: Path) -> dict[str, object]:
    mesh = trimesh.load_mesh(path, file_type="stl", process=False)
    # STL repeats triangle vertices. Merge only exact duplicates while
    # retaining zero-area faces so malformed fixtures remain observable.
    mesh.merge_vertices()
    extents = mesh.bounds[1] - mesh.bounds[0]
    return {
        "file": path.name,
        "triangles": int(len(mesh.faces)),
        "vertices": int(len(mesh.vertices)),
        "bounds_mm": [round(float(x), 6) for x in extents],
        "volume_mm3": round(float(abs(mesh.volume)), 6),
        "finite": bool(np.isfinite(mesh.vertices).all()),
        "winding_consistent": bool(mesh.is_winding_consistent),
        "watertight": bool(mesh.is_watertight),
        "volume": bool(mesh.is_volume),
        "body_count": int(len(mesh.split(only_watertight=False))),
        "zero_area_faces": int(np.count_nonzero(mesh.area_faces <= 1e-12)),
    }


def analytic_gate(name: str, mesh: trimesh.Trimesh, spec: dict[str, object]) -> dict[str, object] | None:
    analytic = spec.get("analytic", {})
    if name == "positive_envelope" or name == "negative_bounds_90_01mm":
        observed = float(np.max(mesh.bounds[1] - mesh.bounds[0]))
        return {"max_bounds_mm": observed, "limit_mm": 90.0, "pass": observed <= 90.0 + STL_QUANTIZATION_EPS_MM}
    if name in {"positive_thresholds", "negative_thresholds"}:
        layout = analytic.get("component_layout", [])
        components = list(mesh.split(only_watertight=False))
        if len(components) != len(layout):
            return {"pass": False, "failure": "component count mismatch", "expected_count": len(layout), "observed_count": len(components)}
        matched: dict[str, trimesh.Trimesh] = {}
        for expected in layout:
            origin = np.asarray(expected["origin"], dtype=float)
            extents = np.asarray(expected["extents"], dtype=float)
            candidates = [
                component
                for component in components
                if np.allclose(component.bounds[0], origin, atol=STL_QUANTIZATION_EPS_MM)
                and np.allclose(component.bounds[1] - component.bounds[0], extents, atol=STL_QUANTIZATION_EPS_MM)
            ]
            if len(candidates) != 1:
                return {
                    "pass": False,
                    "failure": "component identity/shape not unique",
                    "label": expected["label"],
                    "candidate_count": len(candidates),
                }
            matched[str(expected["label"])] = candidates[0]
        observed = {
            "wall_mm": float(matched["wall"].bounds[1][0] - matched["wall"].bounds[0][0]),
            "isolated_feature_mm": float(np.min(matched["isolated_feature"].bounds[1] - matched["isolated_feature"].bounds[0])),
            "mating_clearance_mm": float(matched["mating_b"].bounds[0][0] - matched["mating_a"].bounds[1][0]),
            "relief_mm": float(matched["relief"].bounds[1][0] - matched["relief"].bounds[0][0]),
        }
        limits = {"wall_mm": 1.2, "isolated_feature_mm": 0.8, "mating_clearance_mm": 0.4, "relief_mm": 0.6}
        return {
            "observed": observed,
            "limits_mm": limits,
            "pass": all(observed[key] + STL_QUANTIZATION_EPS_MM >= limits[key] for key in limits),
        }
    if "reason" in analytic:
        return {"pass": None, "reason": "malformed fixture; analytic threshold gate not applicable"}
    return None


def compare(a: trimesh.Trimesh, b: trimesh.Trimesh) -> dict[str, float]:
    ab = a.bounds[1] - a.bounds[0]
    bb = b.bounds[1] - b.bounds[0]
    av = abs(float(a.volume))
    bv = abs(float(b.volume))
    return {
        "max_bounds_delta_mm": float(np.max(np.abs(ab - bb))),
        "relative_volume_delta": float(abs(av - bv) / av) if av else math.inf,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    out = args.out.resolve()
    fixtures = write_fixture_set(out)
    results: dict[str, object] = {"tool": {"numpy": np.__version__, "trimesh": trimesh.__version__}, "fixtures": {}}

    for name, spec in fixtures.items():
        mesh = trimesh.load_mesh(out / str(spec["file"]), file_type="stl", process=False)
        mesh.merge_vertices()
        result = check_mesh(out / str(spec["file"]))
        # General mesh gate used only for this fixture probe.
        result["mesh_gate"] = "pass" if result["finite"] and result["winding_consistent"] and result["watertight"] and result["zero_area_faces"] == 0 else "fail"
        result["analytic_gate"] = analytic_gate(name, mesh, spec)
        expected = str(spec["expected"])
        result["expected"] = expected
        analytic_pass = None if result["analytic_gate"] is None else result["analytic_gate"]["pass"]
        if expected == "pass":
            result["expected_match"] = result["mesh_gate"] == "pass" and analytic_pass is True
        elif name.startswith("malformed"):
            result["expected_match"] = result["mesh_gate"] == "fail"
        else:
            result["expected_match"] = result["mesh_gate"] == "pass" and analytic_pass is False
        results["fixtures"][name] = {"spec": spec, "observed": result}

    mutation_base = results["fixtures"]["positive_envelope"]["observed"]
    mutation = results["fixtures"]["malformed_zero_area_face"]["observed"]
    results["integrity_mutation"] = {
        "source": "positive_envelope.stl",
        "mutation": "append one zero-area triangle",
        "source_mesh_gate": mutation_base["mesh_gate"],
        "mutated_mesh_gate": mutation["mesh_gate"],
        "status": "pass" if mutation_base["mesh_gate"] == "pass" and mutation["mesh_gate"] == "fail" else "fail",
    }

    source = trimesh.load_mesh(out / "positive_envelope.stl", file_type="stl", process=False)
    source.merge_vertices()
    roundtrip_stl = out / "roundtrip_positive.stl"
    source.export(roundtrip_stl, file_type="stl")
    loaded_stl = trimesh.load_mesh(roundtrip_stl, file_type="stl", process=False)
    loaded_stl.merge_vertices()
    results["stl_roundtrip"] = compare(source, loaded_stl)
    results["stl_roundtrip"]["status"] = "pass" if results["stl_roundtrip"]["max_bounds_delta_mm"] <= 0.001 and results["stl_roundtrip"]["relative_volume_delta"] <= 0.001 else "fail"

    try:
        roundtrip_3mf = out / "roundtrip_positive.3mf"
        source.export(roundtrip_3mf, file_type="3mf")
        loaded_3mf = trimesh.load_mesh(roundtrip_3mf, file_type="3mf", process=False)
        loaded_3mf.merge_vertices()
        comparison = compare(source, loaded_3mf)
        results["3mf_roundtrip"] = {
            "status": "pass" if comparison["max_bounds_delta_mm"] <= 0.001 and comparison["relative_volume_delta"] <= 0.001 else "fail",
            "comparison": comparison,
        }
    except Exception as exc:  # bounded capability probe; do not install a replacement here
        results["3mf_roundtrip"] = {"status": "blocked", "error": f"{type(exc).__name__}: {exc}"}

    unexpected = [name for name, item in results["fixtures"].items() if not item["observed"]["expected_match"]]
    if results["integrity_mutation"]["status"] != "pass":
        unexpected.append("integrity_mutation")
    if results["stl_roundtrip"]["status"] != "pass":
        unexpected.append("stl_roundtrip")
    if results["3mf_roundtrip"].get("status") != "pass":
        unexpected.append("3mf_roundtrip")
    results["assertions"] = {"unexpected": unexpected, "status": "pass" if not unexpected else "fail"}
    (out / "probe-results.json").write_text(json.dumps(results, indent=2, sort_keys=True) + "\n")
    print(json.dumps(results, indent=2, sort_keys=True))
    return 0 if not unexpected else 2


if __name__ == "__main__":
    raise SystemExit(main())
