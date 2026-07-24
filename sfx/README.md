# Custom stinger samples (drop your Suno-made sounds here)

The game auto-loads these filenames at startup and uses them instead of the
built-in synth fallbacks. Use `.mp3`, `.wav`, or `.ogg`:

| filename | plays when | keep it |
|---|---|---|
| `yeah.mp3` | multi-bounce kills · YEAH! speakers | a crowd shout, under 1s |
| `airhorn.mp3` | every frag in Face-Off · airhorn speakers | classic DJ airhorn |
| `scratch.mp3` | scratch speakers | quick turntable wiki-wiki |
| `wow.mp3` | Disco Star pickup · WOW! speakers | awed vocal or riser |
| `horn.mp3` | BEAT DROP loot | orchestra-hit / brass stab |

Tips for Suno (or any source):
- Keep them SHORT (0.3–1.5s) and dry-ish — they're quantized to land on the
  next beat of the 128 BPM loop, so long tails smear across beats.
- Trim silence from the start: playback begins exactly on the beat.
- One-shot vocal stabs work best: "YEAH!", "LET'S GO!", "OHHH!".
