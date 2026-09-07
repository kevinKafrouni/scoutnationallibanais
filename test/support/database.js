// PGlite provides one connection. Serialize pool operations to preserve transaction boundaries.
export function testDatabase(engine) {
  let pending = Promise.resolve();
  async function connect() {
    const previous = pending;
    let unlock;
    pending = new Promise(resolve => { unlock = resolve; });
    await previous;
    return {
      async query(sql, values) {
        const result = !values && sql.includes('CREATE TABLE') ? (await engine.exec(sql)).at(-1) : await engine.query(sql, values);
        return { ...result, rowCount: result.affectedRows || result.rows.length };
      },
      release: unlock,
    };
  }
  return { connect, async query(sql, values) {
    const client = await connect();
    try { return await client.query(sql, values); } finally { client.release(); }
  } };
}
