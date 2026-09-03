# Angl

**An open-source film room for coaches. Clip a game by talking to it.**

Angl turns game film you already have on YouTube into a tagged, searchable clip
library — then cuts those clips into real MP4 files you can put in front of your
team. It runs entirely on your own machine. No account, no upload, no subscription.

![Angl's film library — three games, tagged clips grouped by category](docs/screenshot.png)

---

## Why this exists

Hudl, Veo and the rest are good products. They are also expensive, they want your
film on their servers, and they charge per team per season — which is fine for a
program with a budget and rough for a volunteer coaching two age groups on a
Saturday.

Angl takes the opposite position:

- **Your film stays where it is.** Angl points at a YouTube URL. It never uploads
  anything, and it never asks you to re-host your game.
- **Your clips stay yours.** Everything lives in your browser and exports to a
  plain JSON file you own. There is no account to lock you out and nothing to
  cancel.
- **It works offline.** Once the page is served, tagging clips needs no network at
  all. Only playback and the optional dictation parsing do.
- **It is one HTML file.** You can read it, change it, and fork it. That is the
  whole point.

The trade-off is honest: Angl has no auto-tracking, no AI player detection, and no
team-sharing portal. It is a fast manual clipping tool for a coach who knows what
they are looking for.

## How it works

Film is organised **team → game → playlist**, so a club coach running two squads
across a season doesn't end up with one undifferentiated pile of clips.

1. Paste a YouTube URL to add a game.
2. Scrub to a moment, set start and end, label it, drop it in a category.
3. Or hold the dictation key and just say it out loud — *"clip that, defence,
   closeout was too long"* — and Angl parses it into a labelled clip.
4. Export the library as JSON, then run the downloader to cut real MP4s.

Clip buffers are adjustable per clip, so you can grab the two seconds before the
play starts without re-scrubbing.

## Quick start

```bash
git clone https://github.com/hame33/Angl.git
cd Angl
./serve.sh
```

That serves the page at **http://localhost:8777** and opens it. Paste a YouTube
URL and start clipping.

> **Why a server instead of just opening the file?** The YouTube player is
> unreliable over `file://` URLs, and browser storage is keyed to the origin — so
> your clips only exist at one specific address.

## ⚠️ Where your clips live — read this once

Your clips are stored in **browser local storage, keyed to `http://localhost:8777`**.
That has three consequences worth knowing before you tag a whole season:

- **Serving on a different port hides your clips.** They are not gone — they are
  under the old origin. Use the default port, every time.
- **Clearing site data deletes them.** So does a "clean up browsing data" sweep
  that includes localhost.
- **They are per-browser and per-machine.** Clips tagged in Chrome are not visible
  in Safari, and not visible on your other laptop.

**So: export regularly.** The Export button writes `angl-clips.json`. That file is
the real backup, and it is also the input to the clip downloader. Treat exporting
like saving a document — because that is exactly what it is.

## Cutting clips into MP4s

The downloader reads an export and cuts each clip out of the source video.

```bash
python3.13 -m venv angl-env
source angl-env/bin/activate          # Windows: angl-env\Scripts\activate
pip install -r requirements.txt

python clip_downloader.py angl-clips.json
```

Note the explicit `python3.13` rather than `python3` — macOS ships 3.9, yt-dlp has
dropped 3.9, and building the venv with the system Python silently pins you to a
stale yt-dlp that YouTube has already broken. Any 3.10+ works. If `python3.13`
isn't found, `pip install --user uv && uv python install 3.13` installs one without
admin rights.

Filter what you pull:

```bash
python clip_downloader.py angl-clips.json --list
python clip_downloader.py angl-clips.json --team "U16 Girls 2026"
python clip_downloader.py angl-clips.json --game "Round 7 vs Eagles"
python clip_downloader.py angl-clips.json --playlist "Defence"
python clip_downloader.py angl-clips.json --playlist "Offence" --output ./my_clips
```

Category names repeat across games on purpose, so `--playlist "Defence"` pulls that
category for a whole season. Narrow it with `--team` and `--game`.

Both dependencies are pure pip installs — no Homebrew, no system ffmpeg.

## Dictation

Dictation is optional. Hold the configured key (Right Alt by default), describe the
clip, release. Angl ships with a built-in offline parser that needs no account and
no key. If you want better parsing of messy speech, you can point it at an LLM in
Settings — Anthropic's Messages API or any OpenAI-compatible endpoint — using your
own key, which is stored locally and sent nowhere else.

## Status

Angl is built by a basketball coach and used every week on real game film. It works,
and it is early.

Basketball shows through in a couple of places — mainly the dictation parser, which
knows that "long two" and "and one" are labels rather than numbers. The data model
itself is sport-agnostic, and making the rest follow is the main thing on the list.
If you coach something else and hit a basketball assumption, please open an issue;
that is the most useful contribution right now.

## Contributing

Issues and pull requests are welcome. The project is deliberately small: one HTML
file, one Python script, no build step and no framework. Please keep it that way —
a change that adds a toolchain needs to earn it.

## License

MIT — see [LICENSE](LICENSE).
