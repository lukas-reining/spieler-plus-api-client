import type { ResourceObject } from "./common.js";

/** A team role badge (e.g. "Trainer", "Kassenwart") shown next to a member. */
export interface MemberRole {
  id: string;
  /** Display name of the role, e.g. `"Trainer"`, `"Spieler"`, `"Kassenwart"`. */
  name: string;
  /** Hex color (e.g. `"#337ab7"`) used to render the role badge. */
  color: string;
}

/** Crop/zoom settings applied to a member avatar or team logo image. */
export interface MemberAvatarSettings {
  /** Rendered image size as `[width, height]` in pixels. */
  size: [number, number];
  /** Crop rectangle as `[left, top, right, bottom]` in source-image pixels. */
  points: [number, number, number, number];
  /** Zoom factor applied within the crop rectangle, or `null` if unset. */
  zoom: number | null;
  /** EXIF-style orientation value, or `null` if unset. */
  orientation: number | null;
}

/** A member's avatar image, or `null` if they have none set. */
export interface MemberAvatar {
  url: string;
  settings: MemberAvatarSettings;
}

/** A team member as embedded in Teamfund resources (dues, punishments, transactions, etc.). */
export interface TeamfundMember {
  id: string;
  /** Display name, possibly anonymized depending on the viewer's permissions. */
  name: string;
  /** Present on some endpoints; the member's un-anonymized display name. */
  original_name?: string | null;
  avatar: MemberAvatar | null;
  /** Team roles held by this member (e.g. Spieler, Trainer, Kassenwart). */
  roles: MemberRole[];
  /** ISO 8601 timestamp of when the member left the team, or `null` if still active. */
  left_team_at: string | null;
}

// -- me/context ---------------------------------------------------------

/** Core identity fields for the currently authenticated user/session. */
export interface MeContextIdentity {
  user_id: string;
  team_id: string;
  /** BCP-47-ish locale tag, e.g. `"de-DE"`. */
  language: string;
  /** IANA timezone name, e.g. `"Europe/Berlin"`. */
  timezone: string;
}

/** Basic profile info for the authenticated user. */
export interface MeContextUser {
  display_name: string;
  avatar: string | null;
}

/** Crop/zoom settings applied to a team's logo image. */
export interface MeContextTeamLogoSettings {
  size: [number, number];
  points: [number, number, number, number];
  zoom: number;
  orientation: number;
}

/** The active team as seen from the current user's membership. */
export interface MeContextTeam {
  id: string;
  name: string;
  sport: { type: string };
  /** The current user's membership details within this team. */
  membership: { shirt_number: string | null };
  logo: { url: string; settings: MeContextTeamLogoSettings } | null;
  photo: string | null;
  /** Whether the team currently has an active Premium subscription. */
  has_premium: boolean;
  gender: string;
}

/** Feature-flag-style capability map, keyed by feature name. */
export interface MeContextCapabilities {
  /** Whether each premium-gated feature is available to this team/user. */
  premium_features: Record<string, boolean>;
}

/** Attributes of the `me_context` resource: identity, active team, and capabilities. */
export interface MeContextAttributes {
  identity: MeContextIdentity;
  user: MeContextUser;
  team: MeContextTeam;
  capabilities: MeContextCapabilities;
}

/** Identity, active team, and permission context for the logged-in user. See {@link MeContextAttributes}. */
export type MeContextResource = ResourceObject<"me_context", MeContextAttributes>;

// -- teamfund (ledger) ----------------------------------------------------

/** Attributes of the `ledgers` resource: the team fund's current balance. */
export interface LedgerAttributes {
  /** ISO 4217 currency code, e.g. `"EUR"`. */
  currency_code: string;
  /** Number of decimal digits used by `currency_code` (typically `2`). */
  decimal_digits: number;
  status: "active" | string;
  /** Current balance in the smallest currency unit (e.g. cents). Can be negative. */
  balance_cents: number;
  /** ISO 8601 timestamp of when `balance_cents` was last recalculated. */
  balance_updated_at: string;
}

/** The team fund ledger (current balance). See {@link LedgerAttributes}. */
export type LedgerResource = ResourceObject<"ledgers", LedgerAttributes>;

// -- migration report -----------------------------------------------------

/** Progress/result of one phase of the legacy-cashbox-to-teamfund migration. */
export interface MigrationPhaseLog {
  started_at?: string;
  finished_at?: string;
  /** Pagination cursor for resumable phases, if applicable. */
  cursor?: number;
  batches_processed?: number;
  /** Free-form per-phase counters (e.g. `{ dues_created: 32 }`), or a raw array. */
  counts?: Record<string, number> | unknown[];
}

/** Attributes of the `migration-reports` resource. */
export interface MigrationReportAttributes {
  /** The team's id in the legacy (pre-Teamfund) cashbox system. */
  legacy_team_id: number;
  /** Id of the {@link LedgerResource} created by this migration. */
  ledger_id: string;
  status: "finished" | "running" | "failed" | string;
  started_at: string;
  finished_at: string | null;
  /** ISO 8601 timestamp of the most recent progress heartbeat, or `null` if not running. */
  last_heartbeat_at: string | null;
  /** Per-phase progress log, keyed by phase name (e.g. `"phase0"`, `"phase1"`, ...). */
  phase_log: Record<string, MigrationPhaseLog>;
  /** Internal processing lane/queue name, e.g. `"heavy"`. */
  lane: string;
}

/**
 * Status of the one-time migration from the legacy cashbox to the modern
 * Teamfund ledger. See {@link MigrationReportAttributes}.
 */
export type MigrationReportResource = ResourceObject<
  "migration-reports",
  MigrationReportAttributes
>;

// -- dues -------------------------------------------------------------------

/** Attributes of a `due_overviews` resource: one due period's aggregate payment progress. */
export interface DueOverviewAttributes {
  /** Short label, e.g. `"V Jul 26"` (Vollzahler) or `"T Jul 26"` (Teilzahler/ermäßigt). */
  name: string;
  /** Amount owed per member, in the smallest currency unit. */
  amount_cents: number;
  /** ISO 8601 date this due period is dated for. */
  due_date: string;
  /** Number of members this due currently applies to. */
  total_members: number;
  /** Number of members who have paid (or been exempted from) this due. */
  paid_members: number;
}

/** One due period with aggregate payment progress across the team. See {@link DueOverviewAttributes}. */
export type DueOverviewResource = ResourceObject<"due_overviews", DueOverviewAttributes>;

/** Attributes of a `due_member_overviews` resource: one member's aggregate due progress. */
export interface DueMemberOverviewAttributes {
  member: TeamfundMember;
  /** Total number of due periods assigned to this member. */
  total_dues: number;
  /** Number of those due periods the member has paid or been exempted from. */
  paid_dues: number;
}

/** One member's aggregate due payment progress across all due periods. See {@link DueMemberOverviewAttributes}. */
export type DueMemberOverviewResource = ResourceObject<
  "due_member_overviews",
  DueMemberOverviewAttributes
>;

// -- punishment catalog -----------------------------------------------------

/** Whether a punishment catalog entry is a monetary fine or a material (non-cash) punishment. */
export type PunishmentCatalogEntryType = "monetary" | "material";

/** Attributes of a `catalog_entries` resource: a reusable punishment/fine definition. */
export interface PunishmentCatalogEntryAttributes {
  /** Reason/label shown when assigning this punishment, e.g. `"Zu spät zum Training"`. */
  name: string;
  type: PunishmentCatalogEntryType;
  /** Default fine amount in the smallest currency unit; `null` for material entries. */
  amount_cents: number | null;
  /** Description of the material punishment (e.g. `"Kiste Bier"`); `null` for monetary entries. */
  subject: string | null;
  /** Whether the amount/subject can be customized per-assignment rather than using this default. */
  is_variable: boolean;
  /** Whether this entry has been archived (soft-hidden; new assignments blocked). */
  is_archived: boolean;
  /** Whether at least one punishment has ever used this catalog entry (blocks deletion if true). */
  has_assignments: boolean;
  created_at: string;
  updated_at: string;
}

/** A reusable punishment/fine definition available for assignment to members. See {@link PunishmentCatalogEntryAttributes}. */
export type PunishmentCatalogEntryResource = ResourceObject<
  "catalog_entries",
  PunishmentCatalogEntryAttributes
>;

// -- punishments --------------------------------------------------------

/** Payment status of a punishment or a due-related member payment. */
export type PunishmentStatus = "open" | "paid";

/** Attributes of a `punishments` resource: one punishment instance assigned to a member. */
export interface PunishmentAttributes {
  /** Resolved name from the source catalog entry at the time of assignment. */
  name: string;
  punishment_kind: PunishmentCatalogEntryType;
  member: TeamfundMember;
  /** Fine amount in the smallest currency unit; `null` for material punishments. */
  amount_cents: number | null;
  /** Portion of `amount_cents` already covered by allocated ledger transactions. */
  allocated_cents: number;
  /** Material punishment description; `null` for monetary punishments. */
  subject: string | null;
  status: PunishmentStatus;
  /** Whether this punishment instance has been archived. */
  is_archived: boolean;
  /** Id of the {@link PunishmentCatalogEntryResource} this punishment was assigned from. */
  catalog_entry_id: string;
  /** ISO 8601 date the punishment is dated for (when the infraction occurred). */
  date: string;
  /** ISO 8601 date the punishment was marked paid, or `null` if still open. */
  paid_date: string | null;
  /** Optional free-text note attached to this punishment. */
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** A punishment instance assigned to one member. See {@link PunishmentAttributes}. */
export type PunishmentResource = ResourceObject<"punishments", PunishmentAttributes>;

/** Attributes of the `punishment_summaries` resource: team-wide open-punishment aggregates. */
export interface PunishmentSummaryAttributes {
  /** Sum of `amount_cents` across all open monetary punishments. */
  total_open_monetary_amount_cents: number;
  /** Number of open monetary punishments. */
  total_open_monetary_count: number;
  /** Number of open material (non-cash) punishments. */
  total_open_material_count: number;
}

/** Aggregate summary of all currently open punishments for a team. See {@link PunishmentSummaryAttributes}. */
export type PunishmentSummaryResource = ResourceObject<
  "punishment_summaries",
  PunishmentSummaryAttributes
>;

// -- transactions -------------------------------------------------------

/** Whether a ledger transaction increases (`deposit`) or decreases (`withdrawal`) the balance. */
export type TransactionDirection = "deposit" | "withdrawal";

/** How much of a transaction's amount has been matched to punishments/dues it settles. */
export type TransactionAllocationStatus =
  | "fully_allocated"
  | "partially_allocated"
  | "unallocated"
  | string;

/** Attributes of a `transaction_allocations` resource: a link from a transaction to what it settles. */
export interface TransactionAllocationAttributes {
  /** Id of the parent ledger entry (matches {@link TransactionAttributes.entry_id}). */
  entry_id: string;
  /** Kind of resource this allocation settles. */
  source_type: "punishment" | "due" | string;
  /** Id of the punishment or due this allocation settles. */
  source_id: string;
  /** Portion of the transaction amount allocated to this source, in the smallest currency unit. */
  amount_cents: number;
  subject: string | null;
}

/** A single allocation of a transaction's amount toward a punishment or due. See {@link TransactionAllocationAttributes}. */
export type TransactionAllocationResource = ResourceObject<
  "transaction_allocations",
  TransactionAllocationAttributes
>;

/** Attributes of a `transactions` resource: one ledger movement (payment, fine, manual entry, or reversal). */
export interface TransactionAttributes {
  /** Id of the underlying ledger entry (used e.g. by {@link TeamfundClient.reverseEntry}). */
  entry_id: string;
  /** Human-readable description shown in the transaction feed. */
  subject: string;
  direction: TransactionDirection;
  /** Origin of the transaction, e.g. `"punishment"`, `"due"`, `"manual"`/`"direct"`. */
  type: "punishment" | "due" | "manual" | string;
  /** Absolute amount in the smallest currency unit (sign is conveyed by `direction`). */
  amount_cents: number;
  /** Portion of `amount_cents` matched to `allocations`. */
  allocated_cents: number;
  allocation_status: TransactionAllocationStatus;
  /** ISO 8601 date this transaction is booked on. */
  booking_date: string;
  /** Whether this transaction has since been reversed (stornoed). */
  is_reversed: boolean;
  /** If this transaction is itself a reversal, the `entry_id` of the entry it reverses; otherwise `null`. */
  reversal_of_entry_id: string | null;
  /** Breakdown of what this transaction's amount settles (punishments/dues), if any. */
  allocations: TransactionAllocationResource[];
  member: TeamfundMember;
  /** Id of the user who created this transaction. */
  created_by: { id: string };
  /** Reversal metadata, if this transaction has been reversed; otherwise `null`. */
  reversal: unknown | null;
  created_at: string;
}

/** A single ledger transaction (payment, fine settlement, manual entry, or reversal). See {@link TransactionAttributes}. */
export type TransactionResource = ResourceObject<"transactions", TransactionAttributes>;

// -- member balances ----------------------------------------------------

/** Attributes of a `member_balance_overviews` resource: one member's total outstanding balance. */
export interface MemberBalanceOverviewAttributes {
  member: TeamfundMember;
  /** Sum of all open (unpaid, non-exempted) dues + punishments owed by this member. */
  total_open_amount_cents: number;
}

/** One member's total outstanding balance across dues and punishments. See {@link MemberBalanceOverviewAttributes}. */
export type MemberBalanceOverviewResource = ResourceObject<
  "member_balance_overviews",
  MemberBalanceOverviewAttributes
>;

/** Attributes of a `member_balance_items` resource: one itemized due/punishment contributing to a member's balance. */
export interface MemberBalanceItemAttributes {
  type: "due" | "punishment";
  /** Id of the source due definition; `null` when `type` is `"punishment"`. */
  due_id: string | null;
  name: string;
  amount_cents: number | null;
  allocated_cents: number;
  subject: string | null;
  date: string;
  status: PunishmentStatus;
  paid_date: string | null;
}

/** One itemized due or punishment contributing to a member's outstanding balance. See {@link MemberBalanceItemAttributes}. */
export type MemberBalanceItemResource = ResourceObject<
  "member_balance_items",
  MemberBalanceItemAttributes
>;

// -- due member payments (mark-paid / exempt / revoke-exemption results) ----

/**
 * Payment status of one member's assignment to a due period. Unlike
 * {@link PunishmentStatus}, dues have a third state: `"exempted"` (excused,
 * no payment expected). The UI cycles through `open -> paid -> exempted ->
 * open` rather than offering a direct "mark unpaid" action.
 */
export type DueMemberPaymentStatus = "open" | "paid" | "exempted";

/** Attributes of a `due_member_payments` resource, returned by mark-paid/exempt/revoke-exemption. */
export interface DueMemberPaymentAttributes {
  member: TeamfundMember;
  status: DueMemberPaymentStatus;
  /** ISO 8601 date the due was marked paid, or `null` if not paid. */
  paid_date: string | null;
}

/** Result of a due mark-paid/exempt/revoke-exemption mutation for one member. See {@link DueMemberPaymentAttributes}. */
export type DueMemberPaymentResource = ResourceObject<
  "due_member_payments",
  DueMemberPaymentAttributes
>;

// -- per-member due list items (dues/members/{memberId}) -------------------

/** Attributes of a `member_due_list_items` resource: one due period as seen from a single member's perspective. */
export interface MemberDueListItemAttributes {
  name: string;
  amount_cents: number;
  due_date: string;
  status: DueMemberPaymentStatus;
  paid_date: string | null;
  allocated_cents: number;
}

/** One due period from a single member's itemized due list. See {@link MemberDueListItemAttributes}. */
export type MemberDueListItemResource = ResourceObject<
  "member_due_list_items",
  MemberDueListItemAttributes
>;

// -- per-due member statuses (dues/{dueId}/members) --------------------------

/** Attributes of a `due_member_statuses` resource: one member's payment status for a single due. */
export interface DueMemberStatusAttributes {
  member: TeamfundMember;
  status: DueMemberPaymentStatus;
  paid_date: string | null;
  allocated_cents: number;
}

/**
 * One team member's payment status for a single due definition, as returned
 * by {@link TeamfundClient.dueMemberStatuses}. Use this to enumerate exactly
 * which members are not `"open"` for a given due before bulk-reverting them.
 */
export type DueMemberStatusResource = ResourceObject<
  "due_member_statuses",
  DueMemberStatusAttributes
>;

// -- due definitions (dues catalog: /teamfund/dues) --------------------------

/** Attributes of a `dues` resource: a reusable due-period definition (e.g. "T Sep 25"). */
export interface DueDefinitionAttributes {
  /** Short label, e.g. `"T Sep 25"` or `"V Sep 25"`. */
  name: string;
  /** Amount owed per member, in the smallest currency unit. */
  amount_cents: number;
  /** ISO 8601 date this due period is dated for. Defaults to the creation date. */
  due_date: string;
  /** Whether this due has been archived (soft-hidden; still counted historically but no longer active). */
  is_archived: boolean;
  /** True once at least one member's assignment for this due has been touched (paid/exempted). */
  is_used: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A reusable due-period definition (e.g. "T Sep 25"). Creating one via
 * {@link TeamfundClient.createDueDefinition} immediately assigns it to every
 * current team member. See {@link DueDefinitionAttributes}.
 */
export type DueDefinitionResource = ResourceObject<"dues", DueDefinitionAttributes>;

// -- ledger entries (manual deposit/withdrawal) ------------------------------

/** Attributes of an `entries` resource: a manually recorded deposit or withdrawal. */
export interface LedgerEntryAttributes {
  /** Id of the {@link LedgerResource} this entry was posted against. */
  ledger_id: string;
  amount_cents: number;
  subject: string;
  member: TeamfundMember;
  created_by: { id: string };
  booking_date: string;
  direction: TransactionDirection;
  /** Entry creation mechanism, e.g. `"direct"` for manually-entered deposits/withdrawals. */
  type: "direct" | string;
  /** Origin of the entry, e.g. `"manual"` for user-initiated deposits/withdrawals. */
  source: "manual" | string;
}

/**
 * A manually recorded deposit or withdrawal, as returned by
 * {@link TeamfundClient.withdraw} / {@link TeamfundClient.deposit}.
 * See {@link LedgerEntryAttributes}.
 */
export type LedgerEntryResource = ResourceObject<"entries", LedgerEntryAttributes>;

// -- sync status ----------------------------------------------------------

/** Attributes of the `sync_status` resource: background-processing lag for async mutations. */
export interface SyncStatusAttributes {
  /** Estimated seconds of processing delay for recently-submitted async mutations. */
  delay_seconds: number;
}

/**
 * Background-processing status for the team's ledger. Poll this after
 * async (`202 Accepted`) mutations like mark-paid before relying on
 * freshly-updated aggregate data. See {@link SyncStatusAttributes}.
 */
export type SyncStatusResource = ResourceObject<"sync_status", SyncStatusAttributes>;

// -- member settings (visibility toggles) ------------------------------------

/** Attributes of a `member_settings` resource: per-member visibility toggles. */
export interface MemberSettingsAttributes {
  member: TeamfundMember;
  /** Whether this member appears in the "assign punishment" member picker. */
  visible_in_punishments: boolean;
  /** Whether this member appears in due-management member pickers/lists. */
  visible_in_dues: boolean;
}

/**
 * Per-member visibility toggles controlling whether they appear in
 * punishment/due assignment pickers, without removing them from the team.
 * See {@link MemberSettingsAttributes}.
 */
export type MemberSettingsResource = ResourceObject<"member_settings", MemberSettingsAttributes>;
