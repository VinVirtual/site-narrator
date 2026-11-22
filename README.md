# site-narrator

[![test](https://github.com/VinVirtual/site-narrator/actions/workflows/test.yml/badge.svg)](https://github.com/VinVirtual/site-narrator/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A pre-recorded voice for any website, made on your own machine, with no paid speech service.

You mark the text a page should be able to read aloud. site-narrator collects those lines, records each one with the free [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) text-to-speech model, and names every file by a hash of the line's text. In the browser, a small player hashes the text it wants to say and plays the file with that name. The site serves plain MP3 files: no server code, no API key, nothing generated while a visitor listens.

It is packaged as a [Claude Code](https://claude.com/claude-code) skill (`SKILL.md` tells the assistant how to use it), and it also works by hand from the command line.

## What you get

- **`narrate`**, a command line that collects lines from HTML, Markdown, JSON or your own collector module, records only what is new or changed, deletes its own recordings whose line is gone, writes a manifest and verifies the folder.
- **`player/player.js`**, one framework-free ES module with no dependencies: a `speak(lines)` queue, `stop()`, events for the start and end of each line, a `level()` loudness reading for a talking mouth or a meter, and a voice on/off setting it remembers.
- **`examples/demo/`**, a working page with five recorded paragraphs (204 KB of audio in all).

## Limits

- **A fixed set of voices.** Kokoro ships a list of voices (`narrate voices` prints it). It does **not clone voices**, and site-narrator cannot make it sound like a particular person.
- **Only text known ahead of time.** A line can be spoken only if it was recorded. Text typed by visitors, or anything that changes per request, has no recording.
- **Change the text, record again.** The file name is a hash of the text, so an edited line has no recording until you run `narrate record` again. Until then the player reports the line as missing and moves on.
- **Size grows with the text.** At the default 32 kbit/s mono, speech costs about 4 KB a second, so about 240 KB a minute. A few minutes of narration is fine to commit and serve; an hour is about 14 MB and probably wants its own storage. `narrate verify` warns past 10 MB in total or 512 KB for one line (both adjustable).
- **Tell visitors the voice is computer-generated.** Say it on the page, near the control that starts it. The demo does, and the manifest carries a `notice` field you can show.
- **Pronunciation is the model's.** Names and abbreviations can come out wrong; fix them with the `say` table. You have to listen to the result: no tool here can judge how a recording sounds.
- **Simple HTML only.** The HTML collector reads static files with a small scanner, not a browser. It decodes every HTML character reference (`&eacute;`, `&#233;`) the way a browser does, but it does not run scripts or apply CSS. For a site built by a framework, export the lines from a collector module.
- Tested on Linux only. See "What was tested".

## Requirements

| Needed | Why | Licence |
|---|---|---|
| Node.js 18 or newer | runs the command line and the tests | MIT |
| Python 3.10 or newer | runs the recorder | PSF |
| [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | text to speech | MIT |
| Kokoro v1.0 model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`, about 340 MB) | the voice model | Apache-2.0 (see the note below) |
| phonemizer and espeak-ng (installed with kokoro-onnx) | turn text into phonemes | GPL-3.0-or-later |
| onnxruntime, numpy (installed with kokoro-onnx) | run the model | MIT, BSD-3-Clause |
| [lameenc](https://github.com/chrisstaite/lameenc) | writes the MP3 files | LGPL-3.0-or-later, as declared in the package metadata of lameenc 1.9.0 |
| ffmpeg with libmp3lame (optional, used when lameenc is not installed) | writes the MP3 files | LGPL or GPL, depending on the build |

None of these is included in this repository. You install them yourself, and their licences apply to your use of them. The browser player needs none of them.

No GPU is needed. Nothing is uploaded: the text never leaves the machine that records it.

### Licence notes

Checked on 21 November 2026. Check again before you rely on them.

- **kokoro-onnx** is MIT (its `LICENSE` file). Its README says the Kokoro model is Apache-2.0.
- **Kokoro-82M** (the model, by hexgrad) is tagged Apache-2.0 on its Hugging Face model card. The model card does not give a separate licence for the individual voice files. This could not be verified beyond the model's own Apache-2.0 tag.
- **phonemizer** (GPL-3.0-or-later, from its package metadata) and **espeak-ng** (GPL-3.0-or-later, from its README) are loaded by kokoro-onnx inside the Python process that runs `cli/record.py`. If you redistribute a bundle that includes them, or build a product on top, read the GPL's terms.
- **lameenc**: the package metadata of version 1.9.0, read on 21 November 2026, declares `License-Expression: LGPL-3.0-or-later`, and the package ships the text of the GNU Lesser General Public License version 3 as its licence file. Its wheel is a compiled module that includes the LAME encoder; LAME's own licence was not checked separately. lameenc is imported by `cli/record.py` and is not part of this repository.
- **The recordings you make** are files you generated with the model. The MP3 files in `examples/demo/voice/` were made this way with the `af_heart` voice and encoded with lameenc 1.9.0.
- This is a summary of what the packages state, not legal advice.

site-narrator's own code is under the **MIT License** (see `LICENSE`).

## Install

```bash
# 1. the skill itself (for Claude Code; any folder works if you only use the command line)
git clone https://github.com/VinVirtual/site-narrator ~/.claude/skills/site-narrator

# 2. voice: a Python venv with Kokoro and an MP3 encoder, and the two model files
#    (on Debian or Ubuntu, first: sudo apt install python3-venv)
python3 -m venv ~/kokoro/.venv
~/kokoro/.venv/bin/pip install kokoro-onnx lameenc
curl -L -o ~/kokoro/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx
curl -L -o ~/kokoro/voices-v1.0.bin  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin

# 3. check
~/.claude/skills/site-narrator/narrate check
```

Everything is found in default places that you can change with environment variables:

| Variable | Default | What |
|---|---|---|
| `KOKORO_HOME` | `~/kokoro` | folder with the model files and the `.venv` |
| `KOKORO_MODEL`, `KOKORO_VOICES` | `$KOKORO_HOME/kokoro-v1.0.onnx`, `$KOKORO_HOME/voices-v1.0.bin` | the two model files |
| `NARRATE_PYTHON` | `$KOKORO_HOME/.venv/bin/python`, else `python3` | Python that has kokoro-onnx |
| `NARRATE_FFMPEG` | `ffmpeg` on PATH, else the one from the `imageio-ffmpeg` package | ffmpeg binary, only used when lameenc is missing or `--encoder ffmpeg` is given |

## Quick start

1. Mark what the page may read aloud:

   ```html
   <p data-narrate>Each paragraph was turned into a small sound file.</p>
   ```

2. Put a `narrate.json` next to the page:

   ```json
   {
     "source": "index.html",
     "out": "voice",
     "voice": "af_heart",
     "speed": 0.96,
     "say": { "CSS": "C S S" }
   }
   ```

3. Record, then check:

   ```bash
   N=~/.claude/skills/site-narrator/narrate
   $N collect .      # the lines, their file names, and how each will be said
   $N record .       # voice/<hash>.mp3 for every line, plus voice/manifest.json
   $N verify .       # every line has a recording, nothing is left over
   ```

4. Copy `player/player.js` into the site and play a line:

   ```html
   <script type="module">
     import { createNarrator } from './player.js';

     const narrator = createNarrator({ base: './voice/' });
     const paragraph = document.querySelector('[data-narrate]');

     narrator.on('start', () => paragraph.classList.add('is-spoken'));
     narrator.on('done', () => paragraph.classList.remove('is-spoken'));
     document.querySelector('button').addEventListener('click', () => narrator.speak([paragraph.textContent]));
   </script>
   ```

Edit the text and run `narrate record` again: only the changed lines are recorded, and the recordings of the old wording are deleted. Commit the `voice/` folder with the site.

### The demo

```bash
$N serve ~/.claude/skills/site-narrator      # then open http://127.0.0.1:4173/examples/demo/
```

`examples/demo/` is a static page with a Listen button on each paragraph, a highlight on the paragraph being read, a loudness meter and a voice on/off switch. Its recordings are committed. To make them again: `$N record examples/demo --force`.

## Commands

| Command | What it does |
|---|---|
| `narrate check` | checks node, Python, kokoro-onnx, the two model files and an MP3 encoder, and says how to fix what is missing |
| `narrate voices` | lists the voices in the model file |
| `narrate collect [project]` | prints every line with its file name, and the spoken form when it differs. `--json` prints `[{ key, text, say }]`, `--out-file <file>` saves it |
| `narrate record [project]` | records lines that have no file or whose voice, speed, language, bit rate or pronunciation changed; deletes this project's recordings whose line is gone, and half-written files left by an interrupted run; writes `manifest.json`. `--dry-run` only shows the plan, `--force` records everything, `--keep-stale` deletes nothing, `--adopt` takes over a folder whose manifest was written for other sources |
| `narrate manifest [project]` | rewrites `manifest.json` from the files in the folder: for each key, the file, its length in seconds and its size |
| `narrate verify [project]` | exits non-zero when a line has no recording, a recording has no line (an orphan), or a file is unreadable, shorter than 0.3 s or silent. Warns about large files and recordings made with other settings. `--json` prints the result |
| `narrate serve [folder]` | serves a folder on `http://127.0.0.1:4173` to try a page (`--port N`). For local use only: it listens on this machine alone, answers only requests addressed to `localhost`, `127.0.0.1` or `[::1]`, and does not serve files or folders whose name starts with a dot |
| `narrate test` | runs the unit tests (plain `node --test`, no extra packages) |

`project` is a folder that holds `narrate.json` (default: the current folder) or the path of such a file. Options override the file: `--source`, `--out`, `--voice`, `--speed`, `--lang`, `--bitrate`, `--workers`, `--attribute`, `--encoder auto|lameenc|ffmpeg`. An option the command line does not know is an error, so a typing mistake such as `--dryrun` stops the command instead of changing what it does.

### narrate.json

| Field | Default | Meaning |
|---|---|---|
| `source` | none (required) | a file, or a list of files: `.html`, `.md`, `.json`, or a `.js`/`.mjs` collector module |
| `out` | `voice` | folder for the recordings, relative to the file |
| `voice` | `af_heart` | a name from `narrate voices` |
| `speed` | `1` | 0.5 to 2 |
| `lang` | `en-us` | language code passed to Kokoro (it must suit the voice) |
| `bitrate` | `32` | MP3 kbit/s, mono |
| `workers` | `2` | lines recorded at once. On the test machine, 1 and 2 workers gave byte-identical files |
| `attribute` | `data-narrate` | the HTML attribute that marks a line |
| `say` | `{}` | pronunciation fixes: `"written": "spoken"`. Case-sensitive; a fix that starts or ends with a letter only matches whole words |
| `limits` | see `cli/lib/verify.mjs` | `maxTotalBytes`, `maxFileBytes`, `minSeconds`, `minLevel` for `verify` |

Symbols such as `°C`, `×`, `→`, ` = ` and curly quotes are spelled out for the voice without any setup. The page keeps the original text; only the recording uses the spoken form, and the file name is always the hash of the original.

### Where lines come from

- **HTML**: the text of every element with the `data-narrate` attribute, or of every `<p>` when no element has it.
- **Markdown**: one line per heading, paragraph and list item. Code blocks, tables and front matter are skipped.
- **JSON**: an array of strings or of `{ "text": "..." }` objects, or an object with a `lines` array.
- **A collector module**: any `.js` or `.mjs` file whose default export is an array of lines or a function (it may be async) that returns one. Use this when the text lives in your source code:

  ```js
  // voice-lines.mjs
  import { CHAPTERS } from './src/chapters.js';
  export default () => CHAPTERS.flatMap((chapter) => [chapter.title, ...chapter.recap]);
  ```

The text the page passes to `speak()` must be the text that was collected. White space and Unicode composition are normalised on both sides, so `element.textContent` of a marked element matches. Text that the page assembles differently from the collector will not.

## The player

```js
const narrator = createNarrator({
  base: '/voice/',      // folder the recordings are served from
  gap: 180,             // pause between lines, in milliseconds
  captions: true,       // voice off or file missing: still step through the lines at reading speed
  storageKey: 'site-narrator:voice', // where the visitor's on/off choice is kept; null: do not remember
  crossOrigin: null,    // 'anonymous' only when the recordings are on another origin that sends CORS headers
});
```

| Member | What it does |
|---|---|
| `speak(lines, { id })` | plays the lines in order, replacing anything in progress. Resolves with `'done'`, `'stopped'`, `'blocked'` or `'off'` |
| `stop()` | stops at once |
| `on(type, listener)` | `start` and `end` for each line, `missing`, `blocked`, `done`, `stopped`. Line events carry `{ id, line, index, total, key, url, silent }`. Returns a function that unsubscribes |
| `level()` | loudness right now, 0 to 1, or `null` when nothing is playing or it cannot be measured. Call it from `requestAnimationFrame` |
| `enabled`, `setEnabled(on)` | the visitor's voice setting, remembered in `localStorage` |
| `speaking` | true from `speak()` until its last line ends |
| `urlFor(text)` | the address of a line's recording |

The module also exports `voiceKey(text)`, `tidy(text)`, `readingMs(text)` and `loudness(samples)`.

How it behaves when things go wrong:

- **A recording is missing or will not load**: a `missing` event, then the line is held for its reading time (`start` with `silent: true`) so a caption or highlight still shows, and the queue goes on. With `captions: false` the line is skipped.
- **The browser blocks sound** because the visitor has not tapped or clicked yet: a `blocked` event, the queue stops and `speak()` resolves with `'blocked'`. Call `speak()` from a click handler.
- **The visitor turned the voice off**: no file is requested. With `captions: true` the lines advance at reading speed; with `captions: false`, `speak()` resolves with `'off'`.
- **No Web Audio**: the voice still plays and `level()` returns `null`. The meter is only built the first time `level()` is called.
- **Recordings on another origin** (a CDN, another port): they play as normal, and `level()` returns `null`, because the player never routes sound from another origin through Web Audio (a browser would silence it). To measure loudness there, the other origin must send CORS headers (`Access-Control-Allow-Origin`) and you set `crossOrigin: 'anonymous'`. If you set that option and the headers are missing, the recordings do not load and each line is reported as `missing`.

### In React

A sketch, not shipped or tested as part of this repository:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { createNarrator } from './player.js';

export function useNarrator(base = '/voice/') {
  const narrator = useMemo(() => createNarrator({ base }), [base]);
  const [current, setCurrent] = useState(null); // { id, index } of the line being read, or null

  useEffect(() => {
    const clear = () => setCurrent(null);
    const off = [
      narrator.on('start', ({ id, index }) => setCurrent({ id, index })),
      narrator.on('done', clear),
      narrator.on('stopped', clear),
      narrator.on('blocked', clear),
    ];
    return () => {
      off.forEach((unsubscribe) => unsubscribe());
      narrator.stop();
    };
  }, [narrator]);

  return { current, speak: narrator.speak, stop: narrator.stop, level: narrator.level };
}
```

## How it works

1. **Collect.** `cli/lib/collect.mjs` reads the sources and returns each distinct line as `{ key, text, say }`. `key` is `voiceKey(text)`: 32-bit FNV-1a over the text, in hex, followed by the text's length in hex. `say` is the text after the pronunciation fixes.
2. **Record.** `cli/lib/plan.mjs` compares the lines with the folder and the last manifest. `cli/record.py` speaks each line that needs it with Kokoro and writes `<key>.mp3`. A recording is deleted only when this project's own `manifest.json` lists it and no line says it any more. Any other file in the folder is left alone, including an MP3 with a similar name, and so is everything when there is no manifest. The manifest records the `sources` it was written for; if a folder's manifest was written for other sources, `record` stops and asks for another `out` folder or `--adopt`, so two projects cannot delete each other's files.
3. **Manifest and verify.** `cli/lib/mp3.mjs` reads each file's length from its MP3 frame headers. `manifest.json` lists every key with its file, seconds and bytes; `verify` compares lines, files and manifest.
4. **Play.** `player/player.js` contains the same `voiceKey`, so the page asks for `voice/<key>.mp3` directly. The command line imports the function from that file, so there is one implementation, and a test checks it against published FNV-1a values.

The player does not read `manifest.json`. It is there for you: to show durations, to preload, or to check a deploy.

## What was tested

On one Linux machine (Node 24, Python 3.10, kokoro-onnx 0.6.1; MP3 written with lameenc 1.9.0, and with the ffmpeg from imageio-ffmpeg for the fallback):

- `narrate test`: 89 unit tests for the hash, text clean-up, collectors, recording plan, MP3 length, manifest, verify, project file, local server, the player's queue (with a stand-in for the browser's audio), and that Python probes never import modules from the current folder.
- The demo was recorded for real (lameenc) and checked with `narrate verify`. Each of its MP3 files was decoded in headless Chromium: the decoded lengths match the manifest, and the signal is not silent. The ffmpeg encoder, stale-file deletion and re-recording after a voice change were run on a second small project.
- The demo page was opened in headless Chromium from `narrate serve`. Pressing "Listen to all" played the five recordings in order with start and end events at the expected times, the highlight followed, and `level()` returned changing values. A missing recording, `stop()` and the voice-off setting behaved as described above.

- The HTML entity decoder was compared with Chromium's `textContent` for all 2,125 named references and 744 other cases (names without a semicolon, numeric references). They agree except for the malformed `&#x;`, which Chromium turns into U+FFFD and the collector leaves as written.
- Recording the same 12 lines with `--force` twice with 2 workers and once with 1 worker gave byte-identical MP3 files.
- Recordings served from another origin without CORS headers played to the end in headless Chromium with `level()` returning `null`; with `crossOrigin: 'anonymous'` they were reported as `missing`.

Not tested: macOS and Windows; Firefox and Safari; real phones; the autoplay-blocked path in a real browser (it is covered only by a unit test with a stand-in); the React sketch; languages other than English. Nobody has checked the recordings by ear as part of the automated checks: listen to yours.

## Development

```bash
./narrate test                       # unit tests
./narrate record examples/demo       # records nothing when the demo is up to date
./narrate verify examples/demo
```

Text handling that can be tested without Kokoro or a browser lives in `cli/lib/` and `player/player.js`. `cli/record.py` is the only part that needs the model.
