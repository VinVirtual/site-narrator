/**
 * site-narrator player: plays pre-recorded lines of text in the browser.
 *
 * Each recording is named by a fingerprint of the text it speaks (see voiceKey), so the page needs no
 * list of files: it hashes the text it wants to say and asks for that file. No dependencies, no framework.
 *
 *   import { createNarrator } from './player.js';
 *   const narrator = createNarrator({ base: '/voice/' });
 *   narrator.on('start', ({ index }) => highlight(index));
 *   await narrator.speak(['First line.', 'Second line.']);
 */

const WORDS_PER_SECOND = 2.6;
const MIN_LINE_MS = 1800;
const LEVEL_GAIN = 4; // speech rarely fills the full range, so the raw loudness is scaled up
const STORAGE_KEY = 'site-narrator:voice';
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Text as it is fingerprinted: Unicode-normalised, runs of white space folded to one space, trimmed. */
export const tidy = (text) => String(text).normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * The name of a line's recording: 32-bit FNV-1a over the UTF-16 code units of the tidied text, as eight
 * hex digits, followed by the text length in hex. The recorder uses this same function, so a line whose
 * text changes simply has no recording until `narrate record` is run again.
 */
export function voiceKey(text) {
  const line = tidy(text);
  let hash = FNV_OFFSET;
  for (let index = 0; index < line.length; index += 1) {
    hash ^= line.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0') + line.length.toString(16);
}

/** How long a line takes to read, in milliseconds. Used to keep time when there is no audio. */
export const readingMs = (text) => Math.max(MIN_LINE_MS, (tidy(text).split(' ').length / WORDS_PER_SECOND) * 1000);

/** Loudness of one block of 8-bit time-domain samples, from 0 (silence) to 1. */
export function loudness(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
}

const withSlash = (base) => (base.endsWith('/') ? base : `${base}/`);

/**
 * True when `url` is served from the page's own origin. Sound from another origin that is routed through
 * Web Audio without CORS approval plays as silence, so the meter must never be attached to it.
 */
export function isSameOrigin(url, page = globalThis.location) {
  try {
    if (!page?.href) return !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url); // no page address to compare with: only a relative address is safe
    return new URL(url, page.href).origin === new URL(page.href).origin;
  } catch {
    return false;
  }
}

function readSetting(storage, key) {
  try {
    return storage?.getItem(key) !== 'off';
  } catch {
    return true; // storage can be blocked (private windows); the voice then defaults to on
  }
}

function writeSetting(storage, key, on) {
  try {
    storage?.setItem(key, on ? 'on' : 'off');
  } catch {
    // the choice still holds for this page view
  }
}

/**
 * Options (all optional):
 *   base         folder the recordings are served from (default '/voice/')
 *   ext          file extension (default 'mp3')
 *   gap          pause between lines in milliseconds (default 180)
 *   captions     when the voice is off or a recording is missing, still step through the lines at
 *                reading speed so captions and highlights keep working (default true)
 *   storageKey   localStorage key for the visitor's voice on/off choice (null: do not remember)
 *   crossOrigin  'anonymous' when the recordings are on another origin that sends CORS headers. Without it,
 *                recordings from another origin still play, and level() returns null for them.
 *   createAudio, AudioContext, storage, location, setTimeout, clearTimeout: replaceable for tests
 */
export function createNarrator(options = {}) {
  const base = withSlash(options.base ?? '/voice/');
  const ext = options.ext ?? 'mp3';
  const gap = options.gap ?? 180;
  const captions = options.captions ?? true;
  const storageKey = options.storageKey === undefined ? STORAGE_KEY : options.storageKey;
  const storage = options.storage ?? (storageKey ? globalThis.localStorage : null);
  const createAudio = options.createAudio ?? (() => new globalThis.Audio());
  const ContextClass = options.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const later = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const cancel = options.clearTimeout ?? ((id) => globalThis.clearTimeout(id));

  // The loudness meter may only touch sound the page is allowed to read: its own origin, or CORS-approved.
  const canMeter = Boolean(options.crossOrigin) || isSameOrigin(base, options.location ?? globalThis.location);

  const listeners = new Map();
  let enabled = storageKey ? readSetting(storage, storageKey) : true;
  let audio = null;
  let context = null;
  let analyser = null;
  let samples = null;
  let meterFailed = false;
  let run = 0; // bumps on every speak and stop, so events from an earlier run are ignored
  let timer = null;
  let finish = null; // settles the promise of the run in progress
  let playing = false;

  const urlFor = (text) => `${base}${voiceKey(text)}.${ext}`;

  const emit = (type, detail) => {
    for (const listener of [...(listeners.get(type) ?? [])]) {
      try {
        listener(detail);
      } catch (error) {
        console.error(`[site-narrator] a "${type}" listener threw`, error);
      }
    }
  };

  const element = () => {
    if (audio) return audio;
    audio = createAudio();
    audio.preload = 'auto';
    if (options.crossOrigin) audio.crossOrigin = options.crossOrigin;
    return audio;
  };

  // The loudness meter is built the first time level() is asked for, so pages that never use it never
  // route sound through Web Audio. If it cannot be built, the voice still plays and level() gives null.
  const meter = () => {
    if (analyser || meterFailed || !canMeter || !audio || !ContextClass) return;
    try {
      context = new ContextClass();
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      samples = new Uint8Array(analyser.fftSize);
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(context.destination);
    } catch (error) {
      meterFailed = true;
      analyser = null;
      console.warn('[site-narrator] no loudness meter; level() will return null', error);
    }
  };

  const wake = () => {
    if (context?.state === 'suspended') context.resume().catch(() => {});
  };

  const quiet = () => {
    cancel(timer);
    timer = null;
    playing = false;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
  };

  const settle = (reason, detail) => {
    const done = finish;
    finish = null;
    quiet();
    if (!done) return;
    emit(reason, detail);
    done(reason);
  };

  function step(lines, at, id, mine) {
    if (mine !== run) return;
    if (at >= lines.length) {
      settle('done', { id, total: lines.length });
      return;
    }
    const line = lines[at];
    const detail = { id, line, index: at, total: lines.length, key: voiceKey(line), url: urlFor(line) };
    const next = () => {
      if (mine !== run) return;
      playing = false;
      emit('end', detail);
      timer = later(() => step(lines, at + 1, id, mine), at + 1 < lines.length ? gap : 0);
    };
    const silently = () => {
      emit('start', { ...detail, silent: true });
      timer = later(next, readingMs(line));
    };

    if (!enabled) {
      silently();
      return;
    }
    let failed = false; // a file that cannot load reports it twice: the error event, and play() rejecting
    const missing = (error) => {
      if (mine !== run || failed) return;
      failed = true;
      playing = false;
      emit('missing', { ...detail, error });
      if (captions) silently();
      else step(lines, at + 1, id, mine);
    };
    const player = element();
    player.onended = next;
    player.onerror = () => missing(player.error ?? null);
    player.src = detail.url;
    wake();
    Promise.resolve(player.play()).then(
      () => {
        if (mine !== run || failed) return;
        playing = true;
        emit('start', { ...detail, silent: false });
      },
      (error) => {
        if (mine !== run) return;
        // The browser refused to play without a tap or click: stop here and let the page offer a button.
        if (error?.name === 'NotAllowedError') settle('blocked', { ...detail, error });
        else if (error?.name !== 'AbortError') missing(error);
      },
    );
  }

  /** Stops at once. The promise of the speak() in progress resolves with 'stopped'. */
  function stop() {
    run += 1;
    settle('stopped', {});
  }

  return {
    /**
     * Speaks the lines in order. Resolves with how it ended: 'done', 'stopped', 'blocked' (autoplay was
     * refused: call speak again from a click) or 'off' (voice is off and captions are disabled).
     */
    speak(lines, { id = null } = {}) {
      stop();
      const list = (Array.isArray(lines) ? lines : [lines]).map(String).filter((line) => tidy(line));
      if (!enabled && !captions) return Promise.resolve('off');
      run += 1;
      const mine = run;
      return new Promise((resolve) => {
        finish = resolve;
        step(list, 0, id, mine);
      });
    },

    stop,

    /** Subscribes to 'start', 'end', 'missing', 'blocked', 'done' or 'stopped'. Returns an unsubscribe function. */
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      return () => listeners.get(type).delete(listener);
    },

    /** How loud the voice is right now, 0 to 1, or null when nothing is playing or it cannot be measured. */
    level() {
      if (!playing) return null;
      meter();
      if (!analyser) return null;
      wake();
      analyser.getByteTimeDomainData(samples);
      return loudness(samples);
    },

    /** The visitor's voice setting. Turning it off stops the audio; lines then advance silently if captions is on. */
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = Boolean(on);
      if (storageKey) writeSetting(storage, storageKey, enabled);
      if (!enabled) stop();
    },

    /** True between speak() and the end of its last line. */
    get speaking() {
      return finish !== null;
    },

    urlFor,
  };
}
