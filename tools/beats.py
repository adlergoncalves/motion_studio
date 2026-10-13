# Adaptado de Qnedy/seekframe (MIT) — https://github.com/Qnedy/seekframe
# Rodar: uv run --with numpy python tools/beats.py musica.mp3 [--json out.json]
"""Beat grid + drop detection with numpy only.

Usage: python analyze_track.py track.mp3 [--json out.json]
Decodes with ffmpeg to mono 22.05 kHz, then:
  - onset envelope = half-wave rectified spectral flux (log magnitude)
  - tempo = autocorrelation peak of the envelope, 70-180 BPM, refined to 0.01 BPM
  - phase = offset that maximises onset energy on the grid
  - downbeat = beat-in-bar (0..3) with the most low-end (kick/bass) energy
  - drop = bar boundary with the largest jump in low-band + total energy
           between the 4 bars before and the 4 bars after
"""
import json
import os
import subprocess
import sys

import numpy as np

SR = 22050
HOP = 256
NFFT = 2048
CENTRE = NFFT / 2 / SR  # seconds from frame start to window centre


def find_ffmpeg():
    root = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages")
    if os.path.isdir(root):
        for pkg in os.listdir(root):
            if pkg.startswith("Gyan.FFmpeg"):
                for build in os.listdir(os.path.join(root, pkg)):
                    exe = os.path.join(root, pkg, build, "bin", "ffmpeg.exe")
                    if os.path.exists(exe):
                        return exe
    return "ffmpeg"


def load(path, sr=SR):
    raw = subprocess.run(
        [find_ffmpeg(), "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def stft_mag(y):
    win = np.hanning(NFFT).astype(np.float32)
    n = 1 + (len(y) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(y[idx] * win, axis=1))


def analyze(path):
    y = load(path)
    dur = len(y) / SR
    S = stft_mag(y)
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    fps = SR / HOP

    logS = np.log1p(100 * S)
    flux = np.maximum(0, np.diff(logS, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux -= np.convolve(flux, np.ones(16) / 16, mode="same")  # local mean removal
    flux = np.maximum(flux, 0)

    # Tempo via autocorrelation
    f = flux - flux.mean()
    ac = np.fft.irfft(np.abs(np.fft.rfft(f, 2 * len(f))) ** 2)[: len(f)]
    lags = np.arange(len(ac))
    bpm_of_lag = 60 * fps / np.maximum(lags, 1)
    ok = (bpm_of_lag >= 70) & (bpm_of_lag <= 180)
    best_lag = lags[ok][np.argmax(ac[ok])]
    # Refine: scan BPM finely around the coarse estimate using comb scores
    t_frames = np.arange(len(flux)) / fps

    def comb_score(bpm):
        period = 60 / bpm
        phases = np.linspace(0, period, 64, endpoint=False)
        scores = []
        for ph in phases:
            beats = np.arange(ph, dur, period)
            fi = np.round(beats * fps).astype(int)
            fi = fi[fi < len(flux)]
            scores.append(flux[fi].sum())
        k = int(np.argmax(scores))
        return scores[k], phases[k]

    coarse = 60 * fps / best_lag
    cands = np.arange(coarse - 3, coarse + 3, 0.01)
    res = [comb_score(b) for b in cands]
    k = int(np.argmax([r[0] for r in res]))
    bpm, phase = float(cands[k]), float(res[k][1])
    period = 60 / bpm

    # Refine tempo + phase: least-squares fit of the grid to kick transients
    # found on a fine (64-sample, ~2.9 ms) low-band envelope.
    fine_hop = 64
    n_f = (len(y) - NFFT) // fine_hop
    fr = np.fft.rfftfreq(NFFT, 1 / SR) < 150
    win = np.hanning(NFFT).astype(np.float32)
    lowf = np.empty(n_f, dtype=np.float32)
    for s in range(0, n_f, 4096):
        idx = np.arange(NFFT)[None, :] + fine_hop * np.arange(s, min(n_f, s + 4096))[:, None]
        lowf[s: s + len(idx)] = np.abs(np.fft.rfft(y[idx] * win, axis=1))[:, fr].sum(axis=1)
    kick = np.maximum(0, np.diff(np.log1p(100 * lowf), prepend=0))
    ffps = SR / fine_hop
    # Re-pick the phase on the kick envelope: spectral flux alone can lock onto
    # off-beat hi-hats, half a beat away from the kick.
    ph_cands = np.linspace(0, period, 256, endpoint=False)
    ph_scores = []
    for ph in ph_cands:
        fi_ = np.round(np.arange(ph, dur - 0.1, period) * ffps).astype(int)
        ph_scores.append(kick[fi_[fi_ < len(kick)]].sum())
    phase = float(ph_cands[int(np.argmax(ph_scores))])
    ks, ts, st = [], [], []
    w = int(0.04 * ffps)
    for k in range(int((dur - phase) / period)):
        c = int(round((phase + k * period) * ffps))
        seg = kick[max(0, c - w): c + w + 1]
        if len(seg):
            ks.append(k); ts.append((max(0, c - w) + int(np.argmax(seg))) / ffps); st.append(seg.max())
    ks, ts, st = map(np.array, (ks, ts, st))
    m = st > np.percentile(st, 50)
    for _ in range(3):  # fit, reject outliers, refit
        b1, b0 = np.polyfit(ks[m], ts[m], 1)
        resid = ts - (b0 + b1 * ks)
        m = m & (np.abs(resid) < 0.02)
    period, phase = float(b1), float(b0)
    grid_ok = m.copy()

    # STFT frames smear time by up to NFFT samples, so pin the absolute offset
    # in the time domain: low-pass the signal (<150 Hz), take a 2 ms envelope,
    # and find the steepest rise near each confidently-fitted beat.
    Y = np.fft.rfft(y)
    Y[np.fft.rfftfreq(len(y), 1 / SR) > 150] = 0
    lp = np.abs(np.fft.irfft(Y, len(y)))
    env_w = int(0.002 * SR)
    env = np.convolve(lp, np.ones(env_w) / env_w, mode="same")
    rise = np.diff(env, prepend=env[0])

    def attack(a, z):
        # steepest rise in [a, z), then walk back to where the envelope was
        # still below 10% of the level it reaches 10 ms after that rise
        p = a + int(np.argmax(rise[a:z]))
        level = env[p: p + int(0.01 * SR)].max()
        q = p
        while q > a and env[q] > 0.1 * level:
            q -= 1
        return q / SR

    offsets = []
    for k in ks[grid_ok]:
        c = int(round((phase + k * period) * SR))
        a, z = max(0, c - int(0.03 * SR)), c + int(0.12 * SR)
        if z < len(rise):
            offsets.append(attack(a, z) - (phase + k * period))
    phase += float(np.median(offsets))
    while phase - period >= 0:
        phase -= period
    bpm = 60 / period
    grid_residual_ms = float(np.std(resid[m]) * 1000)
    beats = np.arange(phase, dur - period, period)

    # Low-band (<150 Hz) and full-band energy per beat
    low = S[:, freqs < 150].sum(axis=1)
    full = S.sum(axis=1)

    def fi(t):  # time in seconds -> coarse frame index
        return max(0, int(round((t - CENTRE) * fps)))

    def per_beat(env):
        out = []
        for b in beats:
            a, z = fi(b), fi(b + period)
            out.append(env[a:z].mean() if z > a else 0)
        return np.array(out)

    low_b, full_b = per_beat(low), per_beat(full)

    # Downbeat: which of the 4 beat positions carries the most onset energy on the kick
    onset_b = np.array([flux[max(0, fi(b) - 2): fi(b) + 3].max() for b in beats])
    kick_b = np.array([low[max(0, fi(b) - 2): fi(b) + 4].max() for b in beats])
    pos_score = [(onset_b[p::4].mean() + kick_b[p::4].mean() / kick_b.mean()) for p in range(4)]
    down = int(np.argmax(pos_score))
    downbeats = beats[down::4]

    # Drop: largest rise of (low + full) energy, 4 bars after vs 4 bars before a downbeat
    e = low_b / low_b.max() + full_b / full_b.max()
    best, drop_idx, drop_gain = -1, None, 0
    for bi in range(16, len(beats) - 16):  # every beat: the downbeat guess can be off
        before, after = e[bi - 16: bi].mean(), e[bi: bi + 16].mean()
        # a drop also wants a dip right before (build/break), reward that
        dip = e[bi - 4: bi].mean()
        score = (after - before) + 0.5 * (after - dip)
        if score > best:
            best, drop_idx, drop_gain = score, bi, after / max(before, 1e-9)
    drop_t = float(beats[drop_idx]) if drop_idx is not None else None

    # Snap the drop to the actual kick transient (strongest within ±60 ms, fine envelope)
    if drop_t is not None:
        c = int(round(drop_t * SR))
        a = max(0, c - int(0.06 * SR))
        drop_t_exact = attack(a, c + int(0.06 * SR))
    else:
        drop_t_exact = None

    return {
        "file": os.path.basename(path),
        "duration_s": round(dur, 3),
        "bpm": round(bpm, 2),
        "beat_period_s": round(period, 5),
        "grid_residual_ms": round(grid_residual_ms, 1),
        "first_beat_s": round(float(beats[0]), 4),
        "first_downbeat_s": round(float(downbeats[0]), 4),
        "beats_s": [round(float(b), 4) for b in beats],
        "downbeats_s": [round(float(b), 4) for b in downbeats],
        "drop_grid_s": round(drop_t, 4) if drop_t is not None else None,
        "drop_transient_s": round(drop_t_exact, 4) if drop_t_exact is not None else None,
        "drop_bar": int((drop_idx - down) // 4) + 1 if drop_idx is not None else None,
        "drop_energy_ratio": round(float(drop_gain), 2),
        "energy_per_beat": [round(float(v), 3) for v in e],
    }


if __name__ == "__main__":
    r = analyze(sys.argv[1])
    if "--json" in sys.argv:
        with open(sys.argv[sys.argv.index("--json") + 1], "w") as fh:
            json.dump(r, fh, indent=1)
    print(f"{r['file']}: {r['bpm']} BPM, {r['duration_s']}s, first downbeat {r['first_downbeat_s']}s, "
          f"drop {r['drop_transient_s']}s (bar {r['drop_bar']}, energy x{r['drop_energy_ratio']})")
