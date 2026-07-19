/// <reference types="jest" />

import type { OAuth2Client, LoginTicket } from 'google-auth-library';

import { AuthenticationError } from '@domain/errors/domain-errors';

import { GoogleOauthIdentityService } from './google-oauth-identity.service';

// google-auth-library methods are heavily overloaded, which makes
// jest.Mocked<Pick<OAuth2Client, ...>> collapse parameters to `never`;
// mock against the narrow call shapes the adapter actually uses instead.
type MockedClient = {
  generateAuthUrl: jest.Mock<string, [Record<string, unknown>]>;
  getToken: jest.Mock<Promise<{ tokens: { id_token?: string } }>, [string]>;
  verifyIdToken: jest.Mock<Promise<LoginTicket>, [{ idToken: string; audience: string }]>;
};

const baseOptions = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://api.example.com/v1/auth/google/callback',
};

function createService(
  overrides: Partial<typeof baseOptions & { hostedDomain?: string }> = {},
): { service: GoogleOauthIdentityService; client: MockedClient } {
  const client: MockedClient = {
    generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?x=1'),
    getToken: jest.fn(),
    verifyIdToken: jest.fn(),
  };
  const service = new GoogleOauthIdentityService(
    { ...baseOptions, ...overrides },
    client as unknown as OAuth2Client,
  );

  return { service, client };
}

function mockTicket(payload: Record<string, unknown> | undefined): LoginTicket {
  return { getPayload: () => payload } as unknown as LoginTicket;
}

describe('GoogleOauthIdentityService', () => {
  it('builds the authorization URL with code flow scopes and state', () => {
    const { service, client } = createService();

    const url = service.createAuthorizationUrl('state-123');

    expect(url).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
    expect(client.generateAuthUrl).toHaveBeenCalledWith({
      response_type: 'code',
      scope: ['openid', 'email', 'profile'],
      state: 'state-123',
    });
  });

  it('passes the hosted domain hint when configured (OQ-08)', () => {
    const { service, client } = createService({ hostedDomain: 'example.com' });

    service.createAuthorizationUrl('state-123');

    expect(client.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ hd: 'example.com' }),
    );
  });

  it('exchanges a code and returns verified profile claims', async () => {
    const { service, client } = createService();
    client.getToken.mockResolvedValue({ tokens: { id_token: 'id-token' } });
    client.verifyIdToken.mockResolvedValue(
      mockTicket({ sub: 'google-sub-1', email: 'user@example.com', email_verified: true }),
    );

    const profile = await service.exchangeAuthorizationCode('auth-code');

    expect(client.getToken).toHaveBeenCalledWith('auth-code');
    expect(client.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: 'client-id',
    });
    expect(profile).toEqual({ sub: 'google-sub-1', email: 'user@example.com', emailVerified: true });
  });

  it('reports emailVerified=false when Google does not assert verification', async () => {
    const { service, client } = createService();
    client.getToken.mockResolvedValue({ tokens: { id_token: 'id-token' } });
    client.verifyIdToken.mockResolvedValue(
      mockTicket({ sub: 'google-sub-1', email: 'user@example.com' }),
    );

    const profile = await service.exchangeAuthorizationCode('auth-code');

    expect(profile.emailVerified).toBe(false);
  });

  it('maps token exchange failures to GOOGLE_SSO_TOKEN_EXCHANGE_FAILED without leaking details (NFR-04)', async () => {
    const { service, client } = createService();
    client.getToken.mockRejectedValue(new Error('invalid_grant: code was secret-code-value'));

    const error: unknown = await service
      .exchangeAuthorizationCode('secret-code-value')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).code).toBe('GOOGLE_SSO_TOKEN_EXCHANGE_FAILED');
    expect((error as AuthenticationError).message).not.toContain('secret-code-value');
  });

  it('fails when the token response has no ID token', async () => {
    const { service, client } = createService();
    client.getToken.mockResolvedValue({ tokens: {} });

    await expect(service.exchangeAuthorizationCode('auth-code')).rejects.toMatchObject({
      code: 'GOOGLE_SSO_TOKEN_EXCHANGE_FAILED',
    });
    expect(client.verifyIdToken).not.toHaveBeenCalled();
  });

  it('fails when required claims are missing', async () => {
    const { service, client } = createService();
    client.getToken.mockResolvedValue({ tokens: { id_token: 'id-token' } });
    client.verifyIdToken.mockResolvedValue(mockTicket({ sub: 'google-sub-1' }));

    await expect(service.exchangeAuthorizationCode('auth-code')).rejects.toMatchObject({
      code: 'GOOGLE_SSO_TOKEN_EXCHANGE_FAILED',
    });
  });

  it('rejects profiles outside the configured hosted domain (GOOGLE_SSO_HOSTED_DOMAIN_MISMATCH)', async () => {
    const { service, client } = createService({ hostedDomain: 'example.com' });
    client.getToken.mockResolvedValue({ tokens: { id_token: 'id-token' } });
    client.verifyIdToken.mockResolvedValue(
      mockTicket({ sub: 'google-sub-1', email: 'user@other.com', email_verified: true }),
    );

    await expect(service.exchangeAuthorizationCode('auth-code')).rejects.toMatchObject({
      code: 'GOOGLE_SSO_HOSTED_DOMAIN_MISMATCH',
    });
  });
});
