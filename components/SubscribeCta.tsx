import { site } from '@/lib/site';
import styles from './SubscribeCta.module.css';

/* On every public page. A plain link rather than Substack's embed iframe: it
 * costs nothing to load and works in every in-app browser. */
export function SubscribeCta({ placement }: { placement: string }) {
  return (
    <aside className={styles.cta} aria-label="Subscribe">
      <div>
        <p className={styles.head}>More like this, in your inbox</p>
        <p className={styles.sub}>Clips, drills and session plans from the newsletter.</p>
      </div>
      <a
        className={styles.button}
        href={site.subscribeUrl}
        data-umami-event="subscribe_click"
        data-umami-event-placement={placement}
      >
        Subscribe on Substack
      </a>
    </aside>
  );
}
