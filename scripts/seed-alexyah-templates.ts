/**
 * Seeds AlexYah's recruiting messages as message templates — the texts the
 * team had in Outlook macros and the SMS generator page, now pickable from
 * the Contact Queue. The brand is never written out: {company} resolves to
 * the workspace's name, so the same texts seed a demo or another client.
 * Upserts by (workspace, channel, name), so re-running refreshes the bodies
 * without duplicating rows.
 * Run: npx tsx scripts/seed-alexyah-templates.ts [workspace-slug]
 */
process.loadEnvFile(".env.local");

import postgres from "postgres";

const SLUG = process.argv[2] ?? "alexyah";

const SCHEDULE_SHORT =
  "{if city=Stockton}5am-5pm, no rides 9:30-10:30am{else}AM 6:30-8:30 & PM 1:30-3:30{/if}";
const SCHEDULE_FULL =
  "{if city=Stockton}Working hours are 5am-5pm, with no rides between 9:30 and 10:30am.{else}Morning rides 6:30-8:30am and afternoon rides 1:30-3:30pm; availability in both is required.{/if}";

const SMS: { name: string; body: string }[] = [
  {
    name: "Follow-up",
    body:
      "Hi {first_name}! Quick update on driving opportunities in {city}, CA - {company} still has rides available in your area, paying $20 - $30+ per ride. You can make between $1,200 and $2,400*/month. Spots are filling up and we didn't want you to miss out. Still interested? Let's set up a quick call. This is {agent_name}, and you can call me back at this number.",
  },
  {
    name: "Short offer",
    body: `Hi {first_name}, this is {agent_name} from {company}. We have student rides available in {city}, Mon-Fri (${SCHEDULE_SHORT}). Pay is $20 - $30+ per ride, and you can make between $1,200 and $2,400*/month. Ready to start? Reply with a photo of the FRONT of your Driver License. Thank you!`,
  },
  {
    name: "Full offer",
    body: `Hi {first_name}, this is {agent_name} from {company}. We have student transportation rides available in {city}, Mon-Fri. ${SCHEDULE_FULL} Pay per ride: $20 (1-5 mi), $25 (6-9 mi), $30 (10 mi), and $30 + $1.00/mile (10+ mi). Requirements: clean background check with fingerprinting, drug test, vehicle 2012 or newer, age 21+, driver's license and registration. {company} covers onboarding costs. To get started, reply with a photo of the FRONT of your Driver License. Thank you!`,
  },
];

const EMAIL: { name: string; subject: string; body: string }[] = [
  {
    name: "Job offer",
    subject: "Earn $1,200 - $2,400*/month driving in your community with {company}",
    body: `Hi {first_name},

Thank you for your interest in driving with {company}. We provide contracted student transportation for local school districts, and we currently have rides available in {city}.

EARN $1,200 - $2,400* / MONTH

SCHEDULE (Monday to Friday)
${SCHEDULE_FULL}

PAY PER RIDE
- 1-5 miles: $20
- 6-9 miles: $25
- 10 miles: $30
- 10+ miles: $30 + $1.00/mile

REQUIREMENTS
- Clean background check with fingerprinting (Live Scan)
- Drug test
- Vehicle 2012 or newer
- Age 21 or older
- Valid driver's license and registration
{company} covers the onboarding costs.

YOUR NEXT STEP
1. Reply to this email with a photo of the FRONT of your Driver License.
2. We'll call you to confirm your availability and answer your questions.

Questions? Call or text me at {agent_phone}.

Best regards,
{agent_name}
{company}
{agent_phone}
{agent_email}`,
  },
  {
    name: "Welcome / Next steps",
    subject: "Welcome to {company} - Next Steps",
    body: `Hi {first_name},

Welcome to {company}! We're glad to have you on board for rides in {city}.

Here is your road to driving:

STEP 1 - Finish your checklist
Log in to Contractor Compliance (CC) and complete your A1 tasks. Your CC page shows 17 items: you complete 9, we help you with 5, and EverDriven checks the last 3.

STEP 2 - Watch for the drug test email
You'll receive an email with the subject "Start your EverDriven Technologies, LLC drug screening". Check your inbox, Spam and Promotions. Forward it right away to {agent_email} and we'll help you book the test closest to you. This appointment cannot be rescheduled.

STEP 3 - Take 3 online courses
English Validation (40 min), SafeRide Education (4-4.5 h, within 20 days) and CPR & First Aid. {company} pays for all of them - do NOT pay for any course yourself. Your login arrives in a separate email.

THE GOAL - Start driving!
When all 17 items are done, you're ready to hit the road.

${SCHEDULE_FULL}

How carefully you follow these steps and how fast you reply will be considered when we assign future rides. The onboarding guide with all the details is attached / available on request.

Questions? Call me at {agent_phone} or reply to this email.

Best regards,
{agent_name}
{company}
{agent_phone}
{agent_email}`,
  },
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const [ws] = await sql`select id, name from workspaces where slug = ${SLUG}`;
  if (!ws) throw new Error(`No workspace with slug "${SLUG}"`);

  const rows = [
    ...SMS.map((t, i) => ({ channel: "sms", name: t.name, subject: null as string | null, body: t.body, sort: i })),
    ...EMAIL.map((t, i) => ({ channel: "email", name: t.name, subject: t.subject, body: t.body, sort: i })),
  ];
  for (const r of rows) {
    await sql`
      INSERT INTO message_templates (id, workspace_id, channel, name, subject, body, sort_order)
      VALUES (${crypto.randomUUID()}, ${ws.id}, ${r.channel}, ${r.name}, ${r.subject}, ${r.body}, ${r.sort})
      ON CONFLICT (workspace_id, channel, name)
      DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, sort_order = EXCLUDED.sort_order, updated_at = now()`;
    console.log(`${r.channel.padEnd(5)} ${r.name}`);
  }
  console.log(`\n${rows.length} templates ready for ${ws.name}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
