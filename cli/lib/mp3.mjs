// Reads the length of an MP3 file by walking its frame headers. No decoding, no dependencies.
const BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const LAYER_3 = 1;

/** Parses one MPEG Layer III frame header at `at`, or returns null when there is none. */
function frameAt(bytes, at) {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[at + 1] >> 3) & 3;
  const bitrate = BITRATES[version === 3 ? 1 : 2][bytes[at + 2] >> 4];
  const sampleRate = RATES[version]?.[(bytes[at + 2] >> 2) & 3];
  if (((bytes[at + 1] >> 1) & 3) !== LAYER_3 || !bitrate || !sampleRate) return null;
  const samples = version === 3 ? 1152 : 576;
  const size = Math.floor(((samples / 8) * bitrate * 1000) / sampleRate) + ((bytes[at + 2] >> 1) & 1);
  return { size, samples, sampleRate, bitrate };
}

const id3Size = (bytes) => (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 ? 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) + ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f) : 0);

/** A frame that only carries the encoder's Xing/Info table holds no sound. */
const isInfoFrame = (bytes, at, size) => {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset + at, Math.min(size, 48)).toString('latin1');
  return head.includes('Xing') || head.includes('Info');
};

/**
 * Returns { seconds, frames, sampleRate, bitrate } for MP3 data, or null when no frames are found.
 * The length includes the encoder's short lead-in, so it can be a few hundredths of a second longer
 * than the speech itself.
 */
export function mp3Info(bytes) {
  let at = id3Size(bytes);
  let frames = 0;
  let samples = 0;
  let first = null;
  while (at < bytes.length) {
    const frame = frameAt(bytes, at);
    if (!frame) {
      at += 1; // not on a frame boundary: look for the next one
      continue;
    }
    if (!(frames === 0 && samples === 0 && isInfoFrame(bytes, at, frame.size))) {
      first ??= frame;
      frames += 1;
      samples += frame.samples;
    }
    at += frame.size;
  }
  if (!first) return null;
  return { seconds: samples / first.sampleRate, frames, sampleRate: first.sampleRate, bitrate: first.bitrate };
}
