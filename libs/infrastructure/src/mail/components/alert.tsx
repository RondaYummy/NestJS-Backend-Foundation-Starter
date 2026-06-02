import { Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

type AlertProps = {
  children: ReactNode;
  variant?: 'info' | 'success' | 'warning';
};

const variantClass: Record<NonNullable<AlertProps['variant']>, string> = {
  info: 'bg-slate-3 text-slate-12',
  success: 'bg-slate-3 text-green-12',
  warning: 'bg-slate-3 text-orange-12',
};

export const Alert = ({ children, variant = 'info' }: AlertProps) => (
  <Section className={`rounded-md px-4 py-3 ${variantClass[variant]}`}>
    <Text className="m-0 text-body-md">{children}</Text>
  </Section>
);
