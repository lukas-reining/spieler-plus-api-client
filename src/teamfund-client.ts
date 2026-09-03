import type { SpielerPlusSession } from "./auth.js";
import type { CollectionResponse, PageParams, SingleResourceResponse } from "./types/common.js";
import type {
  DueDefinitionResource,
  DueMemberOverviewResource,
  DueMemberPaymentResource,
  DueMemberStatusResource,
  DueOverviewResource,
  LedgerEntryResource,
  LedgerResource,
  MeContextResource,
  MemberBalanceItemResource,
  MemberBalanceOverviewResource,
  MemberDueListItemResource,
  MemberSettingsResource,
  MigrationReportResource,
  PunishmentCatalogEntryResource,
  PunishmentResource,
  PunishmentSummaryResource,
  SyncStatusResource,
  TransactionResource,
} from "./types/teamfund.js";

const API_BASE_URL = "https://teamplus-main.service.spielerplus.de/api/v1";

/**
 * Thrown when a {@link TeamfundClient} request receives a non-2xx response.
 * Carries the HTTP status and parsed error body (if any) for inspection.
 */
export class SpielerPlusApiError extends Error {
  constructor(
    message: string,
    /** HTTP status code returned by the API. */
    readonly status: number,
    /** Parsed JSON error body, if the response included one. */
    readonly body: unknown,
  ) {
    super(message);
    this.name = "SpielerPlusApiError";
  }
}

/** Params for {@link TeamfundClient.punishmentCatalog}. */
export interface PunishmentCatalogParams extends PageParams {
  /** Filter to archived (`true`) or active (`false`) catalog entries. */
  is_archived?: boolean;
}

/** Params for {@link TeamfundClient.dueDefinitions}. */
export interface DueDefinitionsParams extends PageParams {
  /** Filter to archived (`true`) or active (`false`) due definitions. */
  is_archived?: boolean;
}

/** Params for {@link TeamfundClient.memberBalanceItems}. */
export interface MemberBalanceItemsParams extends PageParams {
  /** Filter items to only `"open"` or only `"paid"`; omit to return both. */
  status?: "open" | "paid";
}

/** Params for {@link TeamfundClient.memberDueList}. Currently just pagination. */
export interface MemberDueListParams extends PageParams {}

/** Body for {@link TeamfundClient.assignPunishment}. */
export interface AssignPunishmentParams {
  /** Id of the {@link PunishmentCatalogEntryResource} to assign. */
  catalog_entry_id: string;
  /** ISO 8601 date the punishment is dated for. */
  date: string;
  /** Ids of the members to assign this punishment to (one punishment instance is created per member). */
  user_ids: string[];
  /** Override the catalog entry's default amount. Pass `null`/omit to use the catalog default. */
  amount_cents?: number | null;
  /** Override the catalog entry's default subject (used for material punishments). */
  subject?: string | null;
  /** Optional free-text note attached to the created punishment(s). */
  note?: string | null;
}

/** Body for {@link TeamfundClient.updatePunishment}. All fields optional; only provided fields are changed. */
export interface UpdatePunishmentParams {
  /** New ISO 8601 date for the punishment. */
  date?: string;
  /** Re-point this punishment at a different {@link PunishmentCatalogEntryResource}. */
  catalog_entry_id?: string;
}

/** Body for {@link TeamfundClient.createPunishmentCatalogEntry} / {@link TeamfundClient.updatePunishmentCatalogEntry}. */
export interface CreatePunishmentCatalogEntryParams {
  /** Reason/label shown when assigning this punishment. */
  name: string;
  type: "monetary" | "material";
  /** Whether the amount/subject can be customized per-assignment. */
  is_variable: boolean;
  /** Required for monetary, non-variable entries; pass `null` for material/variable entries. */
  amount_cents?: number | null;
  /** Used for material entries, e.g. `"Kiste Bier"`. */
  subject?: string | null;
}

/** Body for {@link TeamfundClient.updatePunishmentCatalogEntry}. Same shape as creation (full replace, not partial patch). */
export type UpdatePunishmentCatalogEntryParams = CreatePunishmentCatalogEntryParams;

/** Body for {@link TeamfundClient.createDueDefinition}. */
export interface CreateDueDefinitionParams {
  /** Short label, e.g. `"T Sep 26"`. */
  name: string;
  /** Amount owed per member, in the smallest currency unit. */
  amount_cents: number;
}

/** Body for {@link TeamfundClient.withdraw} / {@link TeamfundClient.deposit}. */
export interface WithdrawParams {
  /** Absolute amount in the smallest currency unit (always positive; direction is implied by the method). */
  amount_cents: number;
  /** Human-readable description shown in the transaction feed. */
  subject: string;
  /** ISO 8601 date to book this entry on. */
  booking_date: string;
  /** Member to attribute this entry to (typically the acting user unless otherwise specified). */
  member_id: string;
}

/** Symmetric counterpart to {@link WithdrawParams}; endpoint path is inferred, not directly verified. */
export type DepositParams = WithdrawParams;

/** Serializes a plain params object into a `?key=value&...` query string, skipping `undefined` values. */
function buildQuery<T extends object>(params: T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * Typed client for the SpielerPlus Teamfund (Teamkasse) REST API.
 *
 * All requests are scoped to a single team, resolved from the session's
 * current access token (`session.teamId`) unless overridden per-call via
 * the trailing `teamId` parameter.
 *
 * Mutating methods are rate-limited more tightly by the server than reads
 * (observed: 60 requests per window vs. 180 for GETs). Several mutations
 * (e.g. mark-paid, punishment assignment) return `202 Accepted` and process
 * asynchronously; poll {@link TeamfundClient.syncStatus} or re-fetch the
 * affected resource after a short delay if you need to observe the result
 * before issuing a dependent follow-up mutation (the API rejects premature
 * follow-ups with `422`). See `scripts/smoke-test.ts` for a working
 * poll-and-retry pattern.
 *
 * @example
 * ```ts
 * const { client } = await createSpielerPlusClient({ email, password });
 * const ledger = await client.ledger();
 * await client.markPunishmentPaid(punishmentId);
 * ```
 */
export class TeamfundClient {
  constructor(private readonly session: SpielerPlusSession) {}

  /**
   * Resolves the team id to use for a request: the explicit `teamId`
   * argument if provided, otherwise the team embedded in the session's
   * current access token.
   *
   * @throws {Error} If no `teamId` is provided and the session has no
   * active team (i.e. {@link SpielerPlusSession.getAccessToken} was never called).
   */
  private resolveTeamId(teamId?: string): string {
    const resolved = teamId ?? this.session.teamId;
    if (!resolved) {
      throw new Error(
        "No team id available. Call session.getAccessToken() first, or pass teamId explicitly.",
      );
    }
    return resolved;
  }

  /**
   * Performs an authenticated request against the Teamfund API and parses
   * the JSON response.
   *
   * @throws {SpielerPlusApiError} If the response status is not in the 2xx range.
   */
  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const method = init.method ?? "GET";
    const response = await this.session.authenticatedFetch(`${API_BASE_URL}${path}`, {
      method,
      headers:
        init.body !== undefined
          ? { accept: "application/json", "content-type": "application/json" }
          : { accept: "application/json" },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw new SpielerPlusApiError(
        `SpielerPlus API request failed: ${method} ${path} -> ${response.status}`,
        response.status,
        body,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  // -- Reads ----------------------------------------------------------

  /**
   * Fetches identity, active team, and permission context for the logged-in user.
   *
   * @param teamId Team id override; defaults to the session's current team.
   */
  meContext(teamId?: string): Promise<SingleResourceResponse<MeContextResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/me/context`);
  }

  /**
   * Fetches the team fund ledger, including its current balance.
   *
   * @param teamId Team id override; defaults to the session's current team.
   */
  ledger(teamId?: string): Promise<SingleResourceResponse<LedgerResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund`);
  }

  /**
   * Fetches the status of the one-time legacy-cashbox-to-teamfund migration for this team.
   *
   * @param teamId Team id override; defaults to the session's current team.
   */
  migrationReport(teamId?: string): Promise<SingleResourceResponse<MigrationReportResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/migration/reports/current`);
  }

  /**
   * Fetches background-processing status; poll this after async (`202`) mutations
   * before relying on freshly-updated aggregate data.
   *
   * @param teamId Team id override; defaults to the session's current team.
   */
  syncStatus(teamId?: string): Promise<SingleResourceResponse<SyncStatusResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/sync-status`);
  }

  /**
   * Fetches a page of the ledger transaction history.
   *
   * @param params Pagination params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  transactions(
    params: PageParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<TransactionResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/transactions${buildQuery(params)}`,
    );
  }

  /**
   * Fetches a single transaction by id.
   *
   * @param transactionId The transaction resource's own `id` (not its `entry_id`).
   * @param teamId Team id override; defaults to the session's current team.
   */
  transaction(
    transactionId: string,
    teamId?: string,
  ): Promise<SingleResourceResponse<TransactionResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/transactions/${transactionId}`,
    );
  }

  /**
   * Fetches a page of due periods (e.g. monthly dues) with team-wide payment progress.
   *
   * @param params Pagination params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  duesOverview(
    params: PageParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<DueOverviewResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/dues/overview${buildQuery(params)}`,
    );
  }

  /**
   * Fetches a page of per-member due payment progress across the team.
   *
   * @param params Pagination params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  duesMembers(
    params: PageParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<DueMemberOverviewResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/dues/members${buildQuery(params)}`,
    );
  }

  /**
   * Fetches a single member's itemized due list.
   *
   * @param memberId Id of the member whose dues to list.
   * @param params Pagination params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  memberDueList(
    memberId: string,
    params: MemberDueListParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<MemberDueListItemResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/dues/members/${memberId}${buildQuery(params)}`,
    );
  }

  /**
   * Fetches a page of due *definitions* (the reusable due "types", e.g. `"T Sep 25"`),
   * as distinct from per-member due assignments. See {@link duesOverview} for
   * team-wide progress or {@link memberDueList} for one member's assignments.
   *
   * @param params Pagination + archive-filter params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  dueDefinitions(
    params: DueDefinitionsParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<DueDefinitionResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/dues${buildQuery(params)}`);
  }

  /**
   * Fetches every team member's payment status for a single due definition.
   *
   * @remarks Use this before bulk-reverting a used due (e.g. prior to
   * {@link deleteDueDefinition}): it directly enumerates which members are
   * `"paid"` or `"exempted"` for that due, without having to cross-reference
   * {@link memberDueList} for every member by name.
   * @param dueId Id of the due definition to inspect.
   * @param params Pagination params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  dueMemberStatuses(
    dueId: string,
    params: PageParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<DueMemberStatusResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/dues/${dueId}/members${buildQuery(params)}`,
    );
  }

  /**
   * Fetches a page of the punishment catalog (fine/material definitions).
   *
   * @param params Pagination + archive-filter params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  punishmentCatalog(
    params: PunishmentCatalogParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<PunishmentCatalogEntryResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/punishment-catalog${buildQuery(params)}`,
    );
  }

  /**
   * Fetches the aggregate summary of open punishments (monetary total + counts).
   *
   * @param teamId Team id override; defaults to the session's current team.
   */
  punishmentsSummary(teamId?: string): Promise<SingleResourceResponse<PunishmentSummaryResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/punishments/summary`);
  }

  /**
   * Fetches a page of assigned punishments.
   *
   * @param params Pagination params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  punishments(
    params: PageParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<PunishmentResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/punishments${buildQuery(params)}`,
    );
  }

  /**
   * Fetches a single punishment by id.
   *
   * @param punishmentId Id of the punishment to fetch.
   * @param teamId Team id override; defaults to the session's current team.
   */
  punishment(
    punishmentId: string,
    teamId?: string,
  ): Promise<SingleResourceResponse<PunishmentResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/punishments/${punishmentId}`);
  }

  /**
   * Fetches a page of per-member outstanding balance overviews.
   *
   * @param params Pagination params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  memberBalances(
    params: PageParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<MemberBalanceOverviewResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/member-balances${buildQuery(params)}`,
    );
  }

  /**
   * Fetches the itemized list of open/paid dues & punishments contributing
   * to one member's outstanding balance.
   *
   * @param memberId Id of the member whose balance items to list.
   * @param params Pagination + status-filter params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  memberBalanceItems(
    memberId: string,
    params: MemberBalanceItemsParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<MemberBalanceItemResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/member-balances/${memberId}${buildQuery(params)}`,
    );
  }

  /**
   * Fetches a page of per-member visibility toggles for punishments/dues pickers.
   *
   * @param params Pagination params.
   * @param teamId Team id override; defaults to the session's current team.
   */
  memberSettings(
    params: PageParams = {},
    teamId?: string,
  ): Promise<CollectionResponse<MemberSettingsResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/member-settings${buildQuery(params)}`,
    );
  }

  // -- Due mutations ----------------------------------------------------

  /**
   * Marks one member's due as paid.
   *
   * @remarks Returns `202 Accepted`; the ledger balance and aggregate
   * summaries update shortly after. Poll {@link syncStatus} or re-fetch
   * before relying on updated totals.
   * @param dueId Id of the due definition being paid.
   * @param memberId Id of the member who paid.
   * @param paidDate ISO 8601 date the payment is recorded for.
   * @param teamId Team id override; defaults to the session's current team.
   */
  markDuePaid(
    dueId: string,
    memberId: string,
    paidDate: string,
    teamId?: string,
  ): Promise<{ data: { entry_id: string } }> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/dues/${dueId}/members/${memberId}/mark-paid`,
      { method: "POST", body: { paid_date: paidDate } },
    );
  }

  /**
   * Marks a member's due as exempted (excused, no payment expected).
   *
   * @remarks There is no direct "mark unpaid" for dues; the UI cycles
   * `open -> paid -> exempted -> open`. Use {@link revokeDueExemption} to
   * return an exempted due to `"open"`.
   *
   * **⚠️ Financial side effect**: if the member's due is currently `"paid"`,
   * calling this reverses the underlying deposit transaction created by
   * {@link markDuePaid} -- the team fund's ledger balance decreases by the
   * due's amount. This is a real financial reversal, not a cosmetic status
   * change. Confirmed at scale: reverting ~200 paid dues (e.g. before bulk
   * {@link deleteDueDefinition} calls) measurably reduced a live ledger balance.
   * @param dueId Id of the due definition to exempt.
   * @param memberId Id of the member to exempt.
   * @param teamId Team id override; defaults to the session's current team.
   */
  exemptMemberDue(
    dueId: string,
    memberId: string,
    teamId?: string,
  ): Promise<SingleResourceResponse<DueMemberPaymentResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/dues/${dueId}/members/${memberId}/exempt`,
      { method: "POST" },
    );
  }

  /**
   * Reverts a due exemption back to `"open"` for one member.
   *
   * @param dueId Id of the due definition to revert.
   * @param memberId Id of the member whose exemption to revoke.
   * @param teamId Team id override; defaults to the session's current team.
   */
  revokeDueExemption(
    dueId: string,
    memberId: string,
    teamId?: string,
  ): Promise<SingleResourceResponse<DueMemberPaymentResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/dues/${dueId}/members/${memberId}/revoke-exemption`,
      { method: "POST" },
    );
  }

  /**
   * Creates a new due definition. This immediately assigns it (status
   * `"open"`) to every current team member -- there is no separate "assign
   * to roster" step.
   *
   * @param params Name and amount for the new due.
   * @param teamId Team id override; defaults to the session's current team.
   */
  createDueDefinition(
    params: CreateDueDefinitionParams,
    teamId?: string,
  ): Promise<SingleResourceResponse<DueDefinitionResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/dues`, {
      method: "POST",
      body: params,
    });
  }

  /**
   * Permanently deletes a due definition (cascades to remove it from all members).
   *
   * @remarks Only available while `is_used: false` (no member has paid or
   * been exempted from it yet). Once used, call {@link archiveDueDefinition}
   * instead -- **archiving preserves payment history, deletion does not.**
   *
   * If you force `is_used` back to `false` by reverting every member's
   * status via {@link exemptMemberDue} + {@link revokeDueExemption} first,
   * be aware that reverting a `"paid"` member also reverses their deposit
   * transaction (see {@link exemptMemberDue}'s financial-side-effect note).
   * Deleting a due this way after clearing its payments will reduce the
   * ledger balance by the sum of what was paid -- this is a real, permanent
   * loss of both the due record and its payment history, not just a status reset.
   * @param dueId Id of the due definition to delete.
   * @param teamId Team id override; defaults to the session's current team.
   * @throws {SpielerPlusApiError} With status `422` if the due has already been used.
   */
  deleteDueDefinition(dueId: string, teamId?: string): Promise<void> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/dues/${dueId}`, {
      method: "DELETE",
    });
  }

  /**
   * Archives a due definition, removing it from every member's active due
   * list without deleting its payment history.
   *
   * @remarks Required once a due has at least one payment/exemption --
   * {@link deleteDueDefinition} is blocked in that case.
   * @param dueId Id of the due definition to archive.
   * @param teamId Team id override; defaults to the session's current team.
   */
  archiveDueDefinition(
    dueId: string,
    teamId?: string,
  ): Promise<SingleResourceResponse<DueDefinitionResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/dues/${dueId}/archive`, {
      method: "POST",
    });
  }

  /**
   * Reactivates an archived due definition, restoring it to every member's
   * active due list.
   *
   * @param dueId Id of the due definition to reactivate.
   * @param teamId Team id override; defaults to the session's current team.
   */
  unarchiveDueDefinition(
    dueId: string,
    teamId?: string,
  ): Promise<SingleResourceResponse<DueDefinitionResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/dues/${dueId}/unarchive`, {
      method: "POST",
    });
  }

  // -- Punishment mutations -----------------------------------------------

  /**
   * Assigns a catalog punishment to one or more members, creating one
   * punishment instance per member.
   *
   * @remarks Returns `202 Accepted` and fans out asynchronously; the newly
   * created punishments may not appear in {@link punishments} immediately.
   * @param params Catalog entry, date, and target members.
   * @param teamId Team id override; defaults to the session's current team.
   */
  assignPunishment(
    params: AssignPunishmentParams,
    teamId?: string,
  ): Promise<{ data: { accepted: number; user_ids: string[] } }> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/punishments`, {
      method: "POST",
      body: {
        catalog_entry_id: params.catalog_entry_id,
        date: params.date,
        user_ids: params.user_ids,
        amount_cents: params.amount_cents ?? null,
        subject: params.subject ?? null,
        note: params.note ?? null,
      },
    });
  }

  /**
   * Edits an existing punishment's date and/or catalog entry.
   *
   * @remarks Only available for open, non-archived punishments.
   * @param punishmentId Id of the punishment to edit.
   * @param params Fields to update (only provided fields are changed).
   * @param teamId Team id override; defaults to the session's current team.
   * @throws {SpielerPlusApiError} With status `422` if the punishment is paid or archived.
   */
  updatePunishment(
    punishmentId: string,
    params: UpdatePunishmentParams,
    teamId?: string,
  ): Promise<SingleResourceResponse<PunishmentResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/punishments/${punishmentId}`, {
      method: "PATCH",
      body: params,
    });
  }

  /**
   * Marks a punishment as paid.
   *
   * @remarks Returns `202 Accepted` and processes asynchronously; poll
   * {@link punishment} until `status` reflects `"paid"` before chaining a
   * dependent mutation (e.g. {@link markPunishmentUnpaid} or {@link deletePunishment}).
   * @param punishmentId Id of the punishment to mark paid.
   * @param teamId Team id override; defaults to the session's current team.
   */
  markPunishmentPaid(
    punishmentId: string,
    teamId?: string,
  ): Promise<{ data: { entry_id: string } }> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/punishments/${punishmentId}/mark-paid`,
      { method: "POST" },
    );
  }

  /**
   * Reverts a punishment to open/unpaid.
   *
   * @remarks Returns `202 Accepted` and processes asynchronously; calling
   * this (or a dependent mutation like {@link deletePunishment}) before the
   * underlying settlement transaction exists yet returns `422`. Poll
   * {@link punishment} until `status` reflects `"open"` first.
   * @param punishmentId Id of the punishment to revert.
   * @param teamId Team id override; defaults to the session's current team.
   */
  markPunishmentUnpaid(punishmentId: string, teamId?: string): Promise<void> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/punishments/${punishmentId}/mark-unpaid`,
      { method: "POST" },
    );
  }

  /**
   * Permanently deletes a punishment.
   *
   * @remarks Only available while the punishment is open/unarchived; paid
   * punishments must first be reverted via {@link markPunishmentUnpaid}
   * (and that reversion must have fully processed) before deletion.
   * @param punishmentId Id of the punishment to delete.
   * @param teamId Team id override; defaults to the session's current team.
   * @throws {SpielerPlusApiError} With status `422` if the punishment is currently paid.
   */
  deletePunishment(punishmentId: string, teamId?: string): Promise<void> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/punishments/${punishmentId}`, {
      method: "DELETE",
    });
  }

  // -- Punishment catalog mutations -----------------------------------------

  /**
   * Creates a new punishment catalog entry.
   *
   * @param params Name, type, and default amount/subject for the new entry.
   * @param teamId Team id override; defaults to the session's current team.
   */
  createPunishmentCatalogEntry(
    params: CreatePunishmentCatalogEntryParams,
    teamId?: string,
  ): Promise<SingleResourceResponse<PunishmentCatalogEntryResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/punishment-catalog`, {
      method: "POST",
      body: params,
    });
  }

  /**
   * Edits a punishment catalog entry (full replace, not a partial patch).
   *
   * @remarks Only available while the entry is not archived.
   * @param catalogEntryId Id of the catalog entry to edit.
   * @param params Full replacement field set (same shape as creation).
   * @param teamId Team id override; defaults to the session's current team.
   */
  updatePunishmentCatalogEntry(
    catalogEntryId: string,
    params: UpdatePunishmentCatalogEntryParams,
    teamId?: string,
  ): Promise<SingleResourceResponse<PunishmentCatalogEntryResource>> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/punishment-catalog/${catalogEntryId}`,
      { method: "PATCH", body: params },
    );
  }

  /**
   * Permanently deletes a catalog entry.
   *
   * @remarks Only available when the entry has no punishment assignments
   * (`has_assignments: false`). Use {@link archivePunishmentCatalogEntry}
   * for entries that have been used.
   * @param catalogEntryId Id of the catalog entry to delete.
   * @param teamId Team id override; defaults to the session's current team.
   */
  deletePunishmentCatalogEntry(catalogEntryId: string, teamId?: string): Promise<void> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/punishment-catalog/${catalogEntryId}`,
      { method: "DELETE" },
    );
  }

  /**
   * Archives a catalog entry, soft-hiding it from the active list and
   * preventing further assignment (existing punishments are unaffected).
   *
   * @param catalogEntryId Id of the catalog entry to archive.
   * @param teamId Team id override; defaults to the session's current team.
   */
  archivePunishmentCatalogEntry(catalogEntryId: string, teamId?: string): Promise<void> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/punishment-catalog/${catalogEntryId}/archive`,
      { method: "POST" },
    );
  }

  /**
   * Reactivates an archived catalog entry, making it available for assignment again.
   *
   * @param catalogEntryId Id of the catalog entry to reactivate.
   * @param teamId Team id override; defaults to the session's current team.
   */
  unarchivePunishmentCatalogEntry(catalogEntryId: string, teamId?: string): Promise<void> {
    return this.request(
      `/teams/${this.resolveTeamId(teamId)}/teamfund/punishment-catalog/${catalogEntryId}/unarchive`,
      { method: "POST" },
    );
  }

  // -- Ledger entry mutations -----------------------------------------------

  /**
   * Records a manual expense (withdrawal) against the team fund.
   *
   * @param params Amount, subject, booking date, and attributed member.
   * @param teamId Team id override; defaults to the session's current team.
   */
  withdraw(
    params: WithdrawParams,
    teamId?: string,
  ): Promise<SingleResourceResponse<LedgerEntryResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/entries/withdraw`, {
      method: "POST",
      body: params,
    });
  }

  /**
   * Records a manual income (deposit) against the team fund.
   *
   * @remarks Inferred from the symmetric "Einnahme" UI button and the
   * `withdraw` endpoint's naming convention; this endpoint was **not**
   * directly observed in captured traffic. Verify against a live account
   * before relying on it in production, and please report back if the
   * path or response shape differs.
   * @param params Amount, subject, booking date, and attributed member.
   * @param teamId Team id override; defaults to the session's current team.
   */
  deposit(
    params: DepositParams,
    teamId?: string,
  ): Promise<SingleResourceResponse<LedgerEntryResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/entries/deposit`, {
      method: "POST",
      body: params,
    });
  }

  /**
   * Reverses (stornos) a ledger entry. Creates a new offsetting transaction
   * rather than deleting the original -- the audit trail is preserved, so
   * the transaction count increases by one and the net balance effect cancels out.
   *
   * @param entryId The transaction's `entry_id` field (**not** its own resource `id`).
   * @param reason Required human-readable reason for the reversal, shown in the UI.
   * @param teamId Team id override; defaults to the session's current team.
   */
  reverseEntry(
    entryId: string,
    reason: string,
    teamId?: string,
  ): Promise<SingleResourceResponse<TransactionResource>> {
    return this.request(`/teams/${this.resolveTeamId(teamId)}/teamfund/entries/${entryId}/reverse`, {
      method: "POST",
      body: { reason },
    });
  }
}
