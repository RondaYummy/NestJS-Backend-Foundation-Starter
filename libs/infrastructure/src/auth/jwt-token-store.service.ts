export interface RefreshTokenRecord {
  userId: string;
  familyId: string;
}

export interface SaveRefreshTokenInput {
  tokenId: string;
  familyId: string;
  record: RefreshTokenRecord;
  ttlSeconds: number;
}

export interface RotateRefreshTokenInput {
  currentTokenId: string;
  nextTokenId: string;
  familyId: string;
  nextRecord: RefreshTokenRecord;
  ttlSeconds: number;
}

export interface IJwtTokenStore {
  /**
   * Зберігає перший refresh token нової JWT-сесії.
   */
  saveRefreshToken(input: SaveRefreshTokenInput): Promise<void>;

  /**
   * Атомарно замінює старий refresh token на новий.
   *
   * Повертає false, якщо старий token уже використаний,
   * відкликаний або не належить активній family.
   */
  rotateRefreshToken(input: RotateRefreshTokenInput): Promise<boolean>;

  /**
   * Відкликає поточний refresh token та всю token family.
   */
  revokeRefreshTokenFamily(familyId: string): Promise<void>;

  /**
   * Додає access token у blacklist до завершення його TTL.
   */
  revokeAccessToken(tokenId: string, ttlSeconds: number): Promise<void>;

  /**
   * Перевіряє, чи був access token відкликаний.
   */
  isAccessTokenRevoked(tokenId: string): Promise<boolean>;
}
