import { Body, Container, Head, Html } from '@react-email/components';
import type { ReactNode } from 'react';
import { TailwindConfig } from '../config/tailwind-config';

type LayoutProps = {
  children: ReactNode;
};

export const Layout = ({ children }: LayoutProps) => (
  <Html>
    <Head />
    <TailwindConfig>
      <Body className="bg-slate-2 font-sans">
        <Container className="mx-auto max-w-[600px] px-6 py-8">{children}</Container>
      </Body>
    </TailwindConfig>
  </Html>
);
