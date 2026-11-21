---
name: site-narrator
description: Give a website a pre-recorded voice with no paid speech service. Collects the lines of text a site should be able to read aloud, records each one locally with the free Kokoro text-to-speech model, names every MP3 by a hash of its text, and plays the right file in the browser with a small dependency-free player (queue, stop, per-line events, loudness level for a talking mouth, voice on/off). Use whenever the user wants a page, article, docs site, guide, tutorial or character to "read aloud", "speak", "narrate", have a "listen" button, "text to speech", "TTS", "voice-over for the site", "audio version of this page", or wants to re-record, re-voice, fix a pronunciation in, or check narration made this way.
---

# site-narrator

Local pipeline: **collect** the lines → **record** each with Kokoro TTS into `<hash>.mp3` → **manifest + verify** → **play** in the browser by hashing the same text. The site serves static MP3 files. Nothing is generated while a visitor listens, and nothing is uploaded.

Skill folder: `~/.claude/skills/site-narrator/` (written below as `$N`). Every command is `$N/narrate <command> [project]`. `$N/narrate help` lists them.

```
$N/narrate               the command line (check, voices, collect, record, manifest, verify, serve, test)
$N/cli/record.py         Kokoro -> MP3 (run by `narrate record`)
$N/cli/lib/              collectors, pronunciation fixes, recording plan, MP3 length, manifest, verify
$N/player/player.js      the browser player: copy this one file into the site
$N/examples/demo/        a working page with committed recordings
$N/README.md             install, licences, limits, the player's full API
```

## What it cannot do

Say these to the user before starting if they matter:

- A fixed list of Kokoro voices. **No voice cloning**, no "make it sound like me".
- Only text known ahead of time. Visitor input and per-request text cannot be spoken.
- Every text edit needs `narrate record` again. Until then that line is silent (the player reports `missing` and moves on).
- About 4 KB per second of speech at the default 32 kbit/s (about 240 KB a minute).
- You cannot hear the result. You can check that files exist, have the right length and are not silent. The user has to listen for pronunciation and tone.

## Workflow

1. **Check the machine** with `$N/narrate check`. It tells you how to fix anything missing.
2. **Decide what gets a voice**, with the user. Prefer short, self-contained lines: a paragraph, a recap sentence, a caption. One line is one file and one highlight.
3. **Choose the source**:
   - Static HTML: add `data-narrate` to each element to be read. Without any, every `<p>` is taken.
   - Markdown or JSON: point at the file.
   - Text that lives in code (React, a CMS export, a glossary object): write a collector module, a `.mjs` whose default export returns the array of lines. Import the site's own data so the lines can never drift from what the page shows.
4. **Write `narrate.json`** next to the site (fields are in `README.md`): `source`, `out` (a folder the site serves, for example `public/voice`), `voice`, `speed`, `say`.
   - Pick the voice with the user: `$N/narrate voices`. The prefix is language and gender (`af_` American female, `am_` American male, `bf_`/`bm_` British). `lang` must suit the voice.
   - Around `speed` 0.95 reads more calmly than 1.
5. **Collect**: `$N/narrate collect <project>`. Read the output. Fix what should not be there (navigation text, duplicates, empty lines), and look at each `said as:` line.
   - Add names, abbreviations and symbols the voice will get wrong to `say` (`"SQL": "sequel"`, `"IMU": "I M U"`). Fixes are case-sensitive and whole-word.
6. **Record**: `$N/narrate record <project> --dry-run` first, then without it. It records new and changed lines, deletes this project's own recordings whose line is gone (only files its `manifest.json` lists), and writes `manifest.json`. Keep `--workers` at 2 on a shared machine. Give every project its own `out` folder; if `record` says the manifest was written for other sources, stop and ask the user before using `--adopt`.
7. **Verify**: `$N/narrate verify <project>` must end in `ok`. Fix every `ERROR`. Report the total size to the user.
8. **Wire the player**: copy `$N/player/player.js` into the site and use `createNarrator({ base })`. See "Player rules" below and the API in `README.md`.
9. **Test in a browser**: serve the site (`$N/narrate serve <folder>` for a static one), click a Listen control, and confirm `start` and `end` events fire in order and no `missing` event appears. A `missing` event means the page's text and the collected text differ.
10. **Deliver**: commit the recordings with the site. Tell the user what was recorded (lines, seconds, size), which voice, and that they need to listen to it. List any pronunciation fixes you added.

After any text change: steps 5 to 7 again. Add `narrate verify` to the site's build or CI so a forgotten re-record fails loudly.

## Player rules

- **Pass the same text that was collected.** For a marked element use `element.textContent`. The hash ignores white-space differences, nothing else. Never build the line differently on the page than in the collector.
- **Start from a click or tap.** Browsers block sound otherwise; `speak()` then resolves with `'blocked'`. Do not auto-play narration on page load.
- **Always give a Stop control and a voice on/off control** (`setEnabled`). The choice is remembered in `localStorage`.
- **Say on the page that the voice is computer-generated**, near the control.
- Highlight with the `start` event (`index`, plus your own `id`), clear on `done`, `stopped` and `blocked`.
- For a talking mouth or meter, read `level()` inside `requestAnimationFrame` and handle `null` (keep an idle rhythm).
- Recordings on another origin play as normal, and `level()` returns `null` for them. Set `crossOrigin: 'anonymous'` only when that origin sends CORS headers; without the headers the option makes every line `missing`.
- Respect `prefers-reduced-motion` for whatever moves with the voice.
- Do not fetch `manifest.json` just to play. Use it for durations or preloading if the design needs them.

## When something is wrong

| Symptom | Cause and fix |
|---|---|
| `missing` event for a line that was recorded | the page's text differs from the collected text. Compare `narrator.urlFor(text)` with the keys from `narrate collect` |
| `verify` reports orphans | the text changed since the last recording. Run `narrate record` |
| `verify` warns "recorded with other settings" | voice, speed or a `say` fix changed. Run `narrate record` |
| a word is said wrong | add it to `say`, run `narrate record` (only lines containing it are redone) |
| `speak()` resolves `'blocked'` | it was not called from a user gesture |
| `level()` is always `null` | no Web Audio, or the recordings are on another origin and `crossOrigin` is not set |
| every line is `missing` after setting `crossOrigin` | the other origin does not send CORS headers |
| `unknown option --...` | a mistyped flag; nothing was run. `narrate help` lists the options |
| `manifest.json was written for ...` | the `out` folder belongs to another project, or `source` changed. Use another folder, or `--adopt` after asking the user |
| `no MP3 encoder` | `pip install lameenc` in the Kokoro venv, or install ffmpeg |

## Honesty

Report only what you ran. You cannot hear audio: say so, and give the numbers you did check (count, seconds, size, non-silence from `verify`). Do not describe how the voice sounds.
