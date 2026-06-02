import { Section, Text } from '@react-email/components';

type OtpCodeProps = {
  code: string;
};

export const OtpCode = ({ code }: OtpCodeProps) => (
  <Section className="rounded-md bg-slate-3 px-6 py-4 text-center">
    <Text className="m-0 font-bold tracking-[0.3em] text-slate-12 text-[2rem] leading-[3rem]">
      {code}
    </Text>
  </Section>
);
