// In-memory PostgreSQL runs the production migration/functions, not a JS reimplementation.
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createPostgresStore } = require('../../cloudfunctions/terminal-chat-service/postgres-store');
const schemaSQL = readFileSync(join(__dirname, '../../cloudfunctions/terminal-chat-service/schema.sql'), 'utf8');
let sharedDatabase;
let nextSchema = 0;
function createMemoryStore() {
  const schema = `terminal_chat_test_${++nextSchema}`;
  sharedDatabase ??= PGlite.create();
  const ready = sharedDatabase.then(async pg => { await pg.exec(schemaSQL.replaceAll('terminal_chat', schema)); return pg; });
  const executeSQL = async sql => {
    const pg = await ready;
    const result = await pg.query(sql.replaceAll('terminal_chat', schema), [], { rowMode: 'array' });
    return { Rows: result.rows.map(row => JSON.stringify(row)), Columns: result.fields.map(field => field.name), AffectedRows: result.affectedRows };
  };
  return { ...createPostgresStore(executeSQL), executeSQL };
}
module.exports = { createMemoryStore };
