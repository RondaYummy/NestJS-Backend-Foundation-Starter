import { Heading } from '@react-email/components';

type HeaderProps = {
  title: string;
};

export const Header = ({ title }: HeaderProps) => (
  <Heading className="m-0 mb-6 text-body-lg font-bold text-slate-12">{title}</Heading>
);
