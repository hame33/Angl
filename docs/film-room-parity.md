# Film room parity checklist

Every action in classic Angl (`index.html`) and its equivalent in the new film room
(`/film-room`). Phase 5 of [PLAN.md](../PLAN.md) is complete when every non-dictation row is ✅.
Classic function names are in brackets.

✅ ported · 🔁 works differently, on purpose · ⏭ later phase (named)

## Teams

| Classic | Film room | |
|---|---|---|
| Create a team with a sport (`createTeam`) | Dashboard → New team | ✅ |
| Team names unique, ignoring case | Same rule (`lib/filmroom/ops.ts`) | ✅ |
| Rename a team | Team settings → Rename | ✅ |
| Change a team's sport; only new games use it (`setTeamSport`) | Team settings → sport | ✅ |
| Delete a team with its games and clips (`deleteTeam`) | Team settings → Delete team | ✅ |
| Switch team, or the mixed "All teams" view (`selectTeam`) | Team switcher, with "All teams" when there are two or more | ✅ |
| Land on a real team, not the mixed view | Same | ✅ |

## Games (films)

| Classic | Film room | |
|---|---|---|
| Add a game from a YouTube link, optional title (`createGame`) | Dashboard → Add a film | ✅ |
| Link parsing (`extractVideoId`) | `parseVideoUrl`: YouTube hosts only, plus `live/` and mobile links | 🔁 stricter |
| No team yet → "My team" is made | Same | ✅ |
| The same film in the same team opens the existing game | Same, and says so | ✅ |
| New game inherits the previous game's playlists (`seedPlaylists`) | Same | ✅ |
| Untitled game takes the video's own title (`tryAutoTitle`) | Same, once; a typed title always wins | ✅ |
| Rename a game | Film view → Rename | ✅ |
| Delete a game and its clips (`deleteGame`) | Dashboard film card → Delete film | ✅ |
| Switch game from the film view (`renderGameSwitcher`) | Categories panel → Switch film | ✅ |

## Playlists (categories)

| Classic | Film room | |
|---|---|---|
| Create a playlist with an emoji, per game (`createPlaylist`) | Categories → New category, sport's emoji first | ✅ |
| Names unique within a game | Same | ✅ |
| Rename a playlist | ✎ | ✅ (its clips follow it) |
| Delete: clips move to General in the same game, made if needed (`deletePlaylist`) | ✕, same rule | ✅ |
| "All clips" in a game, or one playlist | Same | ✅ |
| Cross-game category, rolled up by name (`openCategory`, `categoryRollup`) | Dashboard → Categories across every film | ✅ |
| "Showing X across every game — back to this game" banner | Same | ✅ |

## Clips

| Classic | Film room | |
|---|---|---|
| Start/end times, "↓ current" (`captureTime`) | Add clip → ↓ Now | ✅ |
| Buffers before/after, 0–15 s in 0.5 s steps | Same sliders | ✅ |
| Label, defaulting to "Clip N" | Same | ✅ |
| Playlist, falling back to the game's first, or a new General (`addClip`) | Same | ✅ |
| Blank end → length learned from your clips (`resolveDuration`) | Blank end → 5 s | ⏭ Phase 6 (the duration model comes with dictation) |
| Play a clip from its start (`playClipAtIdx`) | Tap the clip | ✅ |
| Clip end enforced while playing (`startWatcher`) | Same, watcher ignores the next film loading | ✅ |
| Previous / next clip, wrapping (`prevClip`, `nextClip`) | ⏮ ⏭ | ✅ |
| Loop the clip | Loop | ✅ |
| Play all, across games in a category view (`playAll`) | ▶ Play all | ✅ |
| Free scrub: clip limits off (`setFreeMode`) | Free scrub | ✅ |
| Scrubbing outside the clip turns free scrub on (`nudge`) | Same | ✅ |
| Move a clip to another playlist in its own game (`confirmMove`) | Edit → Category | ✅ |
| Delete a clip | Edit → Delete clip | ✅ |
| Clear the list in view, with a confirm naming the scope (`clearAllClips`) | Clear list | ✅ |
| Timecode that stays right while paused (`updateTimecode`) | Same | ✅ |
| Progress bar with the clip marked on it | Same | ✅ |
| — | Notes, coaching points, tags, credit on each clip | 🔁 new |
| — | Edit a clip's times and buffers after saving | 🔁 new |

## Keyboard (desktop)

| Classic | Film room | |
|---|---|---|
| Space: play or pause | Same | ✅ |
| ← / →: scrub 10 s | Same | ✅ |
| Shift+← / Shift+→: previous / next clip | Same | ✅ |
| Clicking the video doesn't steal the keys | Same blur trick | ✅ |
| Hold a key to dictate | — | ⏭ Phase 6 |

## Dashboard

| Classic | Film room | |
|---|---|---|
| Stats: games, clips, categories, footage | Same | ✅ |
| Game cards with thumbnail and playlist chips | Same; a chip opens that category | ✅ |
| Categories across every game, with bar and durations | Same | ✅ |
| Recent clips, tap to play | Same | ✅ |

## Library file

| Classic | Film room | |
|---|---|---|
| Export JSON (version 4) | Export library (version 5) | 🔁 Phase 4 |
| Import replaces the whole library, after a confirm | Import adds only what's new and never overwrites | 🔁 Phase 4 (safer) |

## Settings and dictation

| Classic | Film room | |
|---|---|---|
| Dictation, parser, confirm cards, dictation log, LLM settings, hotkey | — | ⏭ Phase 6 |

## Not ported, on purpose

- **Visibility (private / unlisted / public) on a film-room clip.** Sharing needs the server, so it stays in the studio until Phase 7 syncs the two. The film room is private to this browser.
