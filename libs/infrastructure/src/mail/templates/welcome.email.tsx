import { Block, Layout, Paragraph, Signoff, Title } from '../components';

export type WelcomeEmailProps = {
  email: string;
};

export const WelcomeEmail = ({ email }: WelcomeEmailProps) => (
  <Layout>
    <Block>
      <Title>Welcome!</Title>
    </Block>
    <Block>
      <Paragraph>
        Your account <strong>{email}</strong> has been created successfully. You can sign in and
        start using the app.
      </Paragraph>
    </Block>
    <Block>
      <Paragraph>
        If you did not create this account, please contact our support team.
      </Paragraph>
    </Block>
    <Block disableMargin>
      <Signoff from="Support Team" />
    </Block>
  </Layout>
);
