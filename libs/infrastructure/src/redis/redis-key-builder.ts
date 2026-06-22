export class RedisKeyBuilder {
  private readonly prefix: string;

  constructor(keyPrefix?: string) {
    this.prefix = RedisKeyBuilder.normalizePrefix(keyPrefix);
  }

  static normalizePrefix(keyPrefix?: string): string {
    const trimmed = (keyPrefix ?? '').trim();

    if (trimmed.length === 0) {
      return '';
    }

    return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
  }

  getPrefix(): string {
    return this.prefix;
  }

  buildKey(...segments: string[]): string {
    if (segments.length === 0) {
      return this.prefix;
    }

    return `${this.prefix}${segments.join(':')}`;
  }

  buildPattern(...segments: string[]): string {
    return this.buildKey(...segments);
  }

  toPhysicalKey(logicalKey: string): string {
    return `${this.prefix}${logicalKey}`;
  }

  toPhysicalPattern(logicalPattern: string): string {
    return `${this.prefix}${logicalPattern}`;
  }

  toLogicalKey(physicalKey: string): string {
    if (this.prefix.length === 0) {
      return physicalKey;
    }

    if (!physicalKey.startsWith(this.prefix)) {
      return physicalKey;
    }

    return physicalKey.slice(this.prefix.length);
  }
}
