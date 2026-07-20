export interface SessionRecord {
  userId: string;
  authVersion: number;
  /** ISO-8601. Legacy records without this field are dual-read with a fallback. */
  createdAt: string;
  /** ISO-8601. MVP: equals createdAt unless activity tracking is added later. */
  lastActivityAt: string;
  ip: string | null;
  userAgent: string | null;
}
