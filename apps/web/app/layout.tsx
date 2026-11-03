import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { FormFlowShell } from '../src/App';
import '../src/styles.css';
export const metadata: Metadata = {
  title: 'FormFlow Automation',
  description: 'Authorized Google Forms and Excel submission workflows',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <FormFlowShell>{children}</FormFlowShell>
        </Providers>
      </body>
    </html>
  );
}
