import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  if (process.argv.includes("--seed")) {
    await pool.query(
      "insert into creators (id, owner_id, display_name, normalized_key) values ('00000000-0000-0000-0000-0000000000aa', (select id from users where bootstrap_key = 'local'), 'Persistence probe', 'persistence-probe')",
    );
  }
  const result = await pool.query(
    "select id from creators where id = '00000000-0000-0000-0000-0000000000aa'",
  );
  if (result.rowCount !== 1) {
    throw new Error("Database volume did not retain the foundation persistence probe");
  }
} finally {
  await pool.end();
}