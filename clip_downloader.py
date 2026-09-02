#!/usr/bin/env python3
"""
Film Room Clip Downloader
=========================
Downloads and cuts clips from a Film Room JSON export into individual MP4s.

Usage:
    python clip_downloader.py filmroom-clips.json
    python clip_downloader.py filmroom-clips.json --playlist "Offence"
    python clip_downloader.py filmroom-clips.json --playlist "Offence" --output ./my_clips

Setup (needs Python 3.10+ — see note below):
    python3 -m venv filmroom-env
    source filmroom-env/bin/activate          # Windows: filmroom-env\\Scripts\\activate
    pip install -r requirements.txt

That's all — imageio-ffmpeg ships a static ffmpeg binary, so there's no need for
Homebrew or a system ffmpeg install. A system ffmpeg on PATH is used in
preference to the bundled one if you have one.

Build the venv with Python 3.10 or newer. yt-dlp dropped 3.9 support, so an
older interpreter silently pins you to a stale yt-dlp that YouTube has already
broken — which looks like a download failure, not a version problem. macOS
ships 3.9, so check `python3 --version` before blaming the downloader.
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
    playlists = data.get("playlists", [])
    clips     = data.get("clips", [])
    return playlists, clips


def pick_playlist(playlists, filter_name: str | None):
    """Return the playlist id to filter by, or None for all clips."""
    if not filter_name:
        return None, "All clips"
    for pl in playlists:
        if pl["name"].lower() == filter_name.lower():
            return pl["id"], pl["name"]
    # Fuzzy fallback
    matches = [pl for pl in playlists if filter_name.lower() in pl["name"].lower()]
    if len(matches) == 1:
        return matches[0]["id"], matches[0]["name"]
    if len(matches) > 1:
        err(f"Ambiguous playlist name '{filter_name}'. Matches:")
        for m in matches:
            print(f"    • {m['name']}")
        sys.exit(1)
    err(f"No playlist named '{filter_name}'.")
    print("  Available playlists:")
    for pl in playlists:
        print(f"    • {pl['name']}")
    sys.exit(1)


def group_by_video(clips: list) -> dict:
    """
    Group clips by their source video.

    Film Room stamps each clip with the YouTube videoId it was cut from, so a
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


def cut_clip(source: str, clip: dict, out_path: str, idx: int, total: int):
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
        "-crf",      "23",             # good quality / size balance
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
        description="Download Film Room clips as individual MP4 files."
    )
    parser.add_argument("json_file",              help="Path to filmroom-clips.json")
    parser.add_argument("--playlist", "-p",       help="Playlist name to export (default: all clips)")
    parser.add_argument("--output",   "-o",       help="Output folder (default: ./clips)", default="./clips")
    args = parser.parse_args()

    print()
    print(f"{C.BOLD}🏀 Film Room Clip Downloader{C.RESET}")
    print(f"{C.DIM}{'─' * 40}{C.RESET}")

    # 1. Check deps
    resolve_tools()

    # 2. Load JSON
    if not os.path.exists(args.json_file):
        err(f"File not found: {args.json_file}")
        sys.exit(1)
    playlists, all_clips = load_json(args.json_file)
    info(f"Loaded {len(all_clips)} clip(s) across {len(playlists)} playlist(s)")

    # 3. Filter by playlist
    pl_id, pl_name = pick_playlist(playlists, args.playlist)
    clips = all_clips if pl_id is None else [c for c in all_clips if c.get("playlistId") == pl_id]
    if not clips:
        warn("No clips found for that selection.")
        sys.exit(0)
    info(f"Exporting {bold(str(len(clips)))} clip(s) from {bold(pl_name)}")

    # 4. Group by source video
    grouped = group_by_video(clips)

    # 5. Create output folder
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    info(f"Output folder: {bold(str(out_dir.resolve()))}")

    # 6. Process each video source
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
                filename  = f"{global_idx+1:02d}_{safe_filename(label)}.mp4"
                out_path  = str(out_dir / filename)

                success = cut_clip(source_path, clip, out_path, global_idx, total_clips)
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
    print(f"{C.DIM}WhatsApp tip: files over 16 MB may not send — lower --crf if needed{C.RESET}")
    print()


if __name__ == "__main__":
    main()
