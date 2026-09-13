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
  `,
  // v2: crash handlers / updaters inside game folders were detected as games.
  `
  UPDATE apps SET is_game = 0, category_id = (SELECT id FROM categories WHERE key = 'other')
  WHERE is_game = 1 AND (
    lower(exe_name) LIKE '%crash%' OR lower(exe_name) LIKE '%report%' OR lower(exe_name) LIKE '%updat%' OR
    lower(exe_name) LIKE '%launcher%' OR lower(exe_name) LIKE '%helper%' OR lower(exe_name) LIKE '%service%' OR
    lower(exe_name) LIKE '%install%' OR lower(exe_name) LIKE '%setup%' OR lower(exe_name) LIKE '%anticheat%' OR
    lower(exe_name) LIKE '%bootstrap%' OR lower(exe_name) LIKE '%overlay%'
  );
  `,
  // v3: goals and journal, subtasks, task progress and times, goal timers, music history,
  // connections, calendars and external stats.
  `
  CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    emoji TEXT NOT NULL DEFAULT '🎯',
    color TEXT NOT NULL DEFAULT '#1f883d',
    status TEXT NOT NULL DEFAULT 'active',
    progress INTEGER NOT NULL DEFAULT 0,
    auto_progress INTEGER NOT NULL DEFAULT 1,
    target_date TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    achieved_at INTEGER
  );

  CREATE TABLE goal_notes (
    id INTEGER PRIMARY KEY,
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    progress INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX goal_notes_goal ON goal_notes(goal_id);

  ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
  ALTER TABLE tasks ADD COLUMN goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL;
  ALTER TABLE tasks ADD COLUMN progress INTEGER;
  ALTER TABLE tasks ADD COLUMN planned_time TEXT;
  CREATE INDEX tasks_parent ON tasks(parent_id);
  CREATE INDEX tasks_goal ON tasks(goal_id);

  ALTER TABLE recurrences ADD COLUMN time_of_day TEXT;
  ALTER TABLE recurrences ADD COLUMN complete_on_target INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE recurrences ADD COLUMN goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL;

  ALTER TABLE rules ADD COLUMN goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE;

  CREATE TABLE time_entries_v3 (
    id INTEGER PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER,
    source TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    CHECK (task_id IS NOT NULL OR goal_id IS NOT NULL)
  );
  INSERT INTO time_entries_v3 (id, task_id, start_ms, end_ms, source, note)
    SELECT id, task_id, start_ms, end_ms, source, note FROM time_entries;
  DROP TABLE time_entries;
  ALTER TABLE time_entries_v3 RENAME TO time_entries;
  CREATE INDEX time_entries_task ON time_entries(task_id);
  CREATE INDEX time_entries_goal ON time_entries(goal_id);
  CREATE INDEX time_entries_start ON time_entries(start_ms);

  CREATE INDEX activity_sessions_app ON activity_sessions(app_id, start_ms);

  CREATE TABLE app_links (
    app_id INTEGER PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT,
    image_url TEXT,
    store_url TEXT
  );

  CREATE TABLE media_sessions (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '',
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL
  );
  CREATE INDEX media_sessions_start ON media_sessions(start_ms);

  CREATE TABLE integrations (
    key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE calendar_events (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    uid TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#0969da'
  );
  CREATE INDEX calendar_events_start ON calendar_events(start_ms);

  CREATE TABLE external_days (
    provider TEXT NOT NULL,
    date TEXT NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (provider, date)
  );
  `,
  // v4: media library — anime, manga, books, movies, series and games.
  `
  CREATE TABLE library_items (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    original_title TEXT NOT NULL DEFAULT '',
    cover_url TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    favorite INTEGER NOT NULL DEFAULT 0,
    progress INTEGER NOT NULL DEFAULT 0,
    total INTEGER,
    latest INTEGER,
    rating INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    year INTEGER,
    format TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    url TEXT,
    app_id INTEGER REFERENCES apps(id) ON DELETE SET NULL,
    status_auto INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE UNIQUE INDEX library_items_source ON library_items(source, external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX library_items_kind ON library_items(kind, status);
  CREATE INDEX library_items_app ON library_items(app_id);
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
