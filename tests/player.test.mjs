import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNarrator, isSameOrigin, loudness, voiceKey } from '../player/player.js';

/** A stand-in for the browser: audio elements that "play" until the test ends them, and timers run by hand. */
function fakeBrowser({ missing = [], blocked = false } = {}) {
  const timers = [];
  const store = new Map();
  const world = { audio: null, played: [], contexts: 0 };
  class FakeAudio {
    paused = true;
    play() {
      world.played.push(this.src);
      if (blocked) return Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }));
      if (missing.some((key) => this.src.includes(key))) return Promise.reject(Object.assign(new Error('404'), { name: 'NotSupportedError' }));
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  class FakeContext {
    state = 'running';
    destination = {};
    constructor() {
      world.contexts += 1;
    }
    createAnalyser() {
      return { fftSize: 0, connect() {}, getByteTimeDomainData: (samples) => samples.fill(160) };
    }
    createMediaElementSource() {
      return { connect() {} };
    }
  }
  const options = {
    createAudio: () => (world.audio = new FakeAudio()),
    AudioContext: FakeContext,
    storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: (id) => id && (timers[id - 1] = null),
  };
  const settle = () => new Promise((done) => setImmediate(done));
  return {
    ...world,
    world,
    options,
    store,
    timers,
    settle,
    /** Runs the pending timers, oldest first. */
    async tick() {
      for (const timer of timers.splice(0)) timer?.fn();
      await settle();
    },
    /** The recording that is playing reaches its end. */
    async endAudio() {
      world.audio.paused = true;
      world.audio.onended();
      await settle();
    },
  };
}

const record = (narrator) => {
  const events = [];
  for (const type of ['start', 'end', 'missing', 'blocked', 'done', 'stopped']) narrator.on(type, (detail) => events.push(`${type}${detail.index === undefined ? '' : `:${detail.index}`}${detail.silent ? ':silent' : ''}`));
  return events;
};

test('speak plays the lines in order, one file per line, and resolves with "done"', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator({ ...browser.options, base: '/v' });
  const events = record(narrator);
  const finished = narrator.speak(['One.', 'Two.'], { id: 'intro' });
  await browser.settle();
  assert.equal(narrator.speaking, true);
  assert.deepEqual(browser.world.played, [`/v/${voiceKey('One.')}.mp3`]);
  await browser.endAudio();
  await browser.tick(); // the pause between lines
  assert.deepEqual(browser.world.played, [`/v/${voiceKey('One.')}.mp3`, `/v/${voiceKey('Two.')}.mp3`]);
  await browser.endAudio();
  await browser.tick();
  assert.equal(await finished, 'done');
  assert.deepEqual(events, ['start:0', 'end:0', 'start:1', 'end:1', 'done']);
  assert.equal(narrator.speaking, false);
});

test('events carry the line, its place, the id, the key and the url', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator(browser.options);
  const seen = [];
  narrator.on('start', (detail) => seen.push(detail));
  narrator.speak(['Only line.'], { id: 7 });
  await browser.settle();
  assert.deepEqual(seen, [{ id: 7, line: 'Only line.', index: 0, total: 1, key: voiceKey('Only line.'), url: `/voice/${voiceKey('Only line.')}.mp3`, silent: false }]);
});

test('a missing recording is reported, shown for its reading time, and the queue goes on', async () => {
  const browser = fakeBrowser({ missing: [voiceKey('Gone.')] });
  const narrator = createNarrator(browser.options);
  const events = record(narrator);
  const finished = narrator.speak(['Gone.', 'Here.']);
  await browser.settle();
  assert.deepEqual(events, ['missing:0', 'start:0:silent']);
  assert.equal(browser.timers[0].ms, 1800);
  await browser.tick(); // reading time
  await browser.tick(); // pause between lines
  assert.deepEqual(events, ['missing:0', 'start:0:silent', 'end:0', 'start:1']);
  await browser.endAudio();
  await browser.tick();
  assert.equal(await finished, 'done');
});

test('a file that fails while loading (the error event) counts as missing', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator({ ...browser.options, captions: false });
  const events = record(narrator);
  const finished = narrator.speak(['Broken.']);
  browser.world.audio.error = { code: 4 };
  browser.world.audio.onerror();
  await browser.settle();
  assert.equal(await finished, 'done');
  assert.deepEqual(events, ['missing:0', 'done']);
});

test('blocked autoplay stops the queue and resolves with "blocked"', async () => {
  const browser = fakeBrowser({ blocked: true });
  const narrator = createNarrator(browser.options);
  const events = record(narrator);
  assert.equal(await narrator.speak(['One.', 'Two.']), 'blocked');
  assert.deepEqual(events, ['blocked:0']);
  assert.equal(browser.world.played.length, 1);
  assert.equal(narrator.speaking, false);
});

test('stop silences the audio, resolves with "stopped", and later events are ignored', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator(browser.options);
  const events = record(narrator);
  const finished = narrator.speak(['One.', 'Two.']);
  await browser.settle();
  const { onended } = browser.world.audio;
  narrator.stop();
  assert.equal(await finished, 'stopped');
  assert.equal(browser.world.audio.paused, true);
  onended(); // a late event from the line that was cut off
  await browser.tick();
  assert.deepEqual(events, ['start:0', 'stopped']);
  assert.equal(browser.world.played.length, 1);
  narrator.stop(); // stopping twice does nothing
  assert.deepEqual(events, ['start:0', 'stopped']);
});

test('a new speak replaces the one in progress', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator(browser.options);
  const first = narrator.speak(['One.']);
  await browser.settle();
  const second = narrator.speak(['Two.']);
  assert.equal(await first, 'stopped');
  await browser.settle();
  await browser.endAudio();
  await browser.tick();
  assert.equal(await second, 'done');
});

test('with the voice off nothing is played and the lines advance at reading speed', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator(browser.options);
  narrator.setEnabled(false);
  const events = record(narrator);
  const finished = narrator.speak(['One.', 'Two.']);
  await browser.tick();
  await browser.tick();
  await browser.tick();
  await browser.tick();
  assert.equal(await finished, 'done');
  assert.deepEqual(events, ['start:0:silent', 'end:0', 'start:1:silent', 'end:1', 'done']);
  assert.deepEqual(browser.world.played, []);
});

test('with the voice off and captions disabled, speak resolves with "off" at once', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator({ ...browser.options, captions: false });
  narrator.setEnabled(false);
  assert.equal(await narrator.speak(['One.']), 'off');
  assert.equal(browser.world.audio, null);
});

test('the voice setting is remembered, and turning it off stops the voice', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator(browser.options);
  assert.equal(narrator.enabled, true);
  const finished = narrator.speak(['One.']);
  await browser.settle();
  narrator.setEnabled(false);
  assert.equal(await finished, 'stopped');
  assert.equal(browser.store.get('site-narrator:voice'), 'off');
  assert.equal(createNarrator(browser.options).enabled, false);
  assert.equal(createNarrator({ ...browser.options, storageKey: null }).enabled, true);
});

test('storage that throws does not break the narrator', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const narrator = createNarrator({ ...fakeBrowser().options, storage: broken });
  assert.equal(narrator.enabled, true);
  narrator.setEnabled(false);
  assert.equal(narrator.enabled, false);
});

test('level is null when idle, a number while a recording plays, and builds the meter only when asked', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator(browser.options);
  assert.equal(narrator.level(), null);
  narrator.speak(['One.']);
  await browser.settle();
  assert.equal(browser.world.contexts, 0);
  assert.equal(narrator.level(), 1); // (160 - 128) / 128 = 0.25, times the gain of 4
  assert.equal(narrator.level(), 1);
  assert.equal(browser.world.contexts, 1);
  narrator.stop();
  assert.equal(narrator.level(), null);
});

test('level is null, and the voice still plays, when Web Audio is not there or fails', async () => {
  class Failing {
    constructor() {
      throw new Error('no audio device');
    }
  }
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const AudioContext of [Failing, null]) {
      const browser = fakeBrowser();
      const narrator = createNarrator({ ...browser.options, AudioContext });
      narrator.speak(['One.']);
      await browser.settle();
      assert.equal(narrator.level(), null);
      assert.equal(browser.world.audio.paused, false);
    }
  } finally {
    console.warn = warn;
  }
});

test('loudness is 0 for silence and rises with the signal', () => {
  assert.equal(loudness(new Uint8Array(64).fill(128)), 0);
  assert.equal(loudness(new Uint8Array(0)), 0);
  const quiet = loudness(new Uint8Array(64).fill(132));
  const loud = loudness(new Uint8Array(64).fill(150));
  assert.ok(quiet > 0 && quiet < loud && loud <= 1);
});

test('empty lines are dropped, a single string is one line, and a listener can unsubscribe', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator(browser.options);
  const seen = [];
  const off = narrator.on('start', (detail) => seen.push(detail.total));
  narrator.speak(['', '  ', 'Real.']);
  await browser.settle();
  off();
  narrator.speak('Just one.');
  await browser.settle();
  assert.deepEqual(seen, [1]);
  assert.equal(await narrator.speak([]), 'done');
});

test('a listener that throws does not stop the queue', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator(browser.options);
  const error = console.error;
  console.error = () => {};
  try {
    narrator.on('start', () => {
      throw new Error('page bug');
    });
    const finished = narrator.speak(['One.']);
    await browser.settle();
    await browser.endAudio();
    await browser.tick();
    assert.equal(await finished, 'done');
  } finally {
    console.error = error;
  }
});

test('isSameOrigin compares the recordings folder with the page address', () => {
  const page = { href: 'https://site.example/notes/page.html' };
  assert.equal(isSameOrigin('/voice/', page), true);
  assert.equal(isSameOrigin('./voice/', page), true);
  assert.equal(isSameOrigin('https://site.example/voice/', page), true);
  assert.equal(isSameOrigin('https://cdn.example/voice/', page), false);
  assert.equal(isSameOrigin('//cdn.example/voice/', page), false);
  assert.equal(isSameOrigin('http://site.example/voice/', page), false);
  assert.equal(isSameOrigin('https://site.example:8443/voice/', page), false);
  // with no page address (not in a browser) only a relative address counts
  assert.equal(isSameOrigin('/voice/', null), true);
  assert.equal(isSameOrigin('https://cdn.example/voice/', null), false);
  assert.equal(isSameOrigin('//cdn.example/voice/', null), false);
});

test('recordings on another origin are never routed through Web Audio: they play, and level is null', async () => {
  const browser = fakeBrowser();
  const location = { href: 'https://site.example/page.html' };
  const narrator = createNarrator({ ...browser.options, location, base: 'https://cdn.example/voice/' });
  narrator.speak(['One.']);
  await browser.settle();
  assert.equal(narrator.level(), null);
  assert.equal(browser.world.contexts, 0);
  assert.equal(browser.world.audio.paused, false);
  assert.equal(browser.world.audio.crossOrigin, undefined);
});

test('with crossOrigin set, another origin is requested with CORS and can be measured', async () => {
  const browser = fakeBrowser();
  const location = { href: 'https://site.example/page.html' };
  const narrator = createNarrator({ ...browser.options, location, base: 'https://cdn.example/voice/', crossOrigin: 'anonymous' });
  narrator.speak(['One.']);
  await browser.settle();
  assert.equal(browser.world.audio.crossOrigin, 'anonymous');
  assert.equal(narrator.level(), 1);
  assert.equal(browser.world.contexts, 1);
});

test('same-origin recordings are measured without any option', async () => {
  const browser = fakeBrowser();
  const narrator = createNarrator({ ...browser.options, location: { href: 'https://site.example/a/' }, base: './voice/' });
  narrator.speak(['One.']);
  await browser.settle();
  assert.equal(narrator.level(), 1);
});
