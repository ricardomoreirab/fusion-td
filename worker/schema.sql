CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  wave        INTEGER NOT NULL,
  time_sec    INTEGER NOT NULL,
  kills       INTEGER NOT NULL,
  gold        INTEGER NOT NULL,
  champion    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rank ON scores (wave DESC, time_sec DESC);
