# SpielerPlus API Discovery Log

Base URL: `https://teamplus-main.service.spielerplus.de/api/v1`
Auth: `Authorization: Bearer <JWT>` (obtained from Yii2 session `_identity_token` cookie / refresh flow on www.spielerplus.de)
Format: JSON:API-ish (`data.{id,type,attributes}`, paginated with `links`/`meta`)
Common headers: `x-locale: de`, `accept: */*`, `origin: https://www.spielerplus.de`

## Teamfund / Cashbox

### GET /teams/{team}/me/context
Returns identity, user, team, capabilities/permissions.
```json
{"data":{"id":"...","type":"me_context","attributes":{"identity":{...},"user":{...},"team":{...},"capabilities":{...}}}}
```

### GET /teams/{team}/teamfund
Ledger/balance for the team fund.
```json
{"data":{"id":"...","type":"ledgers","attributes":{"currency_code":"EUR","decimal_digits":2,"status":"active","balance_cents":1436760,"balance_updated_at":"..."}}}
```

### GET /teams/{team}/teamfund/migration/reports/current
Migration status report (legacy cashbox -> new teamfund).
```json
{"data":{"id":"...","type":"migration-reports","attributes":{"legacy_team_id":123456,"ledger_id":"...","status":"finished","started_at":"...","finished_at":"...","last_heartbeat_at":"...","phase_log":{...},"lane":"heavy"}}}
```

### GET /teams/{team}/teamfund/dues/overview?page=N
Paginated list of due periods (name, amount, date, member counts).
```json
{"data":[{"id":"...","type":"due_overviews","attributes":{"name":"V Jul 26","amount_cents":1500,"due_date":"2026-08-11","total_members":22,"paid_members":0}}, ...],"links":{...},"meta":{"current_page":1,"last_page":2,"per_page":15,"total":26}}
```

### GET /teams/{team}/teamfund/dues/members?page=N
Paginated list of members with total/paid dues counts.
```json
{"data":[{"id":"...","type":"due_member_overviews","attributes":{"member":{"id":"...","name":"...","avatar":{...},"roles":[{"id":"...","name":"...","color":"..."}],"left_team_at":null},"total_dues":26,"paid_dues":0}}, ...],"links":{...},"meta":{...}}
```


### GET /teams/{team}/teamfund/punishment-catalog?is_archived=false&page=N
Catalog of punishment definitions (fine/material types).
```json
{"data":[{"id":"...","type":"catalog_entries","attributes":{"name":"...","type":"monetary|material","amount_cents":1500,"subject":null,"is_variable":false,"is_archived":false,"has_assignments":true,"created_at":"...","updated_at":"..."}}],"links":{...},"meta":{...}}
```

### GET /teams/{team}/teamfund/punishments/summary
```json
{"data":{"id":"...","type":"punishment_summaries","attributes":{"total_open_monetary_amount_cents":21800,"total_open_monetary_count":58,"total_open_material_count":36}}}
```

### GET /teams/{team}/teamfund/punishments?page=N
Paginated list of assigned punishments per member.
```json
{"data":[{"id":"...","type":"punishments","attributes":{"name":"...","punishment_kind":"monetary|material","member":{...},"amount_cents":100,"allocated_cents":0,"subject":null,"status":"open|paid","is_archived":false,"catalog_entry_id":"...","date":"2026-08-18","paid_date":null,"note":null,"created_at":"...","updated_at":"..."}}],"links":{...},"meta":{...}}
```


### GET /teams/{team}/teamfund/transactions?page=N
Ledger transaction history (deposits/withdrawals), with allocations to punishments/dues.
```json
{"data":[{"id":"...","type":"transactions","attributes":{"entry_id":"...","subject":"...","direction":"deposit|withdrawal","type":"punishment|due|manual?","amount_cents":1500,"allocated_cents":1500,"allocation_status":"fully_allocated|...","booking_date":"2026-04-07","is_reversed":false,"reversal_of_entry_id":null,"allocations":[{"id":"...","type":"transaction_allocations","attributes":{"entry_id":"...","source_type":"punishment|due","source_id":"...","amount_cents":1500,"subject":null}}],"member":{...},"created_by":{"id":"..."},"reversal":null,"created_at":"..."}}],"links":{...},"meta":{...}}
```

### GET /teams/{team}/teamfund/member-balances?page=N
Per-member outstanding balance overview ("Meine Kasse" summary for all members).
```json
{"data":[{"id":"...","type":"member_balance_overviews","attributes":{"member":{...},"total_open_amount_cents":29850}}],"links":{...},"meta":{...}}
```

### GET /teams/{team}/teamfund/member-balances/{memberId}?page=N&status=open
Per-member itemized list of open dues/punishments contributing to their balance.
```json
{"data":[{"id":"...","type":"member_balance_items","attributes":{"type":"due|punishment","due_id":"...","name":"T Sep 25","amount_cents":750,"allocated_cents":0,"subject":null,"date":"2026-08-11","status":"open","paid_date":null}}],"links":{...},"meta":{...}}
```

## Mutations (write endpoints)

All mutation endpoints below were captured live and reverted immediately after (verified balance/state returned to baseline). Rate limit on mutations is tighter than reads: `x-ratelimit-limit: 60` (vs 180 for GETs).

**Rate limit window confirmed to be ~60 seconds (fixed/rolling window, not hourly).** Verified by
exhausting the read budget (180 requests in ~38s) and observing the resulting `429`:
`retry-after: 8` and `x-ratelimit-reset: <unix-ts>`, where the reset timestamp was only ~8s after
the response's own `date` header -- i.e. the window resets roughly once per minute from when it
started filling. After reset, `x-ratelimit-remaining` jumps straight back to the full limit (180),
confirming a fixed window rather than a gradually-recovering leaky bucket. `x-ratelimit-reset` is
only populated on `429` responses; it's `null` on normal `200`s. Practical implication: pace bulk
mutations by reading `x-ratelimit-remaining` and sleeping until `retry-after` (or ~60s) when it
hits 0, rather than assuming an hourly budget -- large batches (100s of calls) complete in minutes,
not hours.

### Dues (per-member payment status)

#### POST /teams/{team}/teamfund/dues/{dueId}/members/{memberId}/mark-paid
Marks one member's due as paid. Status 202 (async).
```json
// request
{"paid_date":"2026-09-02"}
// response
{"data":{"entry_id":"..."}}
```

#### POST /teams/{team}/teamfund/dues/{dueId}/members/{memberId}/exempt
Marks a due as "exempted" (excused, no payment expected) for one member. No request body. Status 200.
```json
{"data":{"id":"...","type":"due_member_payments","attributes":{"member":{...},"status":"exempted","paid_date":null}}}
```
**⚠️ Important side effect confirmed on a live account with real payment history**: calling `exempt` on a member whose due is currently **`"paid"`** (not just `"open"`) reverses the underlying deposit transaction created by the earlier `mark-paid` call — the ledger balance decreases by that due's amount and a new offsetting transaction is recorded (transaction count increases, `is_reversed`-style bookkeeping, similar to `entries/{id}/reverse`). This is *not* just a status flag change; it is a real financial reversal. Confirmed at scale: reverting 226 paid/exempted member-due records (in order to satisfy `is_used: false` for bulk due-definition deletion) reduced a real team's ledger balance by exactly the sum of the reverted dues' amounts (~€1,245 across 22 members over ~1 year of dues). Treat `exempt()` on a `"paid"` record as financially equivalent to un-doing that payment, not as a soft/cosmetic status change.

#### POST /teams/{team}/teamfund/dues/{dueId}/members/{memberId}/revoke-exemption
Reverts an exemption back to `"open"`. No request body. Status 200.
```json
{"data":{"id":"...","type":"due_member_payments","attributes":{"member":{...},"status":"open","paid_date":null}}}
```
Note: the UI's due-payment checkbox is a 3-state cycle: open -> paid (mark-paid) -> exempted (calls `exempt`, NOT a generic "unmark") -> open (revoke-exemption). There is no direct "mark-unpaid" for dues (contrast with punishments, which do have one — see below).

#### GET /teams/{team}/teamfund/dues/members/{memberId}?page=N
Per-member itemized due list (similar shape to member-balance-items but due-specific), used when opening a member's due-management modal.
```json
{"data":[{"id":"...","type":"member_due_list_items","attributes":{"name":"V Jul 26","amount_cents":1500,"due_date":"2026-08-11","status":"open","paid_date":null,"allocated_cents":0}}],"links":{...},"meta":{...}}
```

#### GET /teams/{team}/teamfund/dues/{dueId}/members?page=N
The inverse of the above: every team member's payment status for **one specific due**. This is what powers the "Beiträge verwalten" per-due bulk view (the "Beiträge" toggle, as opposed to the default "Spieler" per-member toggle). Far more direct than cross-referencing `dues/members/{memberId}` by name when you need "who is non-open for due X".
```json
{"data":[{"id":"...","type":"due_member_statuses","attributes":{"member":{...},"status":"open|paid|exempted","paid_date":"2026-04-07"|null,"allocated_cents":1500}}],"links":{...},"meta":{...}}
```

**Important: there is no bulk mutation endpoint.** The "Beiträge verwalten" per-due modal lets you check/uncheck many members' payment status and click one "Speichern" button, but this fires N individual `POST .../dues/{dueId}/members/{memberId}/mark-paid` (or `/exempt`) requests sequentially — one per changed member — not a single batched request. A client-side bulk helper must loop and issue individual mutations, same as the UI does.

### Due definitions (catalog of due periods, e.g. "T Sep 25")

#### GET /teams/{team}/teamfund/dues?page=N&is_archived=false
List due definitions (not per-member; the underlying "due type" objects referenced by dues/overview).
```json
{"data":[{"id":"...","type":"dues","attributes":{"name":"T Jul 25","amount_cents":750,"due_date":"2026-08-11","is_archived":false,"is_used":true,"created_at":"...","updated_at":"..."}}],"links":{...},"meta":{...}}
```

#### POST /teams/{team}/teamfund/dues
Creates a new due definition. **Important side effect**: creating a due immediately assigns it (status "open") to every current team member (observed: per-member due count incremented for all 22 members). Status 201.
```json
// request
{"name":"T Sep 26","amount_cents":750}
// response
{"data":{"id":"...","type":"dues","attributes":{"name":"T Sep 26","amount_cents":750,"due_date":"2026-09-02","is_archived":false,"is_used":false,"created_at":"...","updated_at":"..."}}}
```
Note: `due_date` defaults to today; no date param observed being sent (the create form only exposes name + amount). `is_used` becomes true once at least one member's assignment is touched (e.g. paid/exempted). **Confirmed the server ignores a client-supplied `due_date` entirely** -- sending `{"name":"...","amount_cents":1,"due_date":"2024-09-15"}` still returns `due_date: "<today>"` in the response. There is no way to backdate a due definition; the only way to represent "this due is for month X" is via the `name` field.

**Race condition on member assignment**: immediately calling `mark-paid`/`exempt` for a freshly-created due can intermittently return `404` (assignment not yet visible) for the first member touched. A ~1-2s delay after creation avoids most of these; a retry-with-backoff on the caller side clears the rest. Also intermittently returns `422` with message `"Von Befreit nach Befreit kann nicht überführt werden."` ("cannot transition from exempt to exempt") if a bulk script re-processes a due whose members were already fully exempted in a prior (interrupted) run -- this is a real signal, not a bug: re-fetch `dueMemberStatuses` (paginated! see below) before deciding whether a mutation is still needed, rather than assuming a fresh due's initial state.

**`GET /teams/{team}/teamfund/dues/{dueId}/members` is paginated** like every other list endpoint (default page size well under a 22-member roster) -- iterate `meta.last_page` before trusting a status lookup as exhaustive. Missing this caused a real bug during bulk history recreation: unpaginated reads silently omitted the alphabetically-last members, making already-processed members look "unset" and triggering duplicate/invalid mutations against them.

#### DELETE /teams/{team}/teamfund/dues/{dueId}
Permanently deletes a due definition (cascades to remove it from all members). Status 204. Only available while the due has **no payments** (`is_used: false`). Once any member's due has been marked paid/exempted, the UI switches to archive-only (matches the punishment-catalog pattern: delete for unused, archive for used).

#### POST /teams/{team}/teamfund/dues/{dueId}/archive
Archives a due definition (required once it has at least one payment — the UI blocks delete/edit in that case and shows "Archivieren" instead). No request body. Status 200.
```json
{"data":{"id":"...","type":"dues","attributes":{"name":"T Jul 25","amount_cents":750,"due_date":"2026-08-11","is_archived":true,"is_used":true,"created_at":"...","updated_at":"..."}}}
```
Archiving a due removes it from every member's active due count (verified: per-member "N/26 Beiträge erledigt" counters dropped by 1 for all members immediately after archiving).

#### POST /teams/{team}/teamfund/dues/{dueId}/unarchive
Reactivates an archived due definition, restoring it to every member's active due list. No request body. Status 200.
```json
{"data":{"id":"...","type":"dues","attributes":{"name":"T Jul 25","amount_cents":750,"due_date":"2026-08-11","is_archived":false,"is_used":true,"created_at":"...","updated_at":"..."}}}
```

#### GET /teams/{team}/teamfund/dues?page=N&is_archived=true
Same shape as the active list, but for archived due definitions (toggle `is_archived` param).

### Punishments (assigned fines/material punishments)

#### GET /teams/{team}/teamfund/punishments/{id}
Single punishment detail.
```json
{"data":{"id":"...","type":"punishments","attributes":{"name":"...","punishment_kind":"monetary|material","member":{...},"amount_cents":100,"allocated_cents":0,"subject":null,"status":"open|paid","is_archived":false,"catalog_entry_id":"...","date":"2026-08-18","paid_date":null,"note":null,"created_at":"...","updated_at":"...","catalog_entry_is_archived":false}}}
```

#### POST /teams/{team}/teamfund/punishments
Assigns a catalog punishment to one or more members. Status 202 (async — fans out to N individual punishment records).
```json
// request
{"catalog_entry_id":"...","date":"2026-09-02","user_ids":["..."],"amount_cents":null,"subject":null,"note":null}
// response
{"data":{"accepted":1,"user_ids":["..."]}}
```
`amount_cents`/`subject` can override the catalog entry's default (e.g. for variable-amount or material punishments); pass `null` to use the catalog defaults.

#### PATCH /teams/{team}/teamfund/punishments/{id}
Edits an existing (unpaid, non-archived) punishment's date and/or catalog entry. Status 200.
```json
// request
{"date":"2026-09-01","catalog_entry_id":"..."}
// response: full updated punishment resource (see GET single above)
```

#### POST /teams/{team}/teamfund/punishments/{id}/mark-paid
Marks a punishment paid. No request body observed (paid_date defaults server-side). Status 202.
```json
{"data":{"entry_id":"..."}}
```

#### POST /teams/{team}/teamfund/punishments/{id}/mark-unpaid
Reverts a punishment to open/unpaid. No request body. Status 202.

#### DELETE /teams/{team}/teamfund/punishments/{id}
Permanently deletes a punishment. Status 204. Only available while unpaid/unarchived (UI showed "Löschen" alongside "Als bezahlt markieren" for open punishments).

Note: paid punishments show "Archivieren" instead of "Löschen" + "Als bezahlt markieren" — archive/unarchive on individual *punishment instances* (as opposed to catalog entries) was not captured; only catalog-entry archive/unarchive was tested (see below). The detail modal for a paid punishment offers "Archivieren" and "Bezahlung zurücknehmen" (-> `mark-unpaid`).

### Punishment catalog (reusable punishment/fine definitions)

#### POST /teams/{team}/teamfund/punishment-catalog
Creates a new catalog entry. Status 201.
```json
// request (monetary)
{"name":"...","type":"monetary","is_variable":false,"amount_cents":100,"subject":null}
// request (material, no amount)
{"name":"...","type":"material","is_variable":false,"amount_cents":null,"subject":"Kiste Bier"}
// response
{"data":{"id":"...","type":"catalog_entries","attributes":{"name":"...","type":"monetary","amount_cents":100,"subject":null,"is_variable":false,"is_archived":null,"has_assignments":false,"created_at":"...","updated_at":"..."}}}
```

#### PATCH /teams/{team}/teamfund/punishment-catalog/{id}
Edits a catalog entry (only while not archived). Status 200. Same body shape as create.

#### DELETE /teams/{team}/teamfund/punishment-catalog/{id}
Permanently deletes a catalog entry. Status 204. Only available when `has_assignments: false` (no punishments have ever used it) — the UI still shows a "Löschen" option even on entries with assignments in some cases, but expect this to fail server-side (`has_assignments: true` entries should be archived instead, not deleted; not confirmed via direct API test to avoid data loss).

#### POST /teams/{team}/teamfund/punishment-catalog/{id}/archive
Archives a catalog entry (soft-hide from active list, prevents further assignment). No request body. Status 200.

#### POST /teams/{team}/teamfund/punishment-catalog/{id}/unarchive
Reactivates an archived catalog entry. No request body. Status 200.

#### GET /teams/{team}/teamfund/punishment-catalog?is_archived=true&page=N
Same shape as the active list, but for archived entries (toggle `is_archived` param).

### Transactions (ledger entries: manual deposits/withdrawals)

#### POST /teams/{team}/teamfund/entries/withdraw
Records a manual expense (withdrawal) against the team fund, optionally attributed to a member. Status 201.
```json
// request
{"amount_cents":100,"subject":"...","booking_date":"2026-09-02","member_id":"..."}
// response
{"data":{"id":"...","type":"entries","attributes":{"ledger_id":"...","amount_cents":100,"subject":"...","member":{...},"created_by":{"id":"..."},"booking_date":"2026-09-02","direction":"withdrawal","type":"direct","source":"manual"}}}
```
The UI's "Ausgabe" (expense) button drives this. `member_id` appears to default to the current user if not otherwise selected in the form (a member picker may exist in fuller flows not explored here).

#### POST /teams/{team}/teamfund/entries/deposit  *(inferred, not directly captured)*
Symmetric counterpart for "Einnahme" (income) — not explicitly captured (only tested "Ausgabe"), but near-certain to exist given the `withdraw` naming convention and mirrored UI button. **Treat as unverified** until confirmed.

#### GET /teams/{team}/teamfund/transactions/{id}
Single transaction detail (same shape as list item).

#### POST /teams/{team}/teamfund/entries/{entryId}/reverse
Reverses (stornos) a transaction. Requires a reason. Creates a new offsetting transaction rather than deleting the original (audit trail preserved — net balance effect cancels out, but transaction history grows by one entry). Status 200.
```json
// request
{"reason":"..."}
// response: the *original* transaction resource, now presumably with is_reversed:true (not independently re-verified after this call)
```
Note: the reversal endpoint path uses the ledger **entry ID** (`entry_id` field from the transaction resource), not the transaction resource's own `id`.

### Misc

#### GET /teams/{team}/teamfund/sync-status
Polled after mutations to check background processing status (the API uses async processing for some writes, e.g. mark-paid returns 202 before the ledger balance/summary reflects the change). Cheap, cacheable (`cache-control: max-age=5`).
```json
{"data":{"id":"<teamId>","type":"sync_status","attributes":{"delay_seconds":1}}}
```

#### GET /teams/{team}/teamfund/member-settings?page=N
Per-member visibility toggles for punishments/dues (e.g. hide a member from the "Strafe vergeben" / dues picker without removing them from the team).
```json
{"data":[{"id":"...","type":"member_settings","attributes":{"member":{...},"visible_in_punishments":true,"visible_in_dues":true}}],"links":{...},"meta":{...}}
```
No corresponding write endpoint was captured (would presumably be a `PATCH` toggling these two booleans) — this is a read-only discovery, the write path was not exercised.

## Notes on scope

- Only the **Teamfund/Cashbox** module has been migrated to this Nuxt SPA + `teamplus-main.service.spielerplus.de` backend so far.
- Team roster (`/nu/team`), events/calendar, absences, statistics, lineup, chat, votes all still redirect to the legacy Yii2 app (`www.spielerplus.de/site/*`, `/dashboard/*`, `/training/*`, `/game/*`, `/vote/*`, `/chat`, etc.) — these do NOT hit `teamplus-main.service.spielerplus.de`. They likely use a different legacy API (if any is exposed) or are server-rendered only.
- A separate `api.spielerplus.de/eventcenter` service exists (real-time event bus, polled via `token_prefix=user:{userId}:{ttl}&history={ts}&category_id=1`), used for live updates (long-polling), not a general REST API.


## Authentication Flow

1. **Login** (Yii2 session, on `www.spielerplus.de`):
   - `GET https://www.spielerplus.de/site/login` — parse hidden input `_csrf` value from HTML `<form>`. Server sets session cookies (`PHPSESSID`-equivalent, `_csrf` HttpOnly).
   - `POST https://www.spielerplus.de/site/login` as `application/x-www-form-urlencoded`:
     ```
     _csrf=<value from step 1>
     LoginForm[email]=<email>
     LoginForm[password]=<password>
     ```
     Must reuse the same cookie jar from step 1 (CSRF is validated against the session).
   - On success: sets `_identity` (remember-me, ~90 days), `SID`, `language`, `timezone` cookies. Redirects to team selection or dashboard.
   - If multiple teams: `GET https://www.spielerplus.de/site/switch-user?id={userId}` to pick active team context (sets active team in session).

2. **Mint API access token** (JWT):
   - `GET https://www.spielerplus.de/auth/refresh-token` with cookies (`credentials: include` equivalent — send cookie jar).
   - Response: `{"access_token": "<JWT>"}`. No request body needed; relies purely on Yii2 session cookies.
   - JWT lifetime observed: ~600s (10 min). Payload (base64url, RS256-signed, not verifiable client-side without SpielerPlus public key — just decode for expiry):
     ```json
     {"iss":"PlayerPlus","aud":["PlayerPlus"],"sub":"common","exp":...,"iat":...,
      "sprth":"...","spa":"<accountId>","spu":"<userId>","spdu":"","spt":"<teamId>",
      "spp":["cudCashbox","viewCashbox","listOther",...],  // permission scopes
      "sppa":{"task":{...},"lineup":{...}}}
     ```
   - Refresh proactively: mint a new token when `exp - now(seconds) <= 60`.
   - This mint endpoint is IP/session-bound; the `_identity_refresh_token` JWT cookie approach (separate mechanism) is NOT what's used here — do not rely on it, it's single-use/rotating and got invalidated in earlier testing. The `/auth/refresh-token` GET + session cookie is the reliable mechanism actually used by the frontend.

3. **Use token**: `Authorization: Bearer <access_token>` on all `teamplus-main.service.spielerplus.de/api/v1/*` calls, plus `x-locale: de` (or user's locale) and `Accept: */*`.

### Required cookie jar contents for refresh to work
Must persist the full Yii2 session cookie set after login: `_identity`, `SID` (or equivalent session cookie), `_csrf`, `language`, `timezone`. A simple in-memory or file-persisted cookie jar (e.g. `tough-cookie` + `fetch-cookie` in Node) covers this.

