# Market Fee Revenue Pilot

A working prototype of a **market fee collection system** built to plug revenue
leakage at the point of collection — designed for a cash-strapped local
government trying to account for revenue it's already owed but currently loses
to informal cash handling.

Built around one principle: **the vendor becomes the auditor.** Every fee
collection is logged at the moment it happens, tied to a specific collector
and a specific pre-registered vendor, and an SMS receipt goes straight to the
vendor's own phone — a record the collector cannot edit afterward.

## What's included

- **Collector app** (`frontend/collector.html`) — mobile-first PWA-style app a
  market fee collector uses in the field. Login by phone + PIN (no shared
  logins, so every transaction has individual accountability), pick a vendor,
  record the amount and payment method (mobile money or cash), get a receipt
  code, and see the simulated SMS receipt sent to the vendor.

- **Revenue office dashboard** (`frontend/dashboard.html`) — what a county
  revenue office or Ministry of Finance would use: total collected, a 21-day
  trend chart, a **variance flagging table** that automatically compares each
  collector's actual average daily collection against what's expected
  (registered vendors × standard fee) and flags anyone significantly under
  that baseline, a market-by-market breakdown, and an open vendor complaints
  queue (fed by an SMS shortcode in a real deployment).

- **API backend** (`backend/`) — Node/Express + SQLite. Endpoints for login,
  vendor/market/collector lookups, fee collection, transaction history,
  complaints, and dashboard aggregation.

- **Seed data** (`backend/seed.js`) — 3 markets, 3 collectors, ~95 vendors,
  and 21 days of realistic transaction history. One collector (Peter Lomude,
  Custom Market) is deliberately seeded with a collection shortfall over the
  last 10 days, so the dashboard's variance flag has something real to catch
  — this is the demo of the system actually working.

## Running it

**1. Backend**

```bash
cd backend
npm install
npm run seed      # populates pilot.db with test data
npm start          # runs API on http://localhost:4000
```

**2. Frontend**

The frontend is plain HTML/JS with no build step. Just open the files in a
browser (or serve the `frontend/` folder with any static server), with the
backend running:

```bash
cd frontend
python3 -m http.server 8080
# then open http://localhost:8080/dashboard.html
# and http://localhost:8080/collector.html
```

**Demo collector logins** (shown on the login screen too):
| Name | Market | Phone | PIN |
|---|---|---|---|
| Achol Deng | Konyo-Konyo Market | 0925550101 | 1111 |
| Peter Lomude | Custom Market | 0925550102 | 2222 |
| Grace Nyandeng | Jebel Market | 0925550103 | 3333 |

Log in as Peter Lomude, collect a fee, then open the dashboard — you'll see
his market flagged `high_risk` in the variance table from the seeded
shortfall, and adding a new transaction will nudge his average.

## Design notes / what makes this an anti-corruption tool, not just a data app

- **Individual login per collector** — no shared PINs, so every transaction
  has a named person attached to it.
- **Timestamp set at collection, not at sync** — a collector working offline
  in a market with no signal can't backdate or bulk-edit transactions when
  they reconnect.
- **SMS receipt goes to the vendor, not just into the collector's app** — the
  vendor holds an independent, external copy of what they paid, which the
  collector can't quietly change later.
- **Variance flagging compares actual vs. expected**, using registered vendor
  counts and standard fees as a baseline, so under-collection surfaces
  automatically instead of waiting for a complaint or an audit months later.
- **Complaint channel bypasses the collector's own chain** — a vendor who
  wasn't given a receipt, or was asked for more than the posted fee, can
  report it directly to the dashboard.

## Adapting this for a real pilot

- Swap the simulated SMS log for a real gateway (Africa's Talking has SSP-
  friendly SMS/USSD APIs used elsewhere in East Africa; MTN/Digitel mobile
  money APIs for the `momo` payment path).
- Replace the phone+PIN login with something harder to share, e.g. a
  government ID check or biometric enrollment, if the pilot expands beyond a
  trusted first cohort of collectors.
- The variance-flagging thresholds (`-20%` watch, `-40%` high risk in
  `backend/server.js`) are placeholders — tune them against a few weeks of
  real baseline data before treating flags as anything but a starting point
  for a conversation with that collector.
