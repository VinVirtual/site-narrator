"""
Records lines of text with Kokoro, an open speech model that runs on this machine (nothing is uploaded).
Run by `narrate record`; it can also be used by hand:

    python record.py jobs.json out/ --model kokoro-v1.0.onnx --voices voices-v1.0.bin --voice af_heart

jobs.json is a list of {"key": "...", "say": "..."}. Each line becomes out/<key>.mp3 (mono).
One JSON object is printed per line: {"key", "seconds", "bytes", "level", "peak"} or {"key", "error"}.
Needs: pip install kokoro-onnx, and lameenc (or ffmpeg) to write MP3.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

LAME_QUALITY = 2  # 0 is best and slowest, 9 is fastest


def find_ffmpeg() -> str | None:
    """ffmpeg: $NARRATE_FFMPEG, else ffmpeg on PATH, else the binary the imageio-ffmpeg package ships."""
    named = os.environ.get("NARRATE_FFMPEG") or shutil.which("ffmpeg")
    if named:
        return named
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # not installed, or it has no binary for this platform
        return None


def pick_encoder(wanted: str) -> str:
    """Returns "lameenc" or "ffmpeg", whichever is asked for and present ("auto" prefers lameenc)."""
    have = {}
    try:
        import lameenc  # noqa: F401

        have["lameenc"] = True
    except ImportError:
        pass
    if find_ffmpeg():
        have["ffmpeg"] = True
    order = ["lameenc", "ffmpeg"] if wanted == "auto" else [wanted]
    for name in order:
        if name in have:
            return name
    raise SystemExit(f"no MP3 encoder ({' or '.join(order)}): pip install lameenc, or install ffmpeg")


def to_pcm(samples: np.ndarray) -> bytes:
    return (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()


def mp3_lameenc(samples: np.ndarray, rate: int, bitrate: int) -> bytes:
    import lameenc

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bitrate)
    encoder.set_in_sample_rate(rate)
    encoder.set_channels(1)
    encoder.set_quality(LAME_QUALITY)
    encoder.silence()
    return bytes(encoder.encode(to_pcm(samples)) + encoder.flush())


def mp3_ffmpeg(samples: np.ndarray, rate: int, bitrate: int) -> bytes:
    command = [find_ffmpeg(), "-v", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0",
               "-codec:a", "libmp3lame", "-b:a", f"{bitrate}k", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "pipe:1"]
    done = subprocess.run(command, input=to_pcm(samples), capture_output=True, check=False)
    if done.returncode != 0 or not done.stdout:
        raise RuntimeError(f"ffmpeg failed: {done.stderr.decode(errors='replace').strip()}")
    return done.stdout


ENCODERS = {"lameenc": mp3_lameenc, "ffmpeg": mp3_ffmpeg}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("jobs")
    parser.add_argument("out")
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--lang", default="en-us")
    parser.add_argument("--bitrate", type=int, default=32)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--encoder", choices=["auto", "lameenc", "ffmpeg"], default="auto")
    parser.add_argument("--list-voices", action="store_true")
    args = parser.parse_args()

    from kokoro_onnx import Kokoro

    kokoro = Kokoro(args.model, args.voices)
    voices = sorted(kokoro.get_voices())
    if args.list_voices:
        print("\n".join(voices))
        return
    if args.voice not in voices:
        raise SystemExit(f'unknown voice "{args.voice}". Run "narrate voices" for the list.')

    encode = ENCODERS[pick_encoder(args.encoder)]
    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    def record(job: dict) -> dict:
        try:
            samples, rate = kokoro.create(job["say"], voice=args.voice, speed=args.speed, lang=args.lang)
            samples = np.asarray(samples, dtype=np.float32).reshape(-1)
            if samples.size == 0:
                raise RuntimeError("the model returned no sound")
            data = encode(samples, rate, args.bitrate)
            target = out / f"{job['key']}.mp3"
            partial = target.with_suffix(".mp3.part")  # written beside it, then renamed: never a half-written file
            partial.write_bytes(data)
            partial.replace(target)
            return {"key": job["key"], "seconds": round(samples.size / rate, 3), "bytes": len(data),
                    "level": round(float(np.sqrt(np.mean(samples**2))), 4), "peak": round(float(np.max(np.abs(samples))), 4)}
        except Exception as error:  # report this line and carry on with the others
            return {"key": job["key"], "error": f"{type(error).__name__}: {error}"}

    failed = 0
    with ThreadPoolExecutor(max(1, args.workers)) as pool:
        for result in pool.map(record, jobs):
            failed += "error" in result
            print(json.dumps(result), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
