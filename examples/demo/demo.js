// The demo page: a Listen button per paragraph, a highlight on the paragraph being read, a loudness meter.
import { createNarrator } from '../../player/player.js';

const narrator = createNarrator({ base: './voice/' });
const column = document.querySelector('.column');
const passages = [...document.querySelectorAll('.passage')];
const lines = passages.map((passage) => passage.querySelector('[data-narrate]').textContent);
const status = document.querySelector('.desk__status');
const meter = document.querySelector('.meter');
const stopButton = document.querySelector('[data-action="stop"]');
const voiceButton = document.querySelector('[data-action="voice"]');

let frame = 0;

const mark = (index) => {
  passages.forEach((passage, at) => passage.classList.toggle('is-spoken', at === index));
  column.classList.toggle('is-reading', index !== null);
  stopButton.disabled = index === null;
};

const followLevel = () => {
  meter.style.setProperty('--level', String(narrator.level() ?? 0));
  frame = requestAnimationFrame(followLevel);
};

const rest = (message) => {
  cancelAnimationFrame(frame);
  meter.style.setProperty('--level', '0');
  mark(null);
  status.textContent = message;
};

const showVoice = () => {
  voiceButton.setAttribute('aria-pressed', String(narrator.enabled));
  voiceButton.textContent = narrator.enabled ? 'Voice on' : 'Voice off';
};

// speak() gets the paragraphs to read; `id` carries where the first one sits on the page.
const read = (from, count) => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(followLevel);
  narrator.speak(lines.slice(from, from + count), { id: from });
};

narrator.on('start', ({ id, index, silent }) => {
  mark(id + index);
  status.textContent = `${silent ? 'Showing' : 'Reading'} paragraph ${id + index + 1} of ${lines.length}`;
});
narrator.on('missing', ({ key }) => console.warn(`[demo] no recording for ${key}: run "narrate record examples/demo"`));
narrator.on('done', () => rest('Finished.'));
narrator.on('stopped', () => rest('Stopped.'));
narrator.on('blocked', () => rest('The browser blocked the sound. Press Listen again.'));

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action } = button.dataset;
  if (action === 'all') read(0, lines.length);
  if (action === 'one') read(passages.indexOf(button.closest('.passage')), 1);
  if (action === 'stop') narrator.stop();
  if (action === 'voice') {
    narrator.setEnabled(!narrator.enabled);
    showVoice();
  }
});

showVoice();
window.narrator = narrator; // so you can try narrator.speak([...]) from the console
