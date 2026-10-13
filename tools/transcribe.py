"""Transcrição local e gratuita com o tempo de cada palavra (faster-whisper) → JSON para
Studio.captions() + legenda .srt para o YouTube.

Uso:
  uv run --python 3.12 --with faster-whisper python tools/transcribe.py audio.wav [--out pasta] [--model small] [--lang pt]

Saída (ao lado do áudio, ou em --out):
  <nome>.words.json   [{"w": "Já", "start": 0.0, "end": 0.2}, ...]   → Studio.captions(el, words)
  <nome>.srt          frases de até 2 linhas × 42 caracteres, ≥ 0,7s     → legenda do YouTube

O áudio é decodificado pelo ffmpeg (o PyAV novo quebra o decode_audio do faster-whisper).
Palavras "alucinadas" em silêncio no fim (prob. baixa, depois do fim da fala) são descartadas.
"""
import json
import os
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

SR = 16000


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def ts(t):
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"


def srt_blocks(words, max_chars=42, max_lines=2, min_dur=0.7, pause=0.6):
    """Agrupa palavras em legendas de leitura confortável (≤ 17 caracteres/s quando possível)."""
    blocks, cur = [], []
    limit = max_chars * max_lines
    for w in words:
        text = " ".join(x["w"] for x in cur + [w])
        brk = cur and (len(text) > limit or w["start"] - cur[-1]["end"] > pause or cur[-1]["w"][-1:] in ".!?…")
        if brk:
            blocks.append(cur)
            cur = []
        cur.append(w)
    if cur:
        blocks.append(cur)
    out = []
    for i, b in enumerate(blocks):
        start, end = b[0]["start"], max(b[-1]["end"], b[0]["start"] + min_dur)
        if i + 1 < len(blocks):
            end = min(end, blocks[i + 1][0]["start"])
        text = " ".join(x["w"] for x in b)
        if len(text) > max_chars:  # quebra em 2 linhas no espaço mais perto do meio
            mid = len(text) // 2
            cut = min((i for i, c in enumerate(text) if c == " "), key=lambda i: abs(i - mid), default=None)
            if cut:
                text = text[:cut] + "\n" + text[cut + 1:]
        out.append((start, end, text))
    return out


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    out_dir = arg("--out", os.path.dirname(os.path.abspath(src)))
    base = os.path.splitext(os.path.basename(src))[0]
    audio = load(src)
    dur = len(audio) / SR
    model = WhisperModel(arg("--model", "small"), device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio, language=arg("--lang", "pt"), word_timestamps=True, vad_filter=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text or (w.probability < 0.3 and w.start > dur - 1.0):
                continue
            words.append({"w": text, "start": round(w.start, 3), "end": round(min(w.end, dur), 3)})
    os.makedirs(out_dir, exist_ok=True)
    jpath = os.path.join(out_dir, f"{base}.words.json")
    with open(jpath, "w", encoding="utf-8") as fh:
        json.dump(words, fh, ensure_ascii=False, indent=1)
    spath = os.path.join(out_dir, f"{base}.srt")
    with open(spath, "w", encoding="utf-8") as fh:
        for i, (a, b, text) in enumerate(srt_blocks(words), 1):
            fh.write(f"{i}\n{ts(a)} --> {ts(b)}\n{text}\n\n")
    print(f"{len(words)} palavras em {dur:.1f}s")
    print(jpath)
    print(spath)


if __name__ == "__main__":
    main()
