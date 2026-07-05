CREATE TABLE IF NOT EXISTS mediums (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  group_id INTEGER
);

CREATE TABLE IF NOT EXISTS medium_class_subjects (
  medium_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  PRIMARY KEY (medium_id, class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS textbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  chapter_name TEXT NOT NULL,
  medium_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  api_pdf_url TEXT,
  api_thumb_url TEXT,
  pdf_url TEXT,
  thumb_url TEXT,
  pdf_oci_path TEXT,
  thumb_oci_path TEXT,
  file_size INTEGER,
  download_state TEXT DEFAULT 'pending',
  download_error TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_textbooks_filter ON textbooks(medium_id, class_id, subject_id);
