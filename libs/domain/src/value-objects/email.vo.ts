import { ValidationError } from '../errors/domain-errors';

export class Email {
  private constructor(private readonly value: string) {}
  static create(value: string): Email {
    const normalized = value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new ValidationError('INVALID_EMAIL', 'Invalid email', { value });
    }
    return new Email(normalized);
  }
  toString(): string {
    return this.value;
  }
}
