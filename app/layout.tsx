import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Banho em Dia · Agenda do pet shop',
  description: 'Agenda simples para planos e atendimentos de banho e tosa.',
  openGraph: {
    title: 'Banho em Dia',
    description: 'Agenda simples para banho e tosa.',
    images: ['https://banho-em-dia.programador-vff.chatgpt.site/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Banho em Dia',
    description: 'Agenda simples para banho e tosa.',
    images: ['https://banho-em-dia.programador-vff.chatgpt.site/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${manrope.variable} antialiased`}>{children}</body>
    </html>
  );
}
