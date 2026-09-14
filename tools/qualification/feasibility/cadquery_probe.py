#!/usr/bin/env python3
"""Bounded CadQuery 2.8.0 qualification probe for the synthetic altar/ramp fixture.

This intentionally proves only native-solid generation, local parameter correction,
round-trip serialization, and coarse equivalence signals. It does not implement or
claim the ratified surface-distance comparator.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import time
from typing import Any

import cadquery as cq


SCHEMA_VERSION = "cadquery-qualification-1.0.0"
FIXTURE_ID = "synthetic-middot-altar-ramp-v1"
DEFAULT_PARAMS: dict[str, float] = {
    "base_length": 80.0,
    "base_width": 50.0,
    "base_height": 6.0,
    "lower_step_length": 55.0,
    "lower_step_width": 38.0,
    "lower_step_height": 8.0,
    "upper_step_length": 35.0,
    "upper_step_width": 28.0,
    "upper_step_height": 8.0,
    "ramp_length": 30.0,
    "ramp_width": 30.0,
    "ramp_height": 16.0,
    "personalization_length": 8.0,
    "personalization_width": 8.0,
    "personalization_thickness": 2.0,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def shape_metrics(shape: cq.Shape) -> dict[str, Any]:
    box = shape.BoundingBox()
    solids = shape.Solids()
    return {
        "shape_type": shape.ShapeType(),
        "valid": bool(shape.isValid()),
        "volume_mm3": round(float(shape.Volume()), 9),
        "bbox_mm": {
            "length": round(float(box.xlen), 9),
            "width": round(float(box.ylen), 9),
            "height": round(float(box.zlen), 9),
            "xmin": round(float(box.xmin), 9),
            "ymin": round(float(box.ymin), 9),
            "zmin": round(float(box.zmin), 9),
            "xmax": round(float(box.xmax), 9),
            "ymax": round(float(box.ymax), 9),
            "zmax": round(float(box.zmax), 9),
        },
        "solids": len(solids),
        "faces": len(shape.Faces()),
        "edges": len(shape.Edges()),
        "vertices": len(shape.Vertices()),
    }


def feature_metrics(shape: cq.Shape) -> dict[str, Any]:
    metrics = shape_metrics(shape)
    return {
        "shape_type": metrics["shape_type"],
        "volume_mm3": metrics["volume_mm3"],
        "bbox_mm": {
            key: metrics["bbox_mm"][key]
            for key in ("length", "width", "height", "xmin", "ymin", "zmin", "xmax", "ymax", "zmax")
        },
        "valid": metrics["valid"],
        "solids": metrics["solids"],
        "faces": metrics["faces"],
        "edges": metrics["edges"],
        "vertices": metrics["vertices"],
    }


def build_fixture(params: dict[str, float], *, hole: bool = False) -> tuple[cq.Shape, dict[str, cq.Shape], dict[str, Any]]:
    """Build deterministic mm/Z-up solids and return stable semantic feature labels."""
    base = cq.Workplane("XY").box(
        params["base_length"], params["base_width"], params["base_height"], centered=(False, False, False)
    )
    lower = cq.Workplane("XY").box(
        params["lower_step_length"], params["lower_step_width"], params["lower_step_height"], centered=(False, False, False)
    ).translate((10.0, 6.0, params["base_height"]))
    upper = cq.Workplane("XY").box(
        params["upper_step_length"], params["upper_step_width"], params["upper_step_height"], centered=(False, False, False)
    ).translate((20.0, 11.0, params["base_height"] + params["lower_step_height"]))
    ramp = (
        cq.Workplane("XZ")
        .polyline([(0.0, 0.0), (params["ramp_length"], 0.0), (params["ramp_length"], params["ramp_height"])])
        .close()
        .extrude(params["ramp_width"])
        .translate((45.0, 40.0, params["base_height"]))
    )
    personalization = cq.Workplane("XY").box(
        params["personalization_length"],
        params["personalization_width"],
        params["personalization_thickness"],
        centered=(False, False, False),
    ).translate((12.0, 8.0, params["base_height"] + params["lower_step_height"]))

    features: dict[str, cq.Shape] = {
        "altar.base": base.val(),
        "altar.lower_step": lower.val(),
        "altar.upper_step": upper.val(),
        "altar.ramp": ramp.val(),
        "personalization.user_added_plaque": personalization.val(),
    }
    final = base.union(lower).union(upper).union(ramp).union(personalization).clean().val()
    if hole:
        cutter = cq.Workplane("XY").circle(3.0).extrude(40.0).translate((40.0, 25.0, -5.0))
        final = cq.Workplane(obj=final).cut(cutter).clean().val()

    recipe = {
        "fixture_id": FIXTURE_ID,
        "synthetic": True,
        "historical_geometry_approved": False,
        "units": "mm",
        "coordinate_system": "right-handed Z-up",
        "operation_graph": [
            {"id": "altar.base", "operation": "box", "depends_on": []},
            {"id": "altar.lower_step", "operation": "translated_box", "depends_on": ["altar.base"]},
            {"id": "altar.upper_step", "operation": "translated_box", "depends_on": ["altar.lower_step"]},
            {"id": "altar.ramp", "operation": "extruded_triangle", "depends_on": ["altar.base"]},
            {"id": "personalization.user_added_plaque", "operation": "translated_box", "depends_on": ["altar.lower_step"], "status": "user_added"},
            {"id": "fixture.union", "operation": "boolean_union_clean", "depends_on": list(features)},
        ],
        "parameters": {key: float(value) for key, value in params.items()},
        "hole_case": bool(hole),
    }
    return final, features, recipe


def validate_params(params: dict[str, float]) -> list[str]:
    errors: list[str] = []
    for key, value in params.items():
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            errors.append(f"parameter_not_numeric:{key}")
            continue
        if not math.isfinite(numeric):
            errors.append(f"parameter_not_finite:{key}")
        elif numeric <= 0:
            errors.append(f"parameter_not_positive:{key}")
    if errors:
        return errors
    if params["base_length"] > 90.0 or params["base_width"] > 90.0:
        errors.append("envelope_xy_gt_90mm")
    if params["base_height"] + params["lower_step_height"] + params["upper_step_height"] > 90.0:
        errors.append("envelope_z_gt_90mm")
    if params["personalization_length"] < 0.8 or params["personalization_width"] < 0.8 or params["personalization_thickness"] < 0.8:
        errors.append("isolated_feature_lt_0.8mm")
    return errors


def build_checked(params: dict[str, float], *, hole: bool = False) -> tuple[cq.Shape, dict[str, cq.Shape], dict[str, Any]]:
    errors = validate_params(params)
    if errors:
        raise ValueError("fixture parameter rejection: " + ", ".join(errors))
    shape, features, recipe = build_fixture(params, hole=hole)
    metrics = shape_metrics(shape)
    bounds = metrics["bbox_mm"]
    if not metrics["valid"] or metrics["solids"] != 1:
        raise ValueError("fixture geometry rejection: expected one valid solid")
    if (not all(math.isfinite(value) for value in bounds.values())
            or any(bounds[axis] > 90.0 for axis in ("length", "width", "height"))):
        raise ValueError("fixture geometry rejection: generated envelope exceeds 90mm")
    return shape, features, recipe


def compare_coarse(reference: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    bbox_ref = reference["bbox_mm"]
    bbox_cand = candidate["bbox_mm"]
    bounds_delta = max(
        abs(bbox_ref[key] - bbox_cand[key])
        for key in ("length", "width", "height", "xmin", "ymin", "zmin", "xmax", "ymax", "zmax")
    )
    volume_delta = abs(reference["volume_mm3"] - candidate["volume_mm3"])
    volume_denominator = abs(reference["volume_mm3"])
    relative_volume = volume_delta / volume_denominator if volume_denominator else None
    return {
        "component_count_equal": reference["solids"] == candidate["solids"],
        "closed_valid_equal": reference["valid"] and candidate["valid"],
        "topology_counts_equal": all(reference[key] == candidate[key] for key in ("faces", "edges", "vertices")),
        "bounds_delta_mm": round(bounds_delta, 9),
        "relative_volume_delta": round(relative_volume, 12) if relative_volume is not None else None,
        "ratified_bounds_limit_mm": 0.01,
        "ratified_relative_volume_limit": 0.001,
        "surface_distance_comparator": "NOT_RUN; bbox/volume are not a certified surface-distance proof",
    }


def feature_placement_checks(feature_metrics_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    expected = {
        "altar.base": {"xmin": 0.0, "ymin": 0.0, "zmin": 0.0, "xmax": 80.0, "ymax": 50.0, "zmax": 6.0},
        "altar.lower_step": {"xmin": 10.0, "ymin": 6.0, "zmin": 6.0, "xmax": 65.0, "ymax": 44.0, "zmax": 14.0},
        "altar.upper_step": {"xmin": 20.0, "ymin": 11.0, "zmin": 14.0, "xmax": 55.0, "ymax": 39.0, "zmax": 22.0},
        "altar.ramp": {"xmin": 45.0, "ymin": 10.0, "zmin": 6.0, "xmax": 75.0, "ymax": 40.0, "zmax": 22.0},
        "personalization.user_added_plaque": {"xmin": 12.0, "ymin": 8.0, "zmin": 14.0, "xmax": 20.0, "ymax": 16.0, "zmax": 16.0},
    }
    checks: dict[str, Any] = {}
    for feature_id, expected_bbox in expected.items():
        actual_bbox = feature_metrics_by_id[feature_id]["bbox_mm"]
        delta = max(abs(actual_bbox[key] - expected_bbox[key]) for key in expected_bbox)
        checks[feature_id] = {"expected_bbox_mm": expected_bbox, "actual_bbox_mm": actual_bbox, "max_delta_mm": delta, "pass": delta <= 0.000001}
    return checks


def rejected_parameter_case(params: dict[str, float]) -> dict[str, Any]:
    validation_errors = validate_params(params)
    try:
        build_checked(params)
    except ValueError as error:
        return {"expected": "PARAMETER_REJECTION", "status": "PASS", "validation_errors": validation_errors, "exception": str(error)}
    return {"expected": "PARAMETER_REJECTION", "status": "FAIL", "validation_errors": validation_errors, "exception": None}


def run_cancel_demo(work_dir: Path) -> dict[str, Any]:
    readiness_budget_ms = 1500
    cancellation_budget_ms = 750
    total_budget_ms = readiness_budget_ms + cancellation_budget_ms
    ready_path = work_dir / "cancel-ready.marker"
    ready_path.unlink(missing_ok=True)
    child = subprocess.Popen(
        [sys.executable, __file__, "--slow-worker", "--ready-file", str(ready_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    started = time.monotonic()
    ready = False
    while time.monotonic() - started < readiness_budget_ms / 1000.0:
        if ready_path.exists():
            ready = True
            break
        if child.poll() is not None:
            break
        time.sleep(0.01)
    startup_wait_ms = round((time.monotonic() - started) * 1000.0, 3)
    child_alive_before_signal = child.poll() is None
    signal_sent = time.monotonic()
    if child_alive_before_signal:
        child.terminate()
    try:
        child.wait(timeout=cancellation_budget_ms / 1000.0)
        forced = False
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=cancellation_budget_ms / 1000.0)
        forced = True
    cancellation_latency_ms = round((time.monotonic() - signal_sent) * 1000.0, 3)
    elapsed_ms = round((time.monotonic() - started) * 1000.0, 3)
    stdout, stderr = child.communicate()
    ready_path.unlink(missing_ok=True)
    return {
        "status": "PASS" if ready and child_alive_before_signal and child.returncode == -signal.SIGTERM and not forced and cancellation_latency_ms <= cancellation_budget_ms and elapsed_ms <= total_budget_ms else "FAIL",
        "ready_after_first_geometry": ready,
        "child_alive_before_signal": child_alive_before_signal,
        "signal_sent": "SIGTERM" if child_alive_before_signal else None,
        "return_code": child.returncode,
        "forced_kill": forced,
        "startup_wait_ms": startup_wait_ms,
        "readiness_budget_ms": readiness_budget_ms,
        "cancellation_latency_ms": cancellation_latency_ms,
        "cancellation_budget_ms": cancellation_budget_ms,
        "elapsed_ms": elapsed_ms,
        "total_budget_ms": total_budget_ms,
        "stdout_tail": stdout[-300:],
        "stderr_tail": stderr[-300:],
    }


def slow_worker(ready_file: Path | None = None) -> int:
    build_fixture(DEFAULT_PARAMS)
    if ready_file is not None:
        ready_file.write_text("first_geometry_completed\n")
    for _ in range(10000):
        build_fixture(DEFAULT_PARAMS)
    return 0


def run_probe(output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    export_dir = output_dir / "exports"
    export_dir.mkdir(exist_ok=True)
    temp_dir = output_dir / "tmp_roundtrip"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir()

    generation: list[dict[str, Any]] = []
    for index in range(3):
        final, features, recipe = build_checked(DEFAULT_PARAMS)
        metrics = shape_metrics(final)
        generation.append({
            "iteration": index + 1,
            "metrics": metrics,
            "feature_ids": list(features),
            "feature_metrics": {key: feature_metrics(value) for key, value in features.items()},
            "recipe_digest": hashlib.sha256(json.dumps(recipe, sort_keys=True).encode()).hexdigest(),
        })
    generation[0]["feature_placement_checks"] = feature_placement_checks(generation[0]["feature_metrics"])

    reference = generation[0]["metrics"]
    repeated = []
    for item in generation[1:]:
        feature_comparisons = {
            feature_id: compare_coarse(generation[0]["feature_metrics"][feature_id], item["feature_metrics"][feature_id])
            for feature_id in generation[0]["feature_metrics"]
        }
        repeated.append({
            **compare_coarse(reference, item["metrics"]),
            "recipe_digest_equal": item["recipe_digest"] == generation[0]["recipe_digest"],
            "feature_metrics_equal": all(
                comparison["closed_valid_equal"]
                and comparison["component_count_equal"]
                and comparison["topology_counts_equal"]
                and comparison["bounds_delta_mm"] <= 0.01
                and comparison["relative_volume_delta"] is not None
                and comparison["relative_volume_delta"] <= 0.001
                for comparison in feature_comparisons.values()
            ),
            "feature_comparisons": feature_comparisons,
        })
    repeated_pass = all(
        item["recipe_digest_equal"]
        and item["feature_metrics_equal"]
        and item["component_count_equal"]
        and item["closed_valid_equal"]
        and item["topology_counts_equal"]
        and item["bounds_delta_mm"] <= 0.01
        and (item["relative_volume_delta"] is not None and item["relative_volume_delta"] <= 0.001)
        for item in repeated
    )

    final, features, recipe = build_checked(DEFAULT_PARAMS)
    step_path = export_dir / "synthetic-altar-ramp.step"
    brep_path = export_dir / "synthetic-altar-ramp.brep"
    cq.exporters.export(cq.Workplane(obj=final), str(step_path), cq.exporters.ExportTypes.STEP)
    cq.exporters.export(cq.Workplane(obj=final), str(brep_path), cq.exporters.ExportTypes.BREP)

    step_copy = temp_dir / step_path.name
    brep_copy = temp_dir / brep_path.name
    shutil.copy2(step_path, step_copy)
    shutil.copy2(brep_path, brep_copy)
    step_restored = cq.importers.importStep(str(step_copy)).val()
    brep_restored = cq.importers.importBrep(str(brep_copy)).val()
    restore = {
        "step": compare_coarse(reference, shape_metrics(step_restored)),
        "brep": compare_coarse(reference, shape_metrics(brep_restored)),
        "step_sha256": sha256(step_path),
        "brep_sha256": sha256(brep_path),
        "step_bytes": step_path.stat().st_size,
        "brep_bytes": brep_path.stat().st_size,
    }
    shutil.rmtree(temp_dir)
    roundtrip_temp_removed = not temp_dir.exists()

    corrected_params = dict(DEFAULT_PARAMS)
    corrected_params["upper_step_height"] = 10.0
    corrected, corrected_features, corrected_recipe = build_checked(corrected_params)
    corrected_metrics = shape_metrics(corrected)
    unchanged = {
        key: compare_coarse(feature_metrics(features[key]), feature_metrics(corrected_features[key]))
        for key in ("altar.base", "altar.lower_step", "altar.ramp", "personalization.user_added_plaque")
    }
    affected = compare_coarse(feature_metrics(features["altar.upper_step"]), feature_metrics(corrected_features["altar.upper_step"]))
    expected_volume_delta = DEFAULT_PARAMS["upper_step_length"] * DEFAULT_PARAMS["upper_step_width"] * (corrected_params["upper_step_height"] - DEFAULT_PARAMS["upper_step_height"])
    observed_volume_delta = corrected_metrics["volume_mm3"] - reference["volume_mm3"]
    corrected_final_union = {
        "valid": corrected_metrics["valid"],
        "component_count": corrected_metrics["solids"],
        "topology": {key: corrected_metrics[key] for key in ("faces", "edges", "vertices")},
        "expected_volume_delta_mm3": expected_volume_delta,
        "observed_volume_delta_mm3": observed_volume_delta,
        "volume_delta_match": abs(observed_volume_delta - expected_volume_delta) <= 0.000001,
    }

    negative_cases: dict[str, Any] = {}
    dimensional = dict(DEFAULT_PARAMS)
    dimensional["base_length"] = 95.0
    negative_cases["dimensional_parameter_rejection"] = rejected_parameter_case(dimensional)
    thin = dict(DEFAULT_PARAMS)
    thin["personalization_thickness"] = 0.4
    negative_cases["thin_feature_parameter_rejection"] = rejected_parameter_case(thin)
    scaled = {key: value * 2.0 for key, value in DEFAULT_PARAMS.items()}
    negative_cases["scale_parameter_rejection"] = rejected_parameter_case(scaled)
    unit_changed = {key: value * 25.4 for key, value in DEFAULT_PARAMS.items()}
    negative_cases["unit_interpretation_parameter_rejection"] = {**rejected_parameter_case(unit_changed), "declared_units": "mm", "input_interpretation": "inch values incorrectly treated as mm; no normalization claim"}
    nan_params = dict(DEFAULT_PARAMS)
    nan_params["ramp_height"] = float("nan")
    negative_cases["nan_parameter_rejection"] = rejected_parameter_case(nan_params)
    infinity_params = dict(DEFAULT_PARAMS)
    infinity_params["ramp_height"] = float("inf")
    negative_cases["infinity_parameter_rejection"] = rejected_parameter_case(infinity_params)
    for name, parameter, value in (("translated_ramp", "ramp_length", 50.0),
                                   ("translated_plaque", "personalization_length", 85.0)):
        params = dict(DEFAULT_PARAMS)
        params[parameter] = value
        case = rejected_parameter_case(params)
        case["expected"] = "GENERATED_ENVELOPE_REJECTION"
        case["status"] = "PASS" if not case["validation_errors"] and "generated envelope" in (case["exception"] or "") else "FAIL"
        negative_cases[name + "_geometry_rejection"] = case
    hole_shape, _, _ = build_checked(DEFAULT_PARAMS, hole=True)
    negative_cases["hole_coarse_mismatch"] = {
        "expected": "COARSE_MISMATCH",
        "comparison": compare_coarse(reference, shape_metrics(hole_shape)),
    }

    cancel = run_cancel_demo(output_dir)
    statuses = {
        "generation": "PASS" if all(item["metrics"]["valid"] and item["metrics"]["solids"] == 1 for item in generation) else "FAIL",
        "repeat_equivalence_coarse": "PASS" if repeated_pass else "FAIL",
        "feature_placement": "PASS" if all(item["pass"] for item in generation[0]["feature_placement_checks"].values()) else "FAIL",
        "serialization_restore_coarse": "PASS" if all(
            restore[k]["closed_valid_equal"] and restore[k]["component_count_equal"] and restore[k]["topology_counts_equal"] and restore[k]["bounds_delta_mm"] <= 0.01 and restore[k]["relative_volume_delta"] <= 0.001
            for k in ("step", "brep")
        ) else "FAIL",
        "correction_unchanged_feature_invariance": "PASS" if all(
            value["closed_valid_equal"] and value["component_count_equal"] and value["topology_counts_equal"] and value["bounds_delta_mm"] <= 0.01 and value["relative_volume_delta"] <= 0.001 for value in unchanged.values()
        ) else "FAIL",
        "correction_affected_feature_changes": "PASS" if affected["bounds_delta_mm"] > 0.01 or affected["relative_volume_delta"] > 0.001 else "FAIL",
        "correction_final_union": "PASS" if corrected_final_union["valid"] and corrected_final_union["component_count"] == 1 and corrected_final_union["volume_delta_match"] else "FAIL",
        "temporary_data_cleanup": "PASS" if roundtrip_temp_removed else "FAIL",
        "negative_cases_fail_closed": "PASS" if all(case["status"] == "PASS" for name, case in negative_cases.items() if name != "hole_coarse_mismatch") and negative_cases["hole_coarse_mismatch"]["comparison"]["relative_volume_delta"] > 0.001 else "FAIL",
        "cancellation": cancel["status"],
    }
    report = {
        "schema_version": SCHEMA_VERSION,
        "fixture": {"id": FIXTURE_ID, "synthetic": True, "historical_geometry_approved": False},
        "toolchain": {"cadquery": cq.__version__, "python": sys.version, "platform": sys.platform, "cpu_limit_expected": 2, "memory_limit_expected_mb": 2048},
        "canonical_contract": {"units": "mm", "axis": "right-handed Z-up", "ratified_equivalence": {"surface_distance_mm": 0.01, "bounds_delta_mm": 0.01, "relative_volume": 0.001}},
        "generation": generation,
        "repeat_comparisons": repeated,
        "restore": restore,
        "cleanup": {"temporary_roundtrip_directory": str(temp_dir), "removed": roundtrip_temp_removed},
        "correction": {"changed_parameter": "upper_step_height 8.0 -> 10.0 mm", "unchanged_features": unchanged, "affected_feature": affected, "corrected_final_union": corrected_final_union, "corrected_recipe_digest": hashlib.sha256(json.dumps(corrected_recipe, sort_keys=True).encode()).hexdigest()},
        "negative_cases": negative_cases,
        "cancellation": cancel,
        "statuses": statuses,
        "limitations": [
            "All geometry is synthetic and not approved historical Middot geometry.",
            "Coarse checks use validity, topology counts, bounding boxes and volume only; the ratified bidirectional surface-distance comparator and certified approximation/error bound were NOT RUN.",
            "No physical printer accuracy, slicing/support qualification, provenance contract, approval workflow or production deployment is proven.",
            "The cancellation probe proves bounded local process termination only; it does not prove distributed worker fencing or late-commit rejection.",
            "Scale and unit negatives prove parameter rejection/coarse mismatch only; they do not prove full scale/unit normalization.",
        ],
    }
    (output_dir / "cadquery-results.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    (output_dir / "recipe.json").write_text(json.dumps(recipe, indent=2, sort_keys=True) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("/opt/qualification/results"))
    parser.add_argument("--slow-worker", action="store_true")
    parser.add_argument("--ready-file", type=Path)
    args = parser.parse_args()
    if args.slow_worker:
        return slow_worker(args.ready_file)
    report = run_probe(args.output_dir)
    print(json.dumps({"statuses": report["statuses"], "output_dir": str(args.output_dir)}, sort_keys=True))
    return 0 if all(status == "PASS" for status in report["statuses"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
