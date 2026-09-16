process.loadEnvFile(".env.local");
import { isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

async function main() {
  const byUser = await db()
    .select({
      userId: schema.callLogs.userId,
      calls: sql<number>`count(*)`,
      talkSec: sql<number>`sum(${schema.callLogs.durationSec})`,
      withWorkspace: sql<number>`count(${schema.callLogs.workspaceId})`,
      first: sql<string>`min(${schema.callLogs.startTime})`,
      last: sql<string>`max(${schema.callLogs.startTime})`,
    })
    .from(schema.callLogs)
    .groupBy(schema.callLogs.userId);

  const users = await db()
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      rcConnected: isNotNull(schema.users.rcAccessTokenEnc),
    })
    .from(schema.users);

  const nameOf = new Map(users.map((u) => [u.id, `${u.name} <${u.email}>`]));

  console.log("=== Users (rcConnected = OAuth token present) ===");
  for (const u of users)
    console.log(`${u.name} <${u.email}> rcOAuth=${u.rcConnected}`);

  console.log("\n=== call_logs by user ===");
  for (const r of byUser)
    console.log(
      `${nameOf.get(r.userId) ?? r.userId}: calls=${r.calls} talkSec=${r.talkSec} workspaceMatched=${r.withWorkspace} range=${r.first} .. ${r.last}`,
    );
  process.exit(0);
}
main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
