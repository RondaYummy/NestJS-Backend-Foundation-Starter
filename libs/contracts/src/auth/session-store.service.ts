import type { CurrentUser } from './current-user';

export interface ISessionStore {
  create(user: CurrentUser, ttlSeconds: number): Promise<string>;
  get(sessionId: string): Promise<CurrentUser | null>;
  delete(sessionId: string): Promise<void>;
}