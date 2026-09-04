# Contributing to Angl

Issues and pull requests are welcome. Angl is a small tool built by a coach and
used on real game film every week, so the bar for a change is simply: does this
help someone clip a game faster, and does it keep the project something one
person can still read in an evening.

A few things are load-bearing. They are listed here so you don't have to find
them out from a review comment.

## Keep the toolchain empty

Angl is one HTML file and one Python script. There is no build step, no
framework, no bundler, no transpiler, and no `node_modules`. You clone it, you
serve it, it runs.

This is a deliberate constraint, not an accident of an early project. A coach
who wants to change how their own film room behaves should be able to open
`index.html`, read it, edit it, and reload the page. Every layer between them
and that is a layer that turns "I fixed it myself" into "I gave up".

So: a change that adds a dependency has to earn it, and it should be argued for
in an issue before you write the code. "This library would make X neater" is not
enough on its own. "X is impossible to do correctly by hand and here is why" is
a real argument, and it might well win.

The Python side has exactly two pip dependencies — `yt-dlp` to fetch the source
video and `imageio-ffmpeg` to cut it — because doing either by hand is not
reasonable. That is the standard to clear.

## Running the tests

There are tests for the dictation parser and the clip-length model. They lift
the `<script>` block out of `index.html` and run it in a Node sandbox with a
fake DOM and a fake `localStorage`, so — consistent with the rule above — there
is still nothing to install:

```bash
node --test 'tests/*.test.mjs'
```

Quote the glob so Node expands it rather than your shell. Any recent Node works;
CI runs the current LTS.

If you are adding tests, `tests/load-app.mjs` is the sandbox. Internals reach
the tests through the `EPILOGUE` object at the bottom of that file — if the
function you want to test isn't on `__app` yet, add it there rather than
restructuring `index.html` to make it reachable.

## The timestamp parser

The timestamp parser is the delicate part of this codebase and it is commented
accordingly. It reads times the way people actually say them out loud —
"fifteen thirty four", "an hour and 42 seconds", "105:30" — and the rules that
decide what is *not* a time are as important as the ones that decide what is.
A label like "long two" or "and one" has to survive being read as a number.

**If your PR touches it, run the tests before you open the PR.** Not after the
review, not "it's a small change" — before. Most regressions here are silent:
the parser still returns a time, just the wrong one, and nobody notices until a
clip lands thirty seconds off during a Sunday night clip-up.

The same goes for the clip-length model. It learns from a coach's own playlist
names and their own words, and it is never hardcoded to any sport. Keep it that
way — a change that teaches it a sport's vocabulary is a change that breaks it
for every other sport.

## Never rename the `filmroom_` key prefix

Angl stores everything in `localStorage` under keys prefixed `filmroom_`. That
prefix predates the rename to Angl, it looks like leftover debris, and it is
deliberately kept. There is a comment saying so above `saveToStorage()` in
`index.html`.

`localStorage` is keyed by origin. Those keys hold every clip a user has already
tagged — potentially a whole season of somebody's unpaid Saturday mornings.
Renaming the prefix would strand that data behind keys nothing reads any more.
It would not look like data loss. It would look like an empty film room.

A cosmetic rename is never worth a silent data loss. If you are adding a new
stored key, prefix it `filmroom_` too, and match the existing pattern: read it
defensively, and let a corrupt key cost its own data and nothing else.

## Sport assumptions

Angl was built by a basketball coach, and basketball still shows through in
places. The data model is sport-agnostic and making the rest follow is the main
thing on the list.

If you coach something else and hit an assumption that doesn't fit your sport,
that is one of the most useful things you can report. There is an issue template
for exactly this: **[A sport assumption I hit](.github/ISSUE_TEMPLATE/sport-assumption.md)**.
You do not need to know where in the code it lives — describing what you said
and what you expected is the useful part.

## Commit messages

Commit messages describe the behaviour that changed, in plain English, present
tense. "Read a bare hour, minutes, seconds stopwatch call-out", not "refactor
timestamp parsing". Have a look at `git log` for the house style.
