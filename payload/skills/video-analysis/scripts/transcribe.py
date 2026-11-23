"""Transcribe a 16 kHz mono 16-bit wav with faster-whisper. Run from the skill's .venv (see SKILL.md).

The wav is read with the stdlib instead of PyAV: faster-whisper's own decoder breaks on PyAV >= 16
(open() got an unexpected keyword argument 'metadata_errors').
"""

import argparse
import sys
import wave

try:
    import numpy as np
    from faster_whisper import WhisperModel
except ImportError as exc:
    sys.exit(f"missing dependency in this interpreter: {exc}")


def ts(seconds: float) -> str:
    minutes, secs = divmod(seconds, 60)
    return f"{int(minutes):02d}:{secs:05.2f}"


def load_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as wav:
        if wav.getnchannels() != 1 or wav.getframerate() != 16000 or wav.getsampwidth() != 2:
            sys.exit("expected 16 kHz mono 16-bit wav (analyze.mjs produces this)")
        raw = wav.readframes(wav.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default=None, help="ISO code; auto-detect when omitted")
    args = parser.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(load_wav(args.audio), vad_filter=True, language=args.language, beam_size=5)

    lines = [f"# language={info.language} prob={info.language_probability:.2f} model={args.model}"]
    for seg in segments:
        text = seg.text.strip()
        if text:
            lines.append(f"[{ts(seg.start)} - {ts(seg.end)}] {text}")

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"{len(lines) - 1} segments, language={info.language} ({info.language_probability:.2f})")


if __name__ == "__main__":
    main()
