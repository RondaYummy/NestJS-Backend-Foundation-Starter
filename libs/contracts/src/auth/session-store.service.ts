import type { SessionRecord } from './session-record';

export interface ISessionStore {
  create(record: SessionRecord, ttlSeconds: number): Promise<string>;
  get(sessionId: string): Promise<SessionRecord | null>;
  delete(sessionId: string): Promise<void>;
}
