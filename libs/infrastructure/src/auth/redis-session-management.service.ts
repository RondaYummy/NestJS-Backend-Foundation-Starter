import { Injectable } from '@nestjs/common';
import type { ISessionStore } from '@contracts/auth/session-store.service';
import type {
  ISessionManagementService,
  RevokeOneResult,
  RevokeOthersResult,
  SessionListItem,
} from '@contracts/auth/session-management.service';
import { NotFoundError } from '@domain/errors/domain-errors';

@Injectable()
export class RedisSessionManagementService implements ISessionManagementService {
  constructor(private readonly sessionStore: ISessionStore) {}

  async listForUser(userId: string, currentSessionId: string): Promise<SessionListItem[]> {
    const entries = await this.sessionStore.listByUserId(userId);

    return entries.map((entry) => ({
      id: entry.id,
      createdAt: entry.record.createdAt,
      lastActivityAt: entry.record.lastActivityAt,
      expiresAt: entry.expiresAt.toISOString(),
      ip: entry.record.ip,
      userAgent: entry.record.userAgent,
      isCurrent: entry.id === currentSessionId,
    }));
  }

  async revokeOne(
    userId: string,
    sessionId: string,
    currentSessionId: string,
  ): Promise<RevokeOneResult> {
    const record = await this.sessionStore.get(sessionId);

    if (!record || record.userId !== userId) {
      throw new NotFoundError('SESSION_NOT_FOUND', 'Session not found');
    }

    await this.sessionStore.delete(sessionId);

    return { clearedCurrent: sessionId === currentSessionId };
  }

  async revokeOthers(userId: string, currentSessionId: string): Promise<RevokeOthersResult> {
    const entries = await this.sessionStore.listByUserId(userId);
    let revokedCount = 0;

    for (const entry of entries) {
      if (entry.id === currentSessionId) {
        continue;
      }

      await this.sessionStore.delete(entry.id);
      revokedCount += 1;
    }

    return { revokedCount };
  }

  async revokeAll(userId: string): Promise<void> {
    const entries = await this.sessionStore.listByUserId(userId);

    for (const entry of entries) {
      await this.sessionStore.delete(entry.id);
    }
  }
}
