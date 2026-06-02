import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

type ParagraphProps = {
  children: ReactNode;
};

export const Paragraph = ({ children }: ParagraphProps) => (
  <Text className="m-0 text-body-md text-slate-11">{children}</Text>
);
