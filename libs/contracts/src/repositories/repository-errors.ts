export class DuplicateRecordError extends Error {
  constructor(public readonly constraint?: string) {
    super('Duplicate record');
    this.name = 'DuplicateRecordError';
  }
}

export class RepositoryRecordNotFoundError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`${entity} record not found`);
    this.name = 'RepositoryRecordNotFoundError';
  }
}
