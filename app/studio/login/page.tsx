import { redirect } from 'next/navigation';
import { currentPublisher } from '@/lib/supabase/server';
import { LoginForm } from './LoginForm';
import styles from '../studio.module.css';

const REASONS: Record<string, string> = {
  expired: 'That sign-in link has expired or was already used. Ask for a new one.',
  invalid: 'That sign-in link didn’t work. Ask for a new one, and open it on the same device.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user } = await currentPublisher();
  if (user) redirect('/studio');
  const { error } = await searchParams;
  return (
    <main className={styles.stack}>
      <h1 className={styles.h1}>Sign in to the studio</h1>
      <p className={styles.muted}>We’ll email you a link. There’s no password.</p>
      {error && REASONS[error] && <p className={`${styles.status} ${styles.bad}`}>{REASONS[error]}</p>}
      <LoginForm />
    </main>
  );
}
