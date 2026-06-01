import { IUserRepository } from '@contracts/repositories/user.repository';
import { TOKENS } from '@contracts/tokens';
import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@domain/errors/domain-errors';

@Injectable()
export class GetCurrentUserUseCase {
  constructor(
    @Inject(TOKENS.UserRepository)
    private readonly userRepository: IUserRepository,
  ) {}

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
