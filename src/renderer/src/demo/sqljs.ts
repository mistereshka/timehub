import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import type { Row, SqlDb, SqlValue } from '@shared/sql'

/** In-memory SqlDb for the browser demo, backed by SQLite compiled to WebAssembly. */
export async function openSqlJsDb(): Promise<SqlDb> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const db = new SQL.Database()
  db.exec('PRAGMA foreign_keys = ON')

  const all = (sql: string, params: SqlValue[] = []): Row[] => {
    const stmt = db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: Row[] = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      return rows
    } finally {
      stmt.free()
    }
  }

  return {
    exec: (sql) => {
      db.exec(sql)
    },
    all: (sql, params) => all(sql, params) as never,
    get: (sql, params) => all(sql, params)[0] as never,
    run: (sql, params = []) => {
      db.run(sql, params)
      const changes = db.getRowsModified()
      const lastId = Number(db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0)
      return { changes, lastId }
    }
  }
}
