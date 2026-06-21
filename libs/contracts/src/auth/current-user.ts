export type AuthDriver = 'jwt' | 'session';

export interface CurrentUser {
  id: string;
  email: string;
  roles: string[];
  authVersion: number;
}
