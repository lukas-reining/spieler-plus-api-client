/**
 * Shared response envelope types for the SpielerPlus Teamfund REST API.
 *
 * Responses loosely follow a JSON:API-inspired convention:
 * ```
 * { data: T | T[], links?: {...}, meta?: {...} }
 * ```
 * where each resource has `{ id, type, attributes }`.
 */

/** A single JSON:API-style resource: an id/type pair plus its attribute bag. */
export interface ResourceObject<TType extends string, TAttributes> {
  /** Opaque, server-assigned resource identifier (stringified snowflake-like id). */
  id: string;
  /** Discriminator matching the resource's kind, e.g. `"punishments"`, `"dues"`. */
  type: TType;
  /** The resource's actual data fields. */
  attributes: TAttributes;
}

/** Pagination navigation links, as returned alongside every collection response. */
export interface PaginationLinks {
  /** URL of the first page, or `null` if not applicable. */
  first: string | null;
  /** URL of the last page, or `null` if not applicable. */
  last: string | null;
  /** URL of the previous page, or `null` if already on the first page. */
  prev: string | null;
  /** URL of the next page, or `null` if already on the last page. */
  next: string | null;
}

/** A single entry in the Laravel-style pagination link list (`meta.links`). */
export interface PaginationLinkItem {
  /** Full URL for this page, or `null` for non-navigable labels (e.g. ellipsis). */
  url: string | null;
  /** Display label, e.g. `"1"`, `"&laquo; Previous"`. */
  label: string;
  /** 1-based page number this link points to, or `null` if not a page link. */
  page: number | null;
  /** Whether this link represents the currently active page. */
  active: boolean;
}

/** Laravel-style pagination metadata accompanying every collection response. */
export interface PaginationMeta {
  /** 1-based index of the current page. */
  current_page: number;
  /** 1-based index of the first item on the current page, or `null` if empty. */
  from: number | null;
  /** 1-based index of the last page available. */
  last_page: number;
  /** Rendered pagination link list (as used by server-side Laravel views). */
  links: PaginationLinkItem[];
  /** Base path of the paginated endpoint (without query string). */
  path: string;
  /** Number of items requested per page. */
  per_page: number;
  /** 1-based index of the last item on the current page, or `null` if empty. */
  to: number | null;
  /** Total number of items across all pages. */
  total: number;
}

/** Response envelope for endpoints returning exactly one resource. */
export interface SingleResourceResponse<TResource> {
  data: TResource;
}

/** Response envelope for endpoints returning a paginated collection of resources. */
export interface CollectionResponse<TResource> {
  data: TResource[];
  links: PaginationLinks;
  meta: PaginationMeta;
}

/** Query params accepted by every paginated list endpoint. */
export interface PageParams {
  /** 1-based page number to fetch. Defaults to `1` server-side if omitted. */
  page?: number;
}
