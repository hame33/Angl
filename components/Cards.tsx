import Link from 'next/link';
import type { LibraryClip } from '@/lib/library';
import type { Post } from '@/lib/substack';
import { slugify } from '@/lib/text';
import styles from './Cards.module.css';

/* mqdefault is YouTube's 320×180 thumbnail: already 16:9, small, and always
 * there — right for a grid, where the clip page's large one would be waste. */
export function ClipCard({ clip }: { clip: LibraryClip }) {
  const slug = slugify(clip.title);
  const secs = Math.round(clip.endSeconds - clip.startSeconds);
  return (
    <li className={styles.card}>
      <Link href={`/clips/${clip.shareId}${slug ? `/${slug}` : ''}`} className={styles.link}>
        <img className={styles.thumb} src={`https://i.ytimg.com/vi/${clip.videoId}/mqdefault.jpg`}
             width={320} height={180} alt="" loading="lazy" decoding="async" />
        <span className={styles.body}>
          <span className={styles.title}>{clip.title}</span>
          <span className={styles.meta}>{secs}s{clip.coachName ? ` · ${clip.coachName}` : ''}</span>
        </span>
      </Link>
      {clip.tags.length > 0 && (
        <ul className={styles.tags} aria-label="Tags">
          {clip.tags.slice(0, 4).map(t => <li key={t}><Link href={`/library?tag=${encodeURIComponent(t)}`}>{t}</Link></li>)}
        </ul>
      )}
    </li>
  );
}

const DATE = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function PostCard({ post }: { post: Post }) {
  return (
    <li className={styles.post}>
      <a href={post.url} className={styles.postLink} data-umami-event="post_click">
        {post.image && <img className={styles.postImage} src={post.image} alt="" loading="lazy" decoding="async" width={96} height={96} />}
        <span className={styles.body}>
          {post.publishedAt && <span className={styles.meta}>{DATE.format(new Date(post.publishedAt))}</span>}
          <span className={styles.title}>{post.title}</span>
          {post.subtitle && <span className={styles.subtitle}>{post.subtitle}</span>}
        </span>
      </a>
    </li>
  );
}

export function ClipGrid({ clips }: { clips: LibraryClip[] }) {
  return <ul className={styles.grid}>{clips.map(c => <ClipCard key={c.shareId} clip={c} />)}</ul>;
}
export function PostList({ posts }: { posts: Post[] }) {
  return <ul className={styles.posts}>{posts.map(p => <PostCard key={p.url} post={p} />)}</ul>;
}
