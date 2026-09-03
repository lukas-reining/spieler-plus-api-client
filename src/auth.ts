/**
 * Session management for the SpielerPlus API client.
 *
 * SpielerPlus's public product (www.spielerplus.de) runs on a legacy Yii2
 * backend that issues classic session cookies (remember-me + CSRF). The
 * modern Teamfund (Teamkasse) REST API, served from
 * teamplus-main.service.spielerplus.de, is authenticated separately via a
 * short-lived (~10 min) RS256 JWT that is *minted* from that Yii2 session.
 *
 * Flow:
 *   1. GET  /site/login          -> scrape the `_csrf` hidden field
 *   2. POST /site/login          -> authenticate, establishing session cookies
 *   3. GET  /auth/refresh-token  -> mint a fresh JWT ({ access_token })
 *   4. Use `Authorization: Bearer <access_token>` against the Teamfund API
 *
 * The JWT must be re-minted whenever it's close to expiry (we refresh with
 * a safety margin, mirroring the official frontend's own behavior).
 */

import { CookieJar } from "tough-cookie";
import fetchCookieBuilder from "fetch-cookie";

const WWW_BASE_URL = "https://www.spielerplus.de";
const REFRESH_TOKEN_PATH = "/auth/refresh-token";
const LOGIN_PATH = "/site/login";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

/** Safety margin (seconds) before expiry at which we proactively refresh. */
const REFRESH_SAFETY_MARGIN_SECONDS = 60;

export interface SpielerPlusCredentials {
  /** SpielerPlus account email address. */
  email: string;
  /** SpielerPlus account password. */
  password: string;
}

/** Decoded payload of the Teamfund API access token (JWT), as minted by `/auth/refresh-token`. */
export interface AccessTokenPayload {
  /** Always `"PlayerPlus"`. */
  iss: string;
  /** Always `["PlayerPlus"]`. */
  aud: string[];
  /** Token subject, always `"common"` for this token type. */
  sub: string;
  /** Expiry time, in Unix seconds. */
  exp: number;
  /** Issued-at time, in Unix seconds. */
  iat: number;
  /** Account id */
  spa: string;
  /** User id */
  spu: string;
  /** Active team id */
  spt: string;
  /** Permission scopes, e.g. "viewCashbox", "cudPunishment" */
  spp: string[];
  [key: string]: unknown;
}

export class SpielerPlusAuthError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SpielerPlusAuthError";
  }
}

/**
 * Decodes (without verifying) a JWT's payload. We never verify the
 * signature client-side -- we're just reading `exp`/`spt`/etc. from a token
 * that was already minted by the server for us.
 *
 * @param token A JWT string (`header.payload.signature`).
 * @returns The decoded payload, parsed as JSON.
 * @throws {SpielerPlusAuthError} If `token` doesn't look like a valid JWT.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new SpielerPlusAuthError(`Malformed JWT: expected 3 segments, got ${parts.length}`);
  }
  const payloadSegment = parts[1]!;
  const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
  return JSON.parse(json) as T;
}

function extractCsrfToken(html: string): string {
  // Yii2 renders: <input type="hidden" name="_csrf" value="...">
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!match) {
    throw new SpielerPlusAuthError(
      "Could not find _csrf token on login page; page markup may have changed.",
    );
  }
  return match[1]!;
}

/**
 * Manages an authenticated SpielerPlus session: cookie jar (Yii2 session +
 * remember-me) and the short-lived Teamfund API bearer token minted from it.
 */
export class SpielerPlusSession {
  private readonly jar: CookieJar;
  private readonly fetchWithCookies: typeof fetch;
  private readonly userAgent: string;

  private accessToken: string | null = null;
  private accessTokenPayload: AccessTokenPayload | null = null;
  private refreshInFlight: Promise<void> | null = null;

  constructor(options: { jar?: CookieJar; userAgent?: string } = {}) {
    this.jar = options.jar ?? new CookieJar();
    this.fetchWithCookies = fetchCookieBuilder(fetch, this.jar) as typeof fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  /** Exposes the underlying cookie jar, e.g. for persistence between runs. */
  getCookieJar(): CookieJar {
    return this.jar;
  }

  /** Team id embedded in the current access token, if minted. */
  get teamId(): string | null {
    return this.accessTokenPayload?.spt ?? null;
  }

  /** User id embedded in the current access token, if minted. */
  get userId(): string | null {
    return this.accessTokenPayload?.spu ?? null;
  }

  /** Permission scopes embedded in the current access token, if minted. */
  get scopes(): readonly string[] {
    return this.accessTokenPayload?.spp ?? [];
  }

  /**
   * Logs into www.spielerplus.de using the Yii2 login form, establishing
   * session cookies (including the long-lived remember-me cookie).
   *
   * @param credentials SpielerPlus account email + password.
   * @throws {SpielerPlusAuthError} If the login page can't be loaded, its
   * markup doesn't contain the expected CSRF field, or the credentials are rejected.
   */
  async login(credentials: SpielerPlusCredentials): Promise<void> {
    const loginPageResponse = await this.fetchWithCookies(`${WWW_BASE_URL}${LOGIN_PATH}`, {
      headers: { "user-agent": this.userAgent },
    });
    if (!loginPageResponse.ok) {
      throw new SpielerPlusAuthError(
        `Failed to load login page (status ${loginPageResponse.status})`,
      );
    }
    const html = await loginPageResponse.text();
    const csrfToken = extractCsrfToken(html);

    const body = new URLSearchParams({
      _csrf: csrfToken,
      "LoginForm[email]": credentials.email,
      "LoginForm[password]": credentials.password,
    });

    const loginResponse = await this.fetchWithCookies(`${WWW_BASE_URL}${LOGIN_PATH}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "user-agent": this.userAgent,
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html,application/xhtml+xml",
        referer: `${WWW_BASE_URL}${LOGIN_PATH}`,
      },
      body: body.toString(),
    });

    // Yii2 responds with a redirect (302) on success. On failure it
    // re-renders the login page with a 200 and validation errors.
    const isRedirect = loginResponse.status >= 300 && loginResponse.status < 400;
    if (!isRedirect) {
      const failureHtml = await loginResponse.text().catch(() => "");
      const looksLikeStillOnLogin = failureHtml.includes('name="LoginForm[email]"');
      if (looksLikeStillOnLogin) {
        throw new SpielerPlusAuthError(
          "Login failed: invalid credentials or unexpected login form response.",
        );
      }
    }
  }

  /**
   * Mints (or re-mints) the Teamfund API access token from the current
   * Yii2 session. Requires a prior successful `login()` (or a cookie jar
   * seeded with a valid session). Concurrent calls are coalesced into a
   * single in-flight refresh.
   *
   * @throws {SpielerPlusAuthError} If the refresh request fails or the
   * session has no valid Yii2 cookies (call `login()` again in that case).
   */
  async refreshAccessToken(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.doRefreshAccessToken().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefreshAccessToken(): Promise<void> {
    const response = await this.fetchWithCookies(`${WWW_BASE_URL}${REFRESH_TOKEN_PATH}`, {
      headers: {
        "user-agent": this.userAgent,
        accept: "application/json",
        referer: `${WWW_BASE_URL}/`,
      },
    });
    if (!response.ok) {
      throw new SpielerPlusAuthError(
        `Failed to refresh access token (status ${response.status}). Session may have expired; call login() again.`,
      );
    }
    const data = (await response.json().catch(() => null)) as { access_token?: string } | null;
    if (!data?.access_token) {
      throw new SpielerPlusAuthError(
        "Refresh-token endpoint returned no access_token; session may not be authenticated.",
      );
    }
    this.accessToken = data.access_token;
    this.accessTokenPayload = decodeJwtPayload<AccessTokenPayload>(data.access_token);
  }

  /**
   * Returns a valid bearer token, refreshing it first if it's missing or
   * close to expiry.
   *
   * @returns The current (or freshly minted) JWT access token string.
   * @throws {SpielerPlusAuthError} If no token could be minted (see {@link refreshAccessToken}).
   */
  async getAccessToken(): Promise<string> {
    if (!this.accessToken || this.isAccessTokenStale()) {
      await this.refreshAccessToken();
    }
    if (!this.accessToken) {
      throw new SpielerPlusAuthError("No access token available after refresh.");
    }
    return this.accessToken;
  }

  private isAccessTokenStale(): boolean {
    if (!this.accessTokenPayload) return true;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return this.accessTokenPayload.exp - nowSeconds <= REFRESH_SAFETY_MARGIN_SECONDS;
  }

  /**
   * Performs an authenticated fetch, attaching the bearer token and
   * retrying once after a forced token refresh on a 401 response (mirrors
   * the official frontend's own retry-once-on-401 behavior).
   *
   * @param url Fully-qualified request URL.
   * @param init Standard `fetch` options; `headers.authorization` is
   * overridden with the current bearer token.
   * @returns The raw `Response` (not parsed); callers are responsible for
   * checking `response.ok` and parsing the body.
   */
  async authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const doFetch = (bearer: string) =>
      this.fetchWithCookies(url, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${bearer}`,
          accept: init.headers && "accept" in init.headers ? undefined : "*/*",
          "user-agent": this.userAgent,
          "x-locale": "de",
          origin: WWW_BASE_URL,
          referer: `${WWW_BASE_URL}/`,
        } as HeadersInit,
      });

    let response = await doFetch(token);
    if (response.status === 401) {
      await this.refreshAccessToken();
      const freshToken = await this.getAccessToken();
      response = await doFetch(freshToken);
    }
    return response;
  }
}
