import type { IUserRepository } from '@contracts/repositories/user.repository';
import { NotFoundError } from '@domain/errors/domain-errors';

export class GetCurrentUserUseCase {
  constructor(private readonly userRepository: IUserRepository) {}

  async execute(userId: string) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'User not found', { userId });
    }

    return {
      id: user.id,
      email: user.email.toString(),
      roles: user.roles,
    };
  }
}
