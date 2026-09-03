#!/usr/bin/env python3
"""
Angl Clip Downloader
====================
Downloads and cuts clips from an Angl JSON export into individual MP4s.

Usage:
    python clip_downloader.py angl-clips.json
    python clip_downloader.py angl-clips.json --list
    python clip_downloader.py angl-clips.json --team "U16 Girls 2025"
    python clip_downloader.py angl-clips.json --game "Round 3 vs Eagles"
    python clip_downloader.py angl-clips.json --playlist "Offence"
    python clip_downloader.py angl-clips.json --team "U16 Girls 2025" --playlist "Offence"
    python clip_downloader.py angl-clips.json --playlist "Offence" --output ./my_clips

Clips nest team → game → playlist. A category name repeats across games (and
across teams), so `--playlist "Offence"` deliberately matches all of them — that
is how you pull one category for a whole season. Narrow with `--team` and/or
`--game`. Exports from older versions have no teams, or no games, and still work.

Setup:
    python3.13 -m venv angl-env
    source angl-env/bin/activate          # Windows: angl-env\\Scripts\\activate
    pip install -r requirements.txt

Note the explicit `python3.13` — not `python3`. macOS ships 3.9 as `python3`,
and yt-dlp dropped 3.9, so building the venv with it silently pins you to a
stale yt-dlp that YouTube has already broken. That surfaces as a download
failure ("The page needs to be reloaded") with nothing pointing at the
interpreter, which is a slow thing to diagnose. Any 3.10+ works; name the
version explicitly so you can't land on the system one by accident.

If `python3.13` isn't found, install it without needing admin rights:
    pip install --user uv && uv python install 3.13

That's all — imageio-ffmpeg ships a static ffmpeg binary, so there's no need for
Homebrew or a system ffmpeg install. A system ffmpeg on PATH is used in
preference to the bundled one if you have one.
"""

from __future__ import annotations
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


# ── Colours for terminal output ───────────────────────────────────────────────
class C:
    RESET  = "\033[0m"
    BOLD   = "\033[1m"
    GREEN  = "\033[92m"
    YELLOW = "\033[93m"
    RED    = "\033[91m"
    CYAN   = "\033[96m"
    DIM    = "\033[2m"

def ok(msg):   print(f"{C.GREEN}✓{C.RESET}  {msg}")
def info(msg): print(f"{C.CYAN}→{C.RESET}  {msg}")
def warn(msg): print(f"{C.YELLOW}⚠{C.RESET}  {msg}")
def err(msg):  print(f"{C.RED}✗{C.RESET}  {msg}")
def bold(msg): return f"{C.BOLD}{msg}{C.RESET}"


# ── Tool resolution ───────────────────────────────────────────────────────────
# Filled in by resolve_tools() at startup. Neither tool has to be on PATH: both
# are pip-installable, so a virtualenv is enough and Homebrew is never required.
YTDLP = ["yt-dlp"]
FFMPEG = "ffmpeg"


def find_ffmpeg() -> str | None:
    """ffmpeg from PATH, else the static build bundled with imageio-ffmpeg."""
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass
    return None


def find_ytdlp() -> list | None:
    """yt-dlp as a CLI, else run it as a module on the current interpreter."""
    on_path = shutil.which("yt-dlp")
    if on_path:
        return [on_path]
    try:
        import yt_dlp  # noqa: F401
        return [sys.executable, "-m", "yt_dlp"]
    except ImportError:
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────
def resolve_tools():
    """Locate yt-dlp and ffmpeg, or explain how to install them."""
    global YTDLP, FFMPEG
    ytdlp, ffmpeg = find_ytdlp(), find_ffmpeg()

    missing = []
    if not ytdlp:
        missing.append("yt-dlp")
    if not ffmpeg:
        missing.append("ffmpeg")
    if missing:
        err(f"Missing dependencies: {', '.join(missing)}")
        print()
        print("  Install both with pip — no Homebrew needed:")
        print(f"      {C.BOLD}pip install yt-dlp imageio-ffmpeg{C.RESET}")
        print()
        print(f"  {C.DIM}imageio-ffmpeg ships a static ffmpeg binary, so this works")
        print(f"  inside a plain virtualenv on any platform.{C.RESET}")
        sys.exit(1)

    YTDLP, FFMPEG = ytdlp, ffmpeg
    if not shutil.which("ffmpeg"):
        info(f"{C.DIM}using bundled ffmpeg from imageio-ffmpeg{C.RESET}")


def safe_filename(s: str) -> str:
    """Turn a clip label into a safe filename."""
    s = re.sub(r'[^\w\s\-]', '', s)
    s = re.sub(r'\s+', '_', s.strip())
    return s[:60] or "clip"


def extract_video_id(url: str) -> str | None:
    """Pull the YouTube video id out of any of the usual URL shapes."""
    patterns = [
        r"youtu\.be/([^?&\s/#]+)",
        r"[?&]v=([^&\s#]+)",
        r"youtube\.com/embed/([^?&\s/#]+)",
        r"youtube\.com/shorts/([^?&\s/#]+)",
        r"youtube\.com/v/([^?&\s/#]+)",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


def fmt_time(sec: float) -> str:
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def load_json(path: str):
    with open(path) as f:
        data = json.load(f)
    teams     = data.get("teams", [])       # absent in pre-teams exports
    games     = data.get("games", [])       # absent in pre-games exports
    playlists = data.get("playlists", [])
    clips     = data.get("clips", [])
    return teams, games, playlists, clips


def match_by_name(items: list, key: str, wanted: str) -> list:
    """Exact (case-insensitive) matches if there are any, else substring ones."""
    w = wanted.lower()
    exact = [i for i in items if str(i.get(key, "")).lower() == w]
    return exact or [i for i in items if w in str(i.get(key, "")).lower()]


def print_game(g, playlists, clips, indent="  "):
    g_clips = [c for c in clips if c.get("gameId") == g["id"]]
    print(f"{indent}{bold(g.get('title', 'Untitled'))}  {C.DIM}({len(g_clips)} clip(s)){C.RESET}")
    for pl in [p for p in playlists if p.get("gameId") == g["id"]]:
        n = len([c for c in clips if c.get("playlistId") == pl["id"]])
        print(f"{indent}    • {pl['name']}  {C.DIM}({n}){C.RESET}")


def print_library(teams, games, playlists, clips):
    """Show what's in the export so you can copy a name into --team/--game/--playlist."""
    if teams:
        for t in teams:
            t_games = [g for g in games if g.get("teamId") == t["id"]]
            ids = {g["id"] for g in t_games}
            n = len([c for c in clips if c.get("gameId") in ids])
            print(f"\n{C.CYAN}{bold(t.get('name', 'Untitled team'))}{C.RESET}"
                  f"  {C.DIM}({len(t_games)} game(s), {n} clip(s)){C.RESET}")
            for g in t_games:
                print()
                print_game(g, playlists, clips, indent="    ")
        orphans = [g for g in games if not g.get("teamId")]
        if orphans:
            print(f"\n{C.DIM}(no team){C.RESET}")
            for g in orphans:
                print_game(g, playlists, clips, indent="    ")
    elif games:
        for g in games:
            print()
            print_game(g, playlists, clips)
    else:
        print(f"\n  {C.DIM}(no games in this export){C.RESET}")
        for pl in playlists:
            n = len([c for c in clips if c.get("playlistId") == pl["id"]])
            print(f"      • {pl['name']}  {C.DIM}({n}){C.RESET}")
    print()


def pick_team(teams: list, name: str):
    """Resolve --team to exactly one team, or explain what's available."""
    matches = match_by_name(teams, "name", name)
    if len(matches) == 1:
        return matches[0]
    if not matches:
        err(f"No team matching '{name}'.")
    else:
        err(f"Ambiguous team name '{name}'. Matches:")
        for m in matches:
            print(f"    • {m.get('name')}")
        sys.exit(1)
    print("  Available teams:")
    for t in teams:
        print(f"    • {t.get('name')}")
    sys.exit(1)


def pick_game(games: list, name: str):
    """Resolve --game to exactly one game, or explain what's available."""
    matches = match_by_name(games, "title", name)
    if len(matches) == 1:
        return matches[0]
    if not matches:
        err(f"No game matching '{name}'.")
    else:
        err(f"Ambiguous game name '{name}'. Matches:")
        for m in matches:
            print(f"    • {m.get('title')}")
        sys.exit(1)
    print("  Available games:")
    for g in games:
        print(f"    • {g.get('title')}")
    sys.exit(1)


def select_clips(teams, games, playlists, clips, team_name, game_name, playlist_name):
    """
    Narrow the export by team, game and/or playlist.

    A playlist name is matched across every game in scope unless --game pins it
    to one, so "Offence" pulls that category for a whole season in one run.
    """
    selected = clips
    parts = []

    # Team first — it bounds which games --game and --playlist can even see
    if team_name:
        if not teams:
            err("This export has no teams in it — drop --team.")
            sys.exit(1)
        team = pick_team(teams, team_name)
        games = [g for g in games if g.get("teamId") == team["id"]]
        ids = {g["id"] for g in games}
        playlists = [p for p in playlists if p.get("gameId") in ids]
        selected = [c for c in selected if c.get("gameId") in ids]
        parts.append(team.get("name", "team"))

    game = None
    if game_name:
        if not games:
            err("This export has no games in it — drop --game.")
            sys.exit(1)
        game = pick_game(games, game_name)
        selected = [c for c in selected if c.get("gameId") == game["id"]]
        parts.append(game.get("title", "game"))

    if playlist_name:
        pool = playlists if game is None else [p for p in playlists if p.get("gameId") == game["id"]]
        matches = match_by_name(pool, "name", playlist_name)
        if not matches:
            err(f"No playlist named '{playlist_name}'" + (f" in {game.get('title')}." if game else "."))
            print("  Available playlists:")
            for n in sorted({p["name"] for p in pool}):
                print(f"    • {n}")
            sys.exit(1)
        ids = {p["id"] for p in matches}
        selected = [c for c in selected if c.get("playlistId") in ids]
        names = sorted({p["name"] for p in matches})
        parts.append(" / ".join(names))
        # Spanning games is intended, but say so — it changes what you get
        if game is None and len(matches) > 1:
            spanned = len({p.get("gameId") for p in matches})
            scope = "game(s)" if team_name else "game(s) across every team"
            info(f"'{playlist_name}' matched {len(matches)} playlist(s) across {spanned} {scope}")

    return selected, " · ".join(parts) if parts else "All clips"


def group_by_video(clips: list) -> dict:
    """
    Group clips by their source video.

    Angl stamps each clip with the YouTube videoId it was cut from, so a
    playlist spanning several games downloads each game once and cuts from the
    right source. Older exports predate that field — we prompt once for those,
    and only for those.

    Returns dict: video_url -> [clips]
    """
    grouped: dict[str, list] = {}
    legacy = []

    for c in clips:
        vid = c.get("videoId")
        if vid:
            grouped.setdefault(f"https://www.youtube.com/watch?v={vid}", []).append(c)
        else:
            legacy.append(c)

    if legacy:
        print()
        warn(f"{len(legacy)} clip(s) have no source video stored (exported before videoId was added).")
        url = input("  Paste the YouTube URL for those clips: ").strip()
        if not url:
            err("No URL provided.")
            sys.exit(1)
        # Normalise so a youtu.be link merges with an existing watch?v= group
        # instead of downloading the same film twice.
        vid = extract_video_id(url)
        key = f"https://www.youtube.com/watch?v={vid}" if vid else url
        grouped.setdefault(key, []).extend(legacy)

    if len(grouped) > 1:
        info(f"Clips span {bold(str(len(grouped)))} source videos")

    return grouped


# YouTube periodically breaks whichever internal player client yt-dlp defaults to.
# Rather than pin one, try the default first and fall back through the others.
# None = yt-dlp's own default.
PLAYER_CLIENTS = [None, "android", "tv", "ios", "web_safari", "mweb"]


def download_full_video(url: str, tmp_dir: str) -> str:
    """Download best quality MP4 to a temp file. Returns local path."""
    out_template = os.path.join(tmp_dir, "source.%(ext)s")
    info("Downloading video (this may take a minute)…")

    last_err = ""
    for attempt, client in enumerate(PLAYER_CLIENTS):
        cmd = [
            *YTDLP,
            "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "--ffmpeg-location", FFMPEG,   # yt-dlp merges streams itself
            "--output", out_template,
            "--no-playlist",
            "--quiet",
            "--progress",
        ]
        if client:
            cmd += ["--extractor-args", f"youtube:player_client={client}"]
        cmd.append(url)

        # Let progress print to stdout; capture stderr so we can report failures.
        result = subprocess.run(cmd, stderr=subprocess.PIPE, text=True)
        if result.returncode == 0:
            if client:
                info(f"{C.DIM}(downloaded via the {client} player client){C.RESET}")
            break

        last_err = result.stderr or ""
        # Clear partial downloads before retrying with a different client
        for f in Path(tmp_dir).iterdir():
            try:
                f.unlink()
            except OSError:
                pass
        if attempt < len(PLAYER_CLIENTS) - 1:
            warn(f"YouTube rejected that request — retrying as '{PLAYER_CLIENTS[attempt + 1]}'…")
    else:
        err("yt-dlp could not download this video.")
        if last_err:
            print(f"{C.DIM}{last_err.strip()[-600:]}{C.RESET}")
        print()
        print("  Every player client was refused. Usually that means yt-dlp is")
        print("  out of date relative to YouTube's latest change:")
        print(f"      {C.BOLD}pip install --upgrade yt-dlp{C.RESET}")
        print()
        print(f"  {C.DIM}If that reports you're already current, this Python may be too old")
        print(f"  to receive newer yt-dlp releases — check `python3 --version` (needs 3.10+).{C.RESET}")
        sys.exit(1)

    # Find the downloaded file
    for f in Path(tmp_dir).iterdir():
        if f.stem == "source":
            return str(f)
    err("Could not find downloaded file.")
    sys.exit(1)


def cut_clip(source: str, clip: dict, out_path: str, idx: int, total: int, crf: int = 23):
    """Cut a single clip from the source file using ffmpeg."""
    start    = clip["effStart"]
    duration = clip["effEnd"] - clip["effStart"]
    label    = clip.get("label", f"Clip {idx+1}")

    print(f"\n  [{idx+1}/{total}] {bold(label)}  {C.DIM}({fmt_time(start)} → {fmt_time(clip['effEnd'])}){C.RESET}")

    result = subprocess.run([
        FFMPEG,
        "-ss",       str(start),       # seek before input (fast)
        "-i",        source,
        "-t",        str(duration),
        "-c:v",      "libx264",        # re-encode for clean cut + WhatsApp compat
        "-c:a",      "aac",
        "-preset",   "fast",
        "-crf",      str(crf),         # higher = smaller file, lower quality
        "-movflags", "+faststart",     # streaming-friendly (important for WhatsApp)
        "-y",                          # overwrite if exists
        out_path,
    ], capture_output=True, text=True)

    if result.returncode != 0:
        warn(f"ffmpeg error for '{label}':")
        print(result.stderr[-500:])
        return False

    size_mb = os.path.getsize(out_path) / 1_048_576
    ok(f"Saved  {Path(out_path).name}  ({size_mb:.1f} MB)")
    return True


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Download Angl clips as individual MP4 files."
    )
    parser.add_argument("json_file",        help="Path to angl-clips.json")
    parser.add_argument("--team",     "-t", help="Team or season to export (default: every team)")
    parser.add_argument("--game",     "-g", help="Game title to export (default: every game)")
    parser.add_argument("--playlist", "-p", help="Playlist name to export; matches across games unless --game is given")
    parser.add_argument("--output",   "-o", help="Output folder (default: ./clips)", default="./clips")
    parser.add_argument("--list",     "-l", action="store_true", help="List the games and playlists, then exit")
    parser.add_argument("--crf", type=int, default=23, metavar="N",
                        help="x264 quality, 0-51 (default: 23). Higher makes smaller, "
                             "lower-quality files; 28 is a good size-first choice")
    args = parser.parse_args()

    # Outside 0-51 ffmpeg either errors or produces something unusable, and the
    # failure only shows up per-clip after the film has already downloaded.
    if not 0 <= args.crf <= 51:
        parser.error("--crf must be between 0 and 51 (default 23; higher = smaller file)")

    print()
    print(f"{C.BOLD}Angl Clip Downloader{C.RESET}")
    print(f"{C.DIM}{'─' * 40}{C.RESET}")

    # 1. Load JSON
    if not os.path.exists(args.json_file):
        err(f"File not found: {args.json_file}")
        sys.exit(1)
    teams, games, playlists, all_clips = load_json(args.json_file)
    info(f"Loaded {len(all_clips)} clip(s) · {len(playlists)} playlist(s) · "
         f"{len(games)} game(s) · {len(teams)} team(s)")

    # 2. --list only reads the export, so don't make it wait on yt-dlp/ffmpeg
    if args.list:
        print_library(teams, games, playlists, all_clips)
        sys.exit(0)

    # 3. Check deps
    resolve_tools()

    # 4. Filter by game and/or playlist
    clips, selection = select_clips(teams, games, playlists, all_clips,
                                    args.team, args.game, args.playlist)
    if not clips:
        warn("No clips found for that selection.")
        sys.exit(0)
    info(f"Exporting {bold(str(len(clips)))} clip(s) from {bold(selection)}")

    # 4. Group by source video
    grouped = group_by_video(clips)

    # 5. Create output folder
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    info(f"Output folder: {bold(str(out_dir.resolve()))}")

    # 6. Process each video source
    # A category pulled across a season yields same-named clips from different
    # games — prefix with the game so the files stay tellable apart.
    titles = {g["id"]: g.get("title", "") for g in games}
    span_games = len({c.get("gameId") for c in clips if c.get("gameId")}) > 1

    total_ok = 0
    total_clips = sum(len(v) for v in grouped.values())
    global_idx = 0

    for video_url, video_clips in grouped.items():
        print()
        print(f"{C.BOLD}Video:{C.RESET} {video_url}")

        with tempfile.TemporaryDirectory() as tmp_dir:
            source_path = download_full_video(video_url, tmp_dir)
            ok(f"Downloaded to temp file")

            for clip in video_clips:
                label     = clip.get("label", f"Clip {global_idx+1}")
                prefix    = ""
                if span_games and titles.get(clip.get("gameId")):
                    prefix = safe_filename(titles[clip["gameId"]])[:24] + "__"
                filename  = f"{global_idx+1:02d}_{prefix}{safe_filename(label)}.mp4"
                out_path  = str(out_dir / filename)

                success = cut_clip(source_path, clip, out_path, global_idx, total_clips, args.crf)
                if success:
                    total_ok += 1
                global_idx += 1

    # 7. Summary
    print()
    print(f"{C.DIM}{'─' * 40}{C.RESET}")
    if total_ok == total_clips:
        ok(f"All {total_ok} clip(s) exported to {bold(str(out_dir.resolve()))}")
    else:
        warn(f"{total_ok}/{total_clips} clip(s) exported ({total_clips - total_ok} failed)")

    print()
    # Raising CRF shrinks the file — the reverse of what this tip used to say.
    suggest = min(args.crf + 5, 51)
    print(f"{C.DIM}WhatsApp tip: files over 16 MB may not send — re-run with a higher --crf")
    print(f"  to shrink them (you used {args.crf}; try --crf {suggest}). Higher trades quality for size.{C.RESET}")
    print()


if __name__ == "__main__":
    main()
