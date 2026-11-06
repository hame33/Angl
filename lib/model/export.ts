/*
 * The version 5 export file: build it, and read any Angl export back in —
 * a version 5 file directly, versions 1–4 through the classic migrations.
 * Files come from anywhere, so a v5 file is validated field by field (zod)
 * rather than trusted.
 */
import { z } from 'zod';
import { libraryFromExport } from '../legacy/migrate.ts';
import { deterministicDeps } from '../legacy/read.ts';
import { legacyToV5 } from '../legacy/to-v5.ts';
import type { SkippedClip } from '../legacy/convert.ts';
import type { LibraryExport, LocalLibrary } from './types.ts';

export function buildExport(lib: LocalLibrary, extras: { durationModel: unknown; dictationLog: unknown[] }, now = new Date().toISOString()): LibraryExport {
  return {
    format: 'angl.library', version: 5, exportedAt: now,
    teams: lib.teams, films: lib.films, clips: lib.clips, drills: [], plans: [],
    durationModel: extras.durationModel ?? null, dictationLog: extras.dictationLog ?? [],
  };
}

const uuid = z.uuid();
const iso = z.iso.datetime({ offset: true });
const nullableUrl = z.string().regex(/^https:\/\//).nullable();
const video = z.object({ provider: z.literal('youtube'), videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/).nullable() });

const teamSchema = z.object({
  id: uuid, ownerId: uuid.nullable(), name: z.string().max(200), sport: z.string().max(40),
  createdAt: iso, updatedAt: iso, legacyId: z.string().max(100).nullable(),
});
const filmSchema = z.object({
  id: uuid, ownerId: uuid.nullable(), teamId: uuid.nullable(), title: z.string().max(300), video,
  categories: z.array(z.object({ name: z.string().max(200), emoji: z.string().max(16) })).max(200),
  createdAt: iso, updatedAt: iso, legacyId: z.string().max(100).nullable(),
});
const clipSchema = z.object({
  kind: z.literal('clip'), id: uuid, ownerId: uuid.nullable(), shareId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable(),
  visibility: z.enum(['private', 'unlisted', 'public']), title: z.string().min(1).max(200),
  tags: z.array(z.string().max(40)).max(20), createdVia: z.enum(['manual', 'import', 'ai']),
  createdAt: iso, updatedAt: iso, publishedAt: iso.nullable(), video,
  startSeconds: z.number().finite().min(0), endSeconds: z.number().finite(),
  markedStartSeconds: z.number().finite().nullable(), markedEndSeconds: z.number().finite().nullable(),
  notes: z.string().max(20000), coachingPoints: z.array(z.string().max(300)).max(30),
  credit: z.object({
    coachName: z.string().max(100).nullable(), url: nullableUrl, sourceTitle: z.string().max(300).nullable(),
    channelName: z.string().max(100).nullable(), channelUrl: nullableUrl,
  }),
  thumbnailUrl: z.string().regex(/^https:\/\/i\.ytimg\.com\//).nullable(),
  filmId: uuid.nullable(), category: z.string().max(200).nullable(),
  legacy: z.object({ id: z.string().max(100), index: z.number().int().min(0), gameId: z.string().nullable(), playlistId: z.string().nullable() }).nullable(),
}).refine(c => c.endSeconds > c.startSeconds, 'a clip must end after it starts');

const exportSchema = z.object({
  format: z.literal('angl.library'), version: z.literal(5),
  teams: z.array(teamSchema), films: z.array(filmSchema), clips: z.array(clipSchema),
  durationModel: z.unknown().optional(), dictationLog: z.array(z.unknown()).optional(),
});

export type ReadResult =
  | { ok: true; version: number; library: LocalLibrary; skipped: SkippedClip[]; extras: { durationModel: unknown; dictationLog: unknown[] } }
  | { ok: false; message: string };

export async function readExport(data: unknown): Promise<ReadResult> {
  if (data && typeof data === 'object' && (data as { format?: unknown }).format === 'angl.library') {
    const r = exportSchema.safeParse(data);
    if (!r.success) {
      const i = r.error.issues[0];
      return { ok: false, message: `This export file is damaged (${i?.path.join('.') || 'file'}: ${i?.message ?? 'invalid'}).` };
    }
    const d = r.data;
    return { ok: true, version: 5, library: { teams: d.teams, films: d.films, clips: d.clips }, skipped: [], extras: { durationModel: d.durationModel ?? null, dictationLog: d.dictationLog ?? [] } };
  }
  // A classic export (versions 1–4)
  // Deterministic ids, so importing the same old file twice can't duplicate its films
  const lib = libraryFromExport(data, deterministicDeps());
  if (!lib) return { ok: false, message: 'That isn’t an Angl export: it has no clips, games or playlists.' };
  const d = data as { version?: unknown; durationModel?: unknown; dictationLog?: unknown };
  const v5 = await legacyToV5(lib);
  return {
    ok: true, version: typeof d.version === 'number' ? d.version : 1,
    library: { teams: v5.teams, films: v5.films, clips: v5.clips }, skipped: v5.skipped,
    extras: { durationModel: d.durationModel ?? null, dictationLog: Array.isArray(d.dictationLog) ? d.dictationLog : [] },
  };
}
