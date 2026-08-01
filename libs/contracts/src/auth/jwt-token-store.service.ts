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
   *
   * Реалізація також індексує `familyId` у per-user наборі
   * (логічний ключ `auth:refresh-families:user:{userId}`), щоб
   * `revokeAllRefreshTokenFamilies` міг відкликати всі families користувача
   * без сканування Redis. TTL індексу не можна скорочувати: він має покривати
   * найдовшу з проіндексованих families
   * (`max(поточний TTL індексу, ttlSeconds)`; Redis TTL `-1`/`-2` → `ttlSeconds`).
   */
  saveRefreshToken(input: SaveRefreshTokenInput): Promise<void>;

  /**
   * Атомарно замінює старий refresh token на новий.
   *
   * Повертає false, якщо старий token уже використаний,
   * відкликаний або не належить активній family.
   *
   * Успішна rotation оновлює per-user індекс families за тими самими
   * TTL-правилами, що й `saveRefreshToken`.
   */
  rotateRefreshToken(input: RotateRefreshTokenInput): Promise<boolean>;

  /**
   * Відкликає поточний refresh token та всю token family.
   *
   * Реалізація best-effort прибирає `familyId` з per-user індексу.
   */
  revokeRefreshTokenFamily(familyId: string): Promise<void>;

  /**
   * Відкликає всі проіндексовані refresh-token families користувача
   * і очищає per-user індекс `auth:refresh-families:user:{userId}`.
   *
   * Families, видані до появи індексу, не будуть відкликані еагерно —
   * вони залишаються нечинними через перевірку `authVersion` і TTL.
   */
  revokeAllRefreshTokenFamilies(userId: string): Promise<void>;

  /**
   * Додає access token у blacklist до завершення його TTL.
   */
  revokeAccessToken(tokenId: string, ttlSeconds: number): Promise<void>;

  /**
   * Перевіряє, чи був access token відкликаний.
   */
  isAccessTokenRevoked(tokenId: string): Promise<boolean>;
}
