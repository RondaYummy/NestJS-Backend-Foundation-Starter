import {
  Tailwind,
  type TailwindProps,
  pixelBasedPreset,
} from '@react-email/components';
import type { ReactNode } from 'react';

type TailwindConfigProps = TailwindProps & {
  children: ReactNode;
};

export const TailwindConfig = ({ children, ...props }: TailwindConfigProps) => (
  <Tailwind
    config={{
      presets: [pixelBasedPreset],
      theme: {
        extend: {
          colors: {
            brandPink: '#fAf4fd',
            white: '#ffffff',
            slate: {
              1: '#fcfcfd',
              2: '#f9f9fb',
              3: '#f0f0f3',
              4: '#e8e8ec',
              5: '#e0e1e6',
              6: '#d9d9e0',
              7: '#cdced6',
              8: '#b9bbc6',
              9: '#8b8d98',
              10: '#80838d',
              11: '#60646c',
              12: '#1c2024',
            },
            orange: {
              9: '#f76b15',
              12: '#582d1d',
            },
            green: {
              9: '#30a46c',
              12: '#193b2d',
            },
          },
          fontSize: {
            heading: ['1.5rem', { lineHeight: '2rem' }],
            'body-lg': ['1rem', { lineHeight: '1.5rem' }],
            'body-md': ['0.875rem', { lineHeight: '1.25rem' }],
            'body-sm': ['0.75rem', { lineHeight: '1rem' }],
          },
          fontWeight: {
            regular: '400',
            bold: '700',
          },
          fontFamily: {
            sans: ['Arial', 'sans-serif'],
          },
          borderRadius: {
            md: '0.5rem',
          },
        },
      },
    }}
    {...props}
  >
    {children}
  </Tailwind>
);
