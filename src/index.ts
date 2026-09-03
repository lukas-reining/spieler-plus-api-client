export {
  SpielerPlusSession,
  SpielerPlusAuthError,
  decodeJwtPayload,
  type SpielerPlusCredentials,
  type AccessTokenPayload,
} from "./auth.js";

export { TeamfundClient, SpielerPlusApiError } from "./teamfund-client.js";

export * from "./types/common.js";
export * from "./types/teamfund.js";

import { SpielerPlusSession, type SpielerPlusCredentials } from "./auth.js";
import { TeamfundClient } from "./teamfund-client.js";

/**
 * Convenience factory: logs in and returns a ready-to-use Teamfund client.
 *
 * Equivalent to manually constructing a {@link SpielerPlusSession}, calling
 * {@link SpielerPlusSession.login} and {@link SpielerPlusSession.getAccessToken},
 * then wrapping it in a {@link TeamfundClient}.
 *
 * @param credentials SpielerPlus account email + password.
 * @returns The authenticated session (useful for inspecting `teamId`,
 * `userId`, `scopes`, or persisting the cookie jar) and a ready-to-use client.
 * @throws {SpielerPlusAuthError} If login fails or the access token cannot be minted.
 *
 * @example
 * ```ts
 * const { client } = await createSpielerPlusClient({
 *   email: "you@example.com",
 *   password: process.env.SPIELERPLUS_PASSWORD!,
 * });
 * const ledger = await client.ledger();
 * ```
 */
export async function createSpielerPlusClient(
  credentials: SpielerPlusCredentials,
): Promise<{ session: SpielerPlusSession; client: TeamfundClient }> {
  const session = new SpielerPlusSession();
  await session.login(credentials);
  await session.getAccessToken();
  const client = new TeamfundClient(session);
  return { session, client };
}
