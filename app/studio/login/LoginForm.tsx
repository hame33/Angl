'use client';

import { useActionState } from 'react';
import { signIn, type FormState } from '../actions';
import styles from '../studio.module.css';

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, { ok: false, message: '' });
  return (
    <form action={action} className={styles.panel}>
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" inputMode="email"
               className={styles.input} placeholder="you@example.com" />
      </div>
      <div className={styles.row}>
        <button className={styles.button} disabled={pending}>{pending ? 'Sending…' : 'Email me a sign-in link'}</button>
      </div>
      {state.message && (
        <p role="status" className={`${styles.status} ${state.ok ? styles.ok : styles.bad}`}>{state.message}</p>
      )}
    </form>
  );
}
