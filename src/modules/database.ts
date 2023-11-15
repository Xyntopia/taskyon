//import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
//import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

/*const log = (...args: string[]) => console.log(...args);
const error = (...args: unknown[]) => console.error(...args);

interface LocalSqlite3Static extends Sqlite3Static {
  version?: {
    libVersion: string;
  };
}

const start = function (sqlite3: LocalSqlite3Static) {
  if (sqlite3.version) {
    log(
      'Running SQLite3 version',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      JSON.stringify(sqlite3.version.libVersion)
    );
  }
  const db = new sqlite3.oo1.DB('/mydb.sqlite3', 'ct');
  // Your SQLite code here.
};

log('Loading and initializing SQLite3 module...');
void sqlite3InitModule({
  print: log,
  printErr: error,
}).then((sqlite3) => {
  try {
    sqlite3.capi.sqlite3_vfs_find('opfs');
    log('Done initializing. Running our sqlite db...');
    start(sqlite3);
  } catch (err) {
    error(JSON.stringify(err));
  }
});
*/


/*
import { SQLocal } from 'sqlocal';

// Create a client with a name for the SQLite file to save in
// the origin private file system
const { sql } = new SQLocal('database.sqlite3');

// Use the "sql" tagged template to execute a SQL statement
// against the SQLite database
await sql`CREATE TABLE groceries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;

// Execute a prepared statement just by inserting parameters
// in the SQL string
const items = ['bread', 'milk', 'rice'];
for (let item of items) {
  await sql`INSERT INTO groceries (name) VALUES (${item})`;
}

// SELECT queries and queries with the RETURNING clause will
// return the matched records as an array of objects
const data = await sql`SELECT * FROM groceries`;
console.log(data);
*/
