# Acceptance Criteria

**Story 8.8: Qualify the workflow on the remaining device classes**

**Epic 8: Delete private work and prove release readiness.** Users can remove their data, Josh can close the instance, and the complete product is accepted only with real application/device and recovery evidence.

As an Account owner,
I want to know the workflow works on Mac, iPhone and Android,
So that phone and Safari users get the same capabilities.

**Requirement IDs:** AR-24, AR-27, AR-28, SC-3, SC-4, SC-7, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR20

## Dependencies

- [8.5](../spec-nova3D-story-8-5/SPEC.md)

## Scope

- Repeat the Story 8.5 qualification on the MacBook Air M2 (Safari, Chrome and Firefox), the iPhone 16 Pro and the Pixel 9 Pro. Josh arranges borrowed devices or a real-device testing service; emulation cannot substitute. Until these are recorded G-5 stays BLOCKED or PARTIAL and full first-version release stays blocked.

## Acceptance Criteria

### AC-1

**Given** a MacBook Air M2 16 GB, an iPhone 16 Pro and a Pixel 9 Pro
**When** the complete phone and computer flows are exercised
**Then** actual OS/browser builds, RTL/bilingual evidence, light/dark, keyboard/screen-reader and accessibility states are recorded

### AC-2

**Given** a cold model cache at shaped 20 Mbps and a fixture of at most 100,000 triangles
**When** the viewer opens on each device
**Then** viewer code, network, decode and working orbit/feature-evidence navigation fit 5 seconds with at most 5 MB coarse and 20 MB full initial GLB, and p95 frame time is at most 33 ms after load

### AC-3

**Given** LOD switches, GPU loss, enlarged text, high contrast or reduced motion
**When** they occur on these devices
**Then** selection/provenance and all semantic controls survive; headless emulation cannot substitute for hardware/accessibility acceptance

## Engineering Gates

G-5.

These are acceptance obligations, not claims that the implementation or qualification has passed.
