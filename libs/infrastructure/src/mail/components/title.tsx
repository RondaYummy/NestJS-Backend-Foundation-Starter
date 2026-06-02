import { Heading } from '@react-email/components';
import type { ReactNode } from 'react';

type TitleProps = {
  children: ReactNode;
};

export const Title = ({ children }: TitleProps) => (
  <Heading className="m-0 text-heading font-bold text-slate-12">{children}</Heading>
);
