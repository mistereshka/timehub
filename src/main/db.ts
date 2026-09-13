import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { SqlDb } from '@shared/sql'

/** SqlDb on top of Node's built-in SQLite (used by the Electron main process and tests). */
export function openNodeDb(path: string): SqlDb & { close(): void } {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  }
  const cache = new Map<string, StatementSync>()
  const statement = (sql: string): StatementSync => {
    let stmt = cache.get(sql)
    if (!stmt) {
      stmt = db.prepare(sql)
      cache.set(sql, stmt)
    }
    return stmt
  }
  return {
    exec: (sql) => db.exec(sql),
    all: (sql, params = []) => statement(sql).all(...params) as never,
    get: (sql, params = []) => statement(sql).get(...params) as never,
    run: (sql, params = []) => {
      const r = statement(sql).run(...params)
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) }
    },
    close: () => db.close()
  }
}
