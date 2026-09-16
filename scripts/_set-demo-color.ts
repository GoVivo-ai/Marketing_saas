import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
async function main(){
const before = await sql`SELECT slug, accent_color FROM workspaces WHERE slug IN ('demo') OR is_active ORDER BY slug`;
console.log("before", before);
const r = await sql`UPDATE workspaces SET accent_color = '#7c3aed' WHERE slug = 'demo' RETURNING slug, accent_color`;
console.log("after", r);
await sql.end();
}
main();
