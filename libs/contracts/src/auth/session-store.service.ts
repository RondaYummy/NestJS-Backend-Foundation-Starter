import type { SessionRecord } from './session-record';

export type SessionListEntry = {
  id: string;
  record: SessionRecord;
  expiresAt: Date;
};

/**
 * Redis-backed session persistence.
 *
 * Logical keys:
 * - `sessions:{sessionId}` — JSON {@link SessionRecord}, TTL = session TTL
 * - `sessions:user:{userId}` — SET of sessionId members (per-user index)
 *
 * `listByUserId` reads the user SET (no `KEYS *` / unbounded session SCAN) and
 * prunes stale index members whose session key has expired or been deleted.
 */
export interface ISessionStore {
  create(record: SessionRecord, ttlSeconds: number): Promise<string>;
  get(sessionId: string): Promise<SessionRecord | null>;
  delete(sessionId: string): Promise<void>;
  listByUserId(userId: string): Promise<SessionListEntry[]>;
}
