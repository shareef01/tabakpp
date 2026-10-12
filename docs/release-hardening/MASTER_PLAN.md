# TABAKPP — Release-Hardening Master Plan

Product constraint: **preserve existing behaviour, design and UX**. No redesign, no new
user-facing features. Local/emulator-only. Nothing committed, pushed, deployed or migrated.

| Phase | Goal | Gate | Status |
|---|---|---|---|
| 0 | Baseline freeze + plan | plan + test matrix exist | **DONE** (this session) |
| 1 | Functional correctness + financial integrity | no P0 defects; critical tests green | **OPEN** (P1 blocker: 12 Android device tests) |
| 2 | End-to-end reliability (Web/PWA + Android journeys) | critical journeys pass on all platforms | **OPEN** (blocked by Phase 1) |
| 3 | UI/UX quality without redesign | no high-severity UI defects, no unapproved visual change | **NOT STARTED** |
| 4 | Performance, security, stability | no critical security defects, measured bottlenecks resolved | **NOT STARTED** |
| 5 | Independent release verification | all mandatory gates pass with real evidence | **NOT STARTED** |

## Sequencing
1. W1A Android Firestore write capture (P1, blocker) — see `HANDOFF.md`.
2. W1B Web trusted mutation completion (`endDay`/`closeDay`, `reconcileStaleDays`,
   `updateHistoricalDay`; backend `HISTORICAL_DAY_UPDATE`/`STALE_DAY_RECONCILE`).
3. W1C Migration correctness/recovery (emulator only).
4. W1D Core correctness sweep (rollover, timezone, history pagination, offline).
5. Phases 2 → 5.

## Rules of engagement
- Minimal isolated patches; every change has a backlog ID + targeted + regression evidence.
- Do not weaken authorization, narrow supported data bounds (50-entry count maps), or move
  financial authority back to the client.
- A task is `VERIFIED` only when its acceptance tests executed successfully.
