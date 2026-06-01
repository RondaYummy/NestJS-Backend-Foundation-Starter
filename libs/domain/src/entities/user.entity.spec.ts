import { Email } from '@domain/value-objects/email.vo';
import { User } from './user.entity';

describe('User', () => {
  it('creates user', () => {
    const user = User.create({ email: 'A@EXAMPLE.COM', passwordHash: 'password' });
    expect(user.email.toString()).toBe('A@EXAMPLE.COM');
    expect(user.passwordHash).toBe('password');
    expect(user.roles).toEqual(['user']);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it('restores user', () => {
    const user = User.restore({ id: '123', email: Email.create('A@EXAMPLE.COM'), passwordHash: 'password', roles: ['user'], createdAt: new Date(), updatedAt: new Date() });
    expect(user.email.toString()).toBe('A@EXAMPLE.COM');
    expect(user.passwordHash).toBe('password');
    expect(user.roles).toEqual(['user']);
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });
});
