# nova3D

Reconstruct a physical object from historical description, and end up holding it.

The claim nova3D makes is not that a reconstruction is correct. It is that
**every decision is traceable to the evidence that produced it, or is marked as
not being evidence at all.**

## Where things are

| Path | What it is |
| --- | --- |
| `app/` | The web application. React + TypeScript + Vite, running against an in-memory backend designed to be deleted. See `app/README.md`. |
| `_bmad-output/planning-artifacts/prds/` | The PRD and its addendum. Authoritative for product behaviour. |
| `_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/` | The UX spine: `DESIGN.md` (visual contract), `EXPERIENCE.md` (the narrative), `SCREEN-INVENTORY.md` (80 screens), and the print scope-change record. All final. |
| `_bmad-output/planning-artifacts/ux-designs/.../imports/` | The native Claude Design sources — seven mockup files, the flow map, the Broadsheet design system. |
| `app/docs/screen-map.md` | Every screen ID mapped to its route. |

## Running it

```bash
cd app
npm install
npm run dev
```

Sign in with `josh@nova3d.local` and any password.

## The two gates

Nothing is built before **Plan Approval**. Nothing is exported or printed before
**Model Approval**. Neither is merged with the other, and neither is carried
forward silently when the evidence changes underneath it. Both are enforced in
the backend as well as the interface — a gate that only exists in a button's
`disabled` attribute is not a gate.

## Outstanding

Nine architecture decisions (`AD-8` … `AD-16` in the PRD) are gated and
unratified: per-vendor printer integration, the problem-detection model and its
false-positive budget, spool-tag reading, the slicing engine, the Print Record
schema, on-device picture conversion, push delivery, the internationalization
mechanism, and the accessibility conformance method. Each names an owner and a
ratification gate. Screens that depend on one say so in their own copy.
