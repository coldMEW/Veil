# Agent execution rules — Veil

Read the externally supplied team plan (kept outside this repository) before working. Do not copy it, its sections, or any personal notes into this repository, PRs or Discussions.

## Coordination
- GitHub Discussions: **Build Coordination** (task claims/progress/handoffs) and **Decisions and Contracts** (interface changes).
- Post a START claim (what, why, paths, dependencies, acceptance tests) before editing. Post BLOCKED/FAILED/HANDOFF/FIXED updates. `FIXED` only after rerunning the failing check.
- Read new comments **and replies** at every handoff and at least every 10 minutes while active.
- One task, one owner, one branch, one small PR. No direct pushes to `main`.

## Ownership
| Path | Owner |
|---|---|
| `src/features/inspect/physics/shadow/`, shadow annotation UI | Sandeep (reassigned from Sushant, see Decisions and Contracts) |
| `src/features/inspect/physics/eyes/`, physics fixtures + acceptance, Inspect wording review | Bibek (reassigned from Sushant) |
| `src/app/`, `src/components/`, `src/styles/`, `src/features/inspect/model/`, `src/lib/runtime/`, `public/`, CI/deploy | Sandeep |
| `src/features/clean/`, `src/features/protect/`, `src/features/report/`, `src/features/inspect/spectrum/`, `src/features/inspect/provenance/`, `scripts/eval/`, `scripts/export/`, `tests/e2e/` | Bibek |
| `src/contracts/` | Bibek (schema), Sandeep (integration review), Sandeep (shadow fields), Bibek (eye fields) |

Edit a contract only after posting the proposed change in Decisions and Contracts.

## Commands
`npm ci`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`.

## Hard rules
- No cloud image calls by default. No API keys in client code, `VITE_` variables or localStorage.
- Never persist input images, OCR text or reports automatically.
- A failed/timed-out check is `inconclusive`, never a clean result. No global real/fake verdict or confidence score.
- Never claim model, browser, GPU or phone success without results from that environment.
- Private photos and fixtures stay outside Git; CI uses synthetic fixtures.
