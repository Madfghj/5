CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'en', username TEXT, contacts TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE email_credentials (email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, parameters TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE groups (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, emoji TEXT NOT NULL, color TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE members (group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL, PRIMARY KEY(group_id,user_id));
--> statement-breakpoint
CREATE TABLE events (id TEXT PRIMARY KEY NOT NULL, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE, title TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, location TEXT NOT NULL, notes TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE responses (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, value TEXT NOT NULL CHECK(value IN ('yes','no','maybe')), PRIMARY KEY(event_id,user_id));
--> statement-breakpoint
CREATE TABLE identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(provider,subject));
--> statement-breakpoint
CREATE TABLE provider_tokens (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, encrypted_token TEXT NOT NULL, token_type TEXT NOT NULL, PRIMARY KEY(provider,subject));
--> statement-breakpoint
CREATE TABLE oauth_pending (state_hash TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, ticket_hash TEXT, browser_hash TEXT, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, return_to TEXT NOT NULL, code_challenge TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE oauth_exchanges (code_hash TEXT PRIMARY KEY NOT NULL, record TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE rate_limits (key_hash TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX members_user ON members(user_id);
--> statement-breakpoint
CREATE INDEX events_group_date ON events(group_id,date);
--> statement-breakpoint
CREATE INDEX sessions_expiry ON sessions(expires_at);
--> statement-breakpoint
CREATE INDEX oauth_pending_expiry ON oauth_pending(expires_at);
--> statement-breakpoint
CREATE INDEX oauth_exchanges_expiry ON oauth_exchanges(expires_at);
--> statement-breakpoint
CREATE INDEX rate_limits_expiry ON rate_limits(reset_at);
