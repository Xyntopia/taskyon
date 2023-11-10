import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

const log = (...args: string[]) => console.log(...args);
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
    log('Done initializing. Running demo...');
    start(sqlite3);
  } catch (err) {
    error(JSON.stringify(err));
  }
});
