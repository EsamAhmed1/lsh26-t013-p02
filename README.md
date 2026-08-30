# MediShelf (static, frontend-only)

MediShelf is a pharmacy inventory & ordering demo. This build is **100%
front-end** — there is no Django, no Python, no database, and no server to
run. Every page is a plain static file, and all "backend" logic (auth,
expiry grouping, orders, notifications) runs in the browser, backed by an
in-memory/localStorage mock database seeded from demo data.

## Run it locally

No build step, no install. Just serve the folder:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open `login.html` (or `/`, which redirects to it).

## Demo accounts

| Role        | Username      | Password   |
|-------------|---------------|------------|
| Pharmacy    | `pharmacy`    | `pharma123`|
| Pharmacy    | `pharmacy2`   | `pharma123`|
| Distributor | `distributor` | `dist123`  |
| Distributor | `distributor2`| `dist123`  |

Sign in as a Pharmacy in one tab and a Distributor in another tab (same
browser) to see both sides of the ordering workflow update live — orders
placed by the pharmacy show up for the distributor, status changes made by
the distributor show up back in the pharmacy panel, and delivered orders can
be added to pharmacy inventory with a batch/expiry/quantity/unit you supply.

## How the "backend" works now

- **`mock-cases-data.js`** — the original judge dataset
  (`P02_pharmacy_expiry_public.json`), embedded as a JS object.
- **`mock-backend.js`** — a small in-browser API that mirrors the old
  Django endpoints 1:1 (same paths, same request/response shapes, same
  expiry-grouping rules, same order state machine). It stores its data in
  `localStorage` under `medishelf_mock_db_v1`, so data persists across
  page reloads and is shared across every tab on the same origin (which is
  what makes "log in as Pharmacy and Distributor at the same time" work).
- **`auth.js`** — unchanged in spirit, but now calls `window.MediMock` instead
  of `fetch()`-ing a real server. `app.js`, `distributor.js` and
  `notifications.js` were not touched — they still just call
  `MediAuth.api(path, options)`.

To wipe all demo data and start over, clear the site's local storage (or
open the console and run `MediMock.resetAllData()`), then refresh.

## Deploying to Vercel

This repo needs **zero configuration**. Push it to GitHub and import it into
Vercel as a static project (Framework Preset: "Other"). `vercel.json` just
redirects `/` to `/login.html`; everything else is served as-is.

```bash
git init
git add .
git commit -m "MediShelf static build"
git remote add origin <your-repo-url>
git push -u origin main
```

Then "Import Project" in Vercel and deploy — no environment variables, no
database, no build command required.
