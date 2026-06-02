import { Text } from '@react-email/components';

type SignoffProps = {
  from: string;
};

export const Signoff = ({ from }: SignoffProps) => (
  <Text className="m-0 mt-4 text-body-md text-slate-11">— {from}</Text>
);
