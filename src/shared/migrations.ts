import { transaction, type SqlDb } from './sql'

/** Append-only list of schema migrations; index + 1 is stored in PRAGMA user_version. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE labels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE recurrences (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    rule TEXT NOT NULL,
    days_mask INTEGER NOT NULL DEFAULT 0,
    day_of_month INTEGER,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    label_ids TEXT NOT NULL DEFAULT '',
    estimate_min INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    last_generated TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    priority INTEGER NOT NULL DEFAULT 0,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    due_date TEXT,
    planned_date TEXT,
    estimate_min INTEGER,
    recurrence_id INTEGER REFERENCES recurrences(id) ON DELETE SET NULL,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER
  );
  CREATE UNIQUE INDEX tasks_recurrence_day ON tasks(recurrence_id, planned_date) WHERE recurrence_id IS NOT NULL;
  CREATE INDEX tasks_planned ON tasks(planned_date);

  CREATE TABLE task_labels (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );

  CREATE TABLE time_entries (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER,
    source TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX time_entries_task ON time_entries(task_id);
  CREATE INDEX time_entries_start ON time_entries(start_ms);

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );

  CREATE TABLE apps (
    id INTEGER PRIMARY KEY,
    exe_path TEXT NOT NULL UNIQUE COLLATE NOCASE,
    exe_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    icon TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    record_titles INTEGER NOT NULL DEFAULT 1,
    ignored INTEGER NOT NULL DEFAULT 0,
    is_game INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL
  );

  CREATE TABLE activity_sessions (
    id INTEGER PRIMARY KEY,
    app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
  );
  CREATE INDEX activity_sessions_start ON activity_sessions(start_ms);
  CREATE INDEX activity_sessions_end ON activity_sessions(end_ms);

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY,
    app_id INTEGER REFERENCES apps(id) ON DELETE CASCADE,
    title_pattern TEXT NOT NULL DEFAULT '',
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  `
]

export function migrate(db: SqlDb): { created: boolean } {
  const version = db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0
  for (let i = version; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i])
      db.exec(`PRAGMA user_version = ${i + 1}`)
    })
  }
  return { created: version === 0 }
}
