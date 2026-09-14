# Acceptance Criteria

**Story 8.5: Qualify the complete accessible device workflow**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner,
I want to use every supported workflow on the adopted devices,
So that phone, desktop and assistive access have measured evidence.

**Requirement IDs:** AR-24, AR-27, AR-28, SC-3, SC-4, SC-7, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR20

## Dependencies

- [7.6](../spec-nova3D-story-7-6/SPEC.md)
- [7.7](../spec-nova3D-story-7-7/SPEC.md)
- [8.2](../spec-nova3D-story-8-2/SPEC.md)

## Scope

- Validate all 53 already-implemented surfaces and required states with a screen-to-implementation map; this story is qualification, not a deferred UX implementation bucket.

## Acceptance Criteria

### AC-1

**Given** MacBook Air M2 16 GB, Windows 11 i5-1235U/Iris Xe 16 GB, iPhone 16 Pro and Pixel 9 Pro
**When** current/previous stable desktop Chrome/Edge/Firefox, macOS/iOS Safari and Android Chrome are qualified
**Then** actual OS/browser builds and complete phone/computer flows, RTL/bilingual evidence, light/dark, keyboard/screen-reader and accessibility states are recorded

### AC-2

**Given** a cold model cache at shaped 20 Mbps and a ≤100,000-triangle fixture
**When** open-to-interactive is measured
**Then** viewer code/network/decode and working orbit/feature-evidence navigation fit ≤5 seconds with ≤5 MB coarse and ≤20 MB full initial GLB; p95 frame time is ≤33 ms after load

### AC-3

**Given** LOD switches, GPU loss, enlarged text, high contrast or reduced motion
**When** the full journey is exercised
**Then** selection/provenance and all semantic controls survive; headless emulation cannot substitute for hardware/accessibility acceptance

## Engineering Gates

G-5.

These are acceptance obligations, not claims that the implementation or qualification has passed.
