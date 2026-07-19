import { Block, Layout, OtpCode, Paragraph, Signoff, Title } from '../components';

export type PasswordResetEmailProps = {
  email: string;
  token: string;
  resetUrl?: string;
  expiresInMinutes: number;
};

export const PasswordResetEmail = ({
  email,
  token,
  resetUrl,
  expiresInMinutes,
}: PasswordResetEmailProps) => (
  <Layout>
    <Block>
      <Title>Password reset</Title>
    </Block>
    <Block>
      <Paragraph>
        We received a request to reset the password for <strong>{email}</strong>. This reset code
        expires in {expiresInMinutes} minutes and can be used only once.
      </Paragraph>
    </Block>
    {resetUrl ? (
      <Block>
        <Paragraph>
          Open the link to choose a new password: <a href={resetUrl}>{resetUrl}</a>
        </Paragraph>
      </Block>
    ) : null}
    <Block>
      <Paragraph>Your reset code:</Paragraph>
      <OtpCode code={token} />
    </Block>
    <Block>
      <Paragraph>If you did not request a password reset, you can ignore this email.</Paragraph>
    </Block>
    <Block disableMargin>
      <Signoff from="Support Team" />
    </Block>
  </Layout>
);
