import { Column, Row } from '@react-email/components';
import type { ReactNode } from 'react';

type CellProps = {
  children: ReactNode;
};

export const Cell = ({ children }: CellProps) => (
  <Row>
    <Column>{children}</Column>
  </Row>
);
