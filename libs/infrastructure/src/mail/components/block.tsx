import { Section } from '@react-email/components';
import type { ReactNode } from 'react';

type BlockProps = {
  children: ReactNode;
  disableMargin?: boolean;
};

export const Block = ({ children, disableMargin }: BlockProps) => (
  <Section className={disableMargin ? 'mb-0' : 'mb-4'}>{children}</Section>
);
