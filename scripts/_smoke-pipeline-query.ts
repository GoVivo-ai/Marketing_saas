/** Smoke test: the board's card query + agent filter as drizzle builds them. */
process.loadEnvFile(".env.local");
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

const WS = "3013ca8e-e48e-40d8-b707-8a1987bccc63";
const CC = "1a88f4cc-40c8-4deb-9cd2-07e67ed068e3";

function agentFilterSql(agents: string[]): SQL<unknown> {
  return sql`exists (
    select 1 from ${schema.leadEvents} e
    where e.lead_id = ${schema.leads.id}
      and e.user_id in (${sql.join(agents.map((a) => sql`${a}`), sql`, `)})
  )`;
}

async function main() {
  const [juli] = await db().select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.name, "Juliana Gutierrez"));
  const rows = await db()
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      ccStatus: schema.leads.ccStatus,
      // NB: literal "leads"."id" — in a SELECT list drizzle renders the
      // column ref without its table prefix, which is ambiguous here.
      agentName: sql<string | null>`(
        select u.name from lead_events e
        join users u on u.id = e.user_id
        where e.lead_id = "leads"."id"
        order by e.created_at desc limit 1
      )`,
    })
    .from(schema.leads)
    .where(and(
      eq(schema.leads.workspaceId, WS),
      eq(schema.leads.stageId, CC),
      agentFilterSql([juli.id]),
    ))
    .limit(5);
  console.log("Filtro agente=Juliana, etapa CC, 5 tarjetas:");
  for (const r of rows) console.log(`  ${r.name} | cc=${r.ccStatus} | último actor=${r.agentName}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
