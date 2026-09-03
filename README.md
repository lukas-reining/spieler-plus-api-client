# spieler-plus-api-client

[![npm version](https://img.shields.io/npm/v/spieler-plus-api-client.svg)](https://www.npmjs.com/package/spieler-plus-api-client)
[![CI](https://github.com/lukas-reining/spieler-plus-api-client/actions/workflows/ci.yml/badge.svg)](https://github.com/lukas-reining/spieler-plus-api-client/actions/workflows/ci.yml)

Unofficial TypeScript client for the **SpielerPlus Teamfund (Teamkasse)** REST API.

SpielerPlus (spielerplus.de) is a German sports team management platform. Most
of the product still runs on a legacy server-rendered backend with no public
API, but the **Teamfund / Teamkasse** module (dues, punishments/fines, ledger
transactions, member balances) was rewritten as a Nuxt SPA backed by a proper
JSON REST API at `teamplus-main.service.spielerplus.de`. This package wraps
that API.

> This is a reverse-engineered, unofficial client. It is not affiliated with
> or endorsed by SpielerPlus / Sportplatz Media. Endpoints and payload shapes
> may change without notice.

## Scope

Only the Teamfund module is covered. Everything else in the product (events,
team roster, absences, statistics, votes, chat) is still served by the legacy
app and has no equivalent clean REST API, so it's out of scope here.

## Install

```bash
npm install spieler-plus-api-client
```

## Usage

```ts
import { createSpielerPlusClient } from "spieler-plus-api-client";

const { client } = await createSpielerPlusClient({
  email: "you@example.com",
  password: process.env.SPIELERPLUS_PASSWORD!,
});

const ledger = await client.ledger();
console.log(ledger.data.attributes.balance_cents / 100, ledger.data.attributes.currency_code);

const openPunishments = await client.punishments();
const dues = await client.duesOverview();
```

If you manage multiple teams, pass a `teamId` explicitly to any client
method; otherwise it defaults to the team embedded in your current session
token (`session.teamId`).

### Reads

- `meContext()`, `ledger()`, `migrationReport()`, `syncStatus()`
- `transactions(params)`, `transaction(id)`
- `duesOverview(params)`, `duesMembers(params)`, `memberDueList(memberId, params)`, `dueDefinitions(params)`
- `punishmentCatalog(params)`, `punishmentsSummary()`, `punishments(params)`, `punishment(id)`
- `memberBalances(params)`, `memberBalanceItems(memberId, params)`, `memberSettings(params)`

### Mutations

```ts
// Dues
await client.markDuePaid(dueId, memberId, "2026-09-02");
await client.exemptMemberDue(dueId, memberId);
await client.revokeDueExemption(dueId, memberId);
await client.createDueDefinition({ name: "T Sep 26", amount_cents: 750 }); // assigns to entire roster immediately
await client.deleteDueDefinition(dueId); // only if no member has paid/exempted it yet
await client.archiveDueDefinition(dueId); // use once a due has payments (delete is blocked then)
await client.unarchiveDueDefinition(dueId);

// Punishments
await client.assignPunishment({ catalog_entry_id, date: "2026-09-02", user_ids: [memberId] });
await client.updatePunishment(punishmentId, { date: "2026-09-03" });
await client.markPunishmentPaid(punishmentId);
await client.markPunishmentUnpaid(punishmentId);
await client.deletePunishment(punishmentId);

// Punishment catalog
await client.createPunishmentCatalogEntry({ name: "...", type: "monetary", is_variable: false, amount_cents: 100 });
await client.updatePunishmentCatalogEntry(catalogEntryId, { ... });
await client.archivePunishmentCatalogEntry(catalogEntryId);
await client.unarchivePunishmentCatalogEntry(catalogEntryId);
await client.deletePunishmentCatalogEntry(catalogEntryId); // only if it has no assignments

// Ledger
await client.withdraw({ amount_cents: 500, subject: "Bälle", booking_date: "2026-09-02", member_id: memberId });
await client.reverseEntry(entryId, "reason for reversal"); // entryId = transaction's entry_id, not its own id
```

> **Async mutations**: `mark-paid`, `mark-unpaid`, and punishment assignment
> return `202 Accepted` and process in the background. Calling a follow-up
> mutation (e.g. delete, or the opposite mark-*) before the status has
> settled returns `422`. Poll `syncStatus()` and/or re-fetch the resource
> until it reflects the expected state before chaining further mutations —
> see `scripts/smoke-test.ts` for a working poll-and-retry pattern.

### Lower-level: session only

```ts
import { SpielerPlusSession, TeamfundClient } from "spieler-plus-api-client";

const session = new SpielerPlusSession();
await session.login({ email, password });
await session.getAccessToken(); // mints the JWT; auto-refreshed later as needed

const client = new TeamfundClient(session);
```

## How authentication works

1. `GET /site/login` on `www.spielerplus.de` — scrape the Yii2 `_csrf` token.
2. `POST /site/login` with `_csrf` + `LoginForm[email]` + `LoginForm[password]`
   — establishes a classic session cookie (incl. a ~90 day remember-me
   cookie).
3. `GET /auth/refresh-token` (with that session's cookies) — mints a
   short-lived (~10 min) RS256 JWT: `{ "access_token": "..." }`.
4. That JWT is sent as `Authorization: Bearer <token>` to
   `teamplus-main.service.spielerplus.de/api/v1/*`.

`SpielerPlusSession` re-mints the token automatically, both proactively
(when less than 60s from expiry) and reactively (on a `401` response, retried
once) — mirroring the official frontend's own behavior.

## Discovery notes

See [`discovery/endpoints.md`](./discovery/endpoints.md) for the full catalog
of captured endpoints, response shapes, and how they were found (via
Chrome DevTools MCP network inspection + Nuxt bundle analysis).

## Smoke test

Exercises every endpoint against the live API:

```bash
SPIELERPLUS_EMAIL=you@example.com SPIELERPLUS_PASSWORD=secret npm run smoke
```

## Disclaimer

Uses an undocumented, unversioned internal API. Expect breakage. Don't hammer
it — reads are rate-limited to `180 req/window` and mutations to
`60 req/window` (visible in response headers `x-ratelimit-limit` /
`x-ratelimit-remaining`).

The `deposit()` method's endpoint path was inferred from the symmetric
`withdraw()` endpoint and the UI's mirrored "Einnahme"/"Ausgabe" buttons —
it was not directly observed in captured traffic. Verify before relying on
it in production.

## Contributing

Issues and PRs are welcome. This package covers only what's been reverse
engineered so far — if you find a new endpoint or a discrepancy, a PR to
[`discovery/endpoints.md`](./discovery/endpoints.md) plus a typed client
method is the most useful contribution.

## License

[MIT](./LICENSE)
