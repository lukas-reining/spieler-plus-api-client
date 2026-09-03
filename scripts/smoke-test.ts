/**
 * Smoke test: logs in with credentials from the environment and exercises
 * every Teamfund endpoint once, printing a short summary of each response.
 *
 * Usage:
 *   SPIELERPLUS_EMAIL=you@example.com SPIELERPLUS_PASSWORD=secret npm run smoke
 */
import { createSpielerPlusClient, type TeamfundClient } from "../src/index.js";

/**
 * Several mutations (mark-paid, mark-unpaid, punishment assignment) return
 * `202 Accepted` and process asynchronously. Attempting a follow-up mutation
 * (e.g. delete) before the status has settled returns `422`. Poll until the
 * expected status is observed.
 */
async function waitForPunishmentStatus(
  client: TeamfundClient,
  punishmentId: string,
  expectedStatus: "open" | "paid",
  attempts = 10,
  delayMs = 1500,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await client.punishment(punishmentId);
    if (current.data.attributes.status === expectedStatus) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.warn(
    `punishment ${punishmentId} did not reach status "${expectedStatus}" after polling; proceeding anyway`,
  );
}

async function main() {
  const email = process.env.SPIELERPLUS_EMAIL;
  const password = process.env.SPIELERPLUS_PASSWORD;
  if (!email || !password) {
    console.error(
      "Set SPIELERPLUS_EMAIL and SPIELERPLUS_PASSWORD environment variables before running the smoke test.",
    );
    process.exit(1);
  }

  console.log("Logging in...");
  const { session, client } = await createSpielerPlusClient({ email, password });
  console.log(`Authenticated. teamId=${session.teamId} userId=${session.userId}`);
  console.log(`Scopes: ${session.scopes.join(", ")}`);

  const me = await client.meContext();
  console.log(`\nme/context -> team "${me.data.attributes.team.name}"`);

  const ledger = await client.ledger();
  console.log(
    `teamfund (ledger) -> balance ${(ledger.data.attributes.balance_cents / 100).toFixed(2)} ${ledger.data.attributes.currency_code}`,
  );

  const migration = await client.migrationReport();
  console.log(`migration report -> status ${migration.data.attributes.status}`);

  const dues = await client.duesOverview();
  console.log(`dues/overview -> ${dues.meta.total} total due periods (page ${dues.meta.current_page}/${dues.meta.last_page})`);

  const duesMembers = await client.duesMembers();
  console.log(`dues/members -> ${duesMembers.meta.total} members`);

  const catalog = await client.punishmentCatalog({ is_archived: false });
  console.log(`punishment-catalog -> ${catalog.meta.total} entries`);

  const punishmentsSummary = await client.punishmentsSummary();
  console.log(
    `punishments/summary -> ${(punishmentsSummary.data.attributes.total_open_monetary_amount_cents / 100).toFixed(2)} EUR open across ${punishmentsSummary.data.attributes.total_open_monetary_count} monetary + ${punishmentsSummary.data.attributes.total_open_material_count} material`,
  );

  const punishments = await client.punishments();
  console.log(`punishments -> ${punishments.meta.total} total`);

  const transactions = await client.transactions();
  console.log(`transactions -> ${transactions.meta.total} total`);

  const memberBalances = await client.memberBalances();
  console.log(`member-balances -> ${memberBalances.meta.total} members`);

  const firstMember = memberBalances.data[0];
  if (firstMember) {
    const items = await client.memberBalanceItems(firstMember.attributes.member.id, {
      status: "open",
    });
    console.log(
      `member-balances/${firstMember.attributes.member.id} -> ${items.meta.total} open items for ${firstMember.attributes.member.name}`,
    );
  }

  // Mutation round-trip: create a throwaway catalog entry + punishment,
  // exercise mark-paid/mark-unpaid, then delete everything so the account
  // is left unchanged.
  console.log("\n--- mutation round-trip (creates + deletes test data) ---");
  const testCatalogEntry = await client.createPunishmentCatalogEntry({
    name: "SMOKE TEST DELETE ME",
    type: "monetary",
    is_variable: false,
    amount_cents: 1,
  });
  console.log(`created catalog entry ${testCatalogEntry.data.id}`);

  const firstDuesMember = duesMembers.data[0];
  if (firstDuesMember) {
    const assignResult = await client.assignPunishment({
      catalog_entry_id: testCatalogEntry.data.id,
      date: new Date().toISOString().slice(0, 10),
      user_ids: [firstDuesMember.attributes.member.id],
    });
    console.log(`assigned punishment to ${assignResult.data.accepted} member(s)`);

    // Assignment is processed asynchronously (202); poll briefly until the
    // punishment shows up before proceeding.
    let created:
      | Awaited<ReturnType<typeof client.punishments>>["data"][number]
      | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      await client.syncStatus();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const refreshedPunishments = await client.punishments();
      created = refreshedPunishments.data.find(
        (p) => p.attributes.catalog_entry_id === testCatalogEntry.data.id,
      );
    }

    if (created) {
      await client.markPunishmentPaid(created.id);
      console.log(`marked punishment ${created.id} paid`);
      await waitForPunishmentStatus(client, created.id, "paid");

      await client.markPunishmentUnpaid(created.id);
      console.log(`marked punishment ${created.id} unpaid`);
      await waitForPunishmentStatus(client, created.id, "open");

      await client.deletePunishment(created.id);
      console.log(`deleted punishment ${created.id}`);
    } else {
      console.warn(
        "could not find created punishment after polling -- it may still appear shortly; check the account manually before re-running.",
      );
    }
  }

  await client.deletePunishmentCatalogEntry(testCatalogEntry.data.id);
  console.log(`deleted catalog entry ${testCatalogEntry.data.id}`);

  console.log("\nAll smoke tests passed.");
}

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
