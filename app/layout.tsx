import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { PwaRegistration } from '@/components/pwa-registration';
import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'HEIN PET SALON · Agenda de banho e tosa',
  description: 'Agenda simples para planos e atendimentos de banho e tosa.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'HEIN PET',
  },
  openGraph: {
    title: 'HEIN PET SALON',
    description: 'Agenda simples para banho e tosa.',
    images: ['https://banho-em-dia.programador-vff.chatgpt.site/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HEIN PET SALON',
    description: 'Agenda simples para banho e tosa.',
    images: ['https://banho-em-dia.programador-vff.chatgpt.site/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#7353a6',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${manrope.variable} antialiased`}>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
