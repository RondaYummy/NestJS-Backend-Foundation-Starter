export type SessionListItem = {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  isCurrent: boolean;
};

export type RevokeOneResult = {
  clearedCurrent: boolean;
};

export type RevokeOthersResult = {
  revokedCount: number;
};

/**
 * Authenticated session-management operations (list / revoke).
 * JWT driver wires an unsupported stub that throws SESSION_DRIVER_REQUIRED.
 */
export interface ISessionManagementService {
  listForUser(userId: string, currentSessionId: string): Promise<SessionListItem[]>;

  revokeOne(
    userId: string,
    sessionId: string,
    currentSessionId: string,
  ): Promise<RevokeOneResult>;

  revokeOthers(userId: string, currentSessionId: string): Promise<RevokeOthersResult>;

  revokeAll(userId: string): Promise<void>;
}
