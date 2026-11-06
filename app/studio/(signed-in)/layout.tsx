import { redirect } from 'next/navigation';
import { currentPublisher } from '@/lib/supabase/server';
import { signOut } from '../actions';
import styles from '../studio.module.css';

/* Every studio page but sign-in. Signed out goes to sign-in; signed in
 * without a publisher row is told so, because RLS would refuse every save. */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const { user, isPublisher } = await currentPublisher();
  if (!user) redirect('/studio/login');

  return (
    <div className={styles.stack}>
      <div className={`${styles.row} ${styles.between}`}>
        <span className={styles.muted}>Signed in as {user.email}</span>
        <form action={signOut}><button className={styles.ghost}>Sign out</button></form>
      </div>
      {isPublisher ? children : (
        <main className={styles.panel}>
          <h1 className={styles.h1}>This account can’t publish</h1>
          <p className={styles.muted}>Only accounts on the publisher list can import or share clips.</p>
        </main>
      )}
    </div>
  );
}
