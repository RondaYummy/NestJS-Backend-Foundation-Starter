import { Text } from '@react-email/components';

type FooterProps = {
  children?: string;
};

export const Footer = ({ children = '© App. All rights reserved.' }: FooterProps) => (
  <Text className="m-0 mt-6 text-body-sm text-slate-9">{children}</Text>
);
