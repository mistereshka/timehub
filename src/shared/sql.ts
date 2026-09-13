export type SqlValue = string | number | null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>

/**
 * Minimal synchronous SQLite surface. Implemented on top of `node:sqlite`
 * (Electron main process, tests) and `sql.js` (browser demo mode), so the
 * whole service layer runs unchanged in both places.
 */
export interface SqlDb {
  exec(sql: string): void
  all<T = Row>(sql: string, params?: SqlValue[]): T[]
  get<T = Row>(sql: string, params?: SqlValue[]): T | undefined
  run(sql: string, params?: SqlValue[]): { changes: number; lastId: number }
}

const depth = new WeakMap<SqlDb, number>()

/** Runs `fn` in a transaction; nested calls join the outer transaction. */
export function transaction<T>(db: SqlDb, fn: () => T): T {
  const current = depth.get(db) ?? 0
  if (current > 0) {
    depth.set(db, current + 1)
    try {
      return fn()
    } finally {
      depth.set(db, current)
    }
  }
  db.exec('BEGIN')
  depth.set(db, 1)
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  } finally {
    depth.set(db, 0)
  }
}
