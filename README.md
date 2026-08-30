# MediShelf

Solution for **LofiStack Hackathon 2026 — P02 (Pharmacy Expiry Shelf Check)**

## Project information

- **Team:** `Byte Bandits`
- **Team ID:** `LSH26-T013`
- **Problem:** `P02 — Pharmacy Expiry Shelf Check`
- **Live application:** <https://medishelf-final.vercel.app/>
- **Demo video:** [FILL IN: optional link, maximum three minutes, or delete this line]

> Judges will evaluate only the exact commit SHA entered in the Final Submission Form.

## Solution summary

[FILL IN: 2–4 sentences describing what MediShelf does and who it helps — e.g. how it lets a pharmacy load or enter shelf stock and flags value at risk from expiring/expired items.]

## Requirements

Fill in the actual status ("Complete", "Partial", or "Not attempted") and where in the app judges can verify each item. The rows below are drafted from the P02 problem statement and the published clarifications (R-04, R-24, R-27) — adjust wording/status to match what was actually built.

| Requirement                                                                                 | Status                             | Where to verify       |
| --------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------- |
| R1 — Load/enter shelf items (id, name, company, batch, quantity, unit price, expiry)          | [FILL IN: Complete / Partial / Not attempted] | [FILL IN: page, route or action] |
| R2 — Compute value at risk = quantity × unit price per item                                    | [FILL IN: Complete / Partial / Not attempted] | [FILL IN: page, route or action] |
| R3 — Group items into Expired vs. Expiring Soon (0–30 days left, inclusive) vs. Safe            | [FILL IN: Complete / Partial / Not attempted] | [FILL IN: page, route or action] |
| R4 — Remove returned items (via `mark_returned`) from active counts and active value totals   | [FILL IN: Complete / Partial / Not attempted] | [FILL IN: page, route or action] |

## How to test the application

1. Open the live application at <https://medishelf-final.vercel.app/>.
2. [FILL IN: First action, e.g. "Upload a fixture JSON file or enter items manually."]
3. [FILL IN: Second action, e.g. "Mark an item as returned using the case's mark_returned list."]
4. [FILL IN: Expected result, e.g. "Confirm the expired/expiring-soon groups and value-at-risk totals update correctly."]

### Test or sample data

[FILL IN: Explain how judges can load the published `P02_pharmacy_expiry_public.json` fixture into MediShelf, how to enter sample data by hand, and how to reset the app back to its initial state.]

## Run locally

### Requirements

- [FILL IN: Runtime and version, e.g. Node.js 20.x]
- [FILL IN: Database, if required, or "None"]
- [FILL IN: Other requirement]

### Setup

```bash
git clone <PUBLIC-REPOSITORY-URL>
cd lsh26-t013-p02
[FILL IN: install command]
[FILL IN: copy example env command]
[FILL IN: run command]
```

Do not include real passwords, tokens or API keys. List only variable names in `.env.example`.

## Problem-solving approach

Briefly explain:

- [FILL IN: how the team understood the P02 problem]
- [FILL IN: the chosen solution]
- [FILL IN: the most important technical or product decision]
- [FILL IN: how the solution was tested]

## Technology used

- **Frontend:** [FILL IN]
- **Backend:** [FILL IN]
- **Database:** [FILL IN]
- **Deployment:** Vercel
- **Other material tools:** [FILL IN]

See [`LICENSES.md`](LICENSES.md) for third-party materials.

## Team contributions

| Registered member       | GitHub username        | Major contribution   | Evidence                |
| ------------------------ | ----------------------- | --------------------- | ------------------------ |
| Esam Ahmed (Team Leader) | `EsamAhmed1`            | [FILL IN: contribution] | [FILL IN: file, feature or commit] |
| S.R.M Tanzil Ahmed       | `SRM-Tanzil-Ahmed`      | [FILL IN: contribution] | [FILL IN: file, feature or commit] |
| Shaishab Saha            | `ShaishabSaha`          | [FILL IN: contribution] | [FILL IN: file, feature or commit] |

Commit count alone does not represent contribution.

## AI usage

[FILL IN: List each AI tool used, what it assisted with and how the team verified its output. Write "No AI tools used" if none were used. This must match `evaluation-manifest.json`.]

## Major design decisions

- **Decision:** [FILL IN: decision and reason]
- **Decision:** [FILL IN: decision and reason]

## Known limitations

- [FILL IN: known limitation or unfinished behaviour]

## Repository records

- [`EVENT.md`](EVENT.md) — event start code and pre-event-material declaration
- [`evaluation-manifest.json`](evaluation-manifest.json) — structured judging evidence
- [`LICENSES.md`](LICENSES.md) — frameworks, libraries, templates and assets
