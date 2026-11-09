ALTER TABLE oauth_pending ADD COLUMN desktop_poll_hash TEXT;
--> statement-breakpoint
CREATE TABLE oauth_desktop_handoffs (
  poll_hash TEXT PRIMARY KEY NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL CHECK(status IN ('pending','confirm','ready','error','cancelled')),
  error TEXT,
  verification_hash TEXT,
  confirm_cookie_hash TEXT,
  confirm_csrf_hash TEXT,
  verified_record TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX oauth_desktop_handoffs_expiry ON oauth_desktop_handoffs(expires_at);
