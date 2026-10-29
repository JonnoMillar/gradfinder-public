"""Transcribe a practice recording locally (faster-whisper, free) and split it into answers at long pauses.

  python scripts/transcribe.py <audio> --out <file.md> [--model small.en] [--gap 15]

Output: markdown, one block per answer (a pause of --gap seconds starts a new block) with start time, length,
words per minute and filler count. Reuses the cached model only (local_files_only), so no download can stall.
"""
import argparse
import re
import sys
from pathlib import Path

from faster_whisper import WhisperModel

FILLERS = re.compile(r"\b(um+|uh+|er+|erm|like|you know|sort of|kind of|basically|literally|i mean)\b", re.I)


def stamp(s: float) -> str:
    return f"{int(s // 60):02d}:{int(s % 60):02d}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--gap", type=float, default=15.0)
    a = ap.parse_args()

    model = WhisperModel(a.model, device="cpu", compute_type="int8", local_files_only=True)
    segs, info = model.transcribe(a.audio, language="en", vad_filter=True, vad_parameters={"min_silence_duration_ms": 1500})
    print(f"audio length {info.duration:.0f}s", file=sys.stderr)

    blocks: list[list] = []
    for s in segs:
        if not blocks or s.start - blocks[-1][-1].end > a.gap:
            blocks.append([])
        blocks[-1].append(s)
        print(f"\r{stamp(s.end)} / {stamp(info.duration)}", end="", file=sys.stderr, flush=True)
    print(file=sys.stderr)

    out = [f"# Transcript: {Path(a.audio).name}", "",
           f"Model {a.model}; new block after a {a.gap:.0f}s pause; {len(blocks)} blocks; audio {stamp(info.duration)}.", ""]
    for i, b in enumerate(blocks, 1):
        text = " ".join(s.text.strip() for s in b)
        words = len(text.split())
        dur = b[-1].end - b[0].start
        fill = len(FILLERS.findall(text))
        wpm = words / dur * 60 if dur > 0 else 0
        out += [f"## Block {i} [{stamp(b[0].start)} to {stamp(b[-1].end)}] {dur:.0f}s, {words} words, {wpm:.0f} wpm, {fill} fillers", "", text, ""]
    Path(a.out).write_text("\n".join(out), encoding="utf-8")


if __name__ == "__main__":
    main()
