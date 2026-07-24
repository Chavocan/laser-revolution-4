# LASER REVOLUTION 4: APOCALYPSE DANCE PARTY (prototype v0.6)

2D parkour laser-tag for **1–4 players**. Lasers reflect off mirrors — every bounce
**multiplies damage**, and bounced beams **can hit YOU** (laser-jump off the knockback).
Solo, CO-OP vs the bots, or FACE-OFF (first to 10 frags) across **4 stages** with hazards.

## Classes (animated select screen for solo; pick live inside multiplayer lobbies)

Each dancer has an idle groove plus a signature move every few seconds: BOUNCER backflips,
RAVER zips with afterimages, TITAN ground-pounds (dust included), PRISMANCER levitates and
conjures a mini bouncing-laser show. Lobby slots show everyone's picked dancer live.

| Class | Stats | Signature weapon | First-loot signature |
|---|---|---|---|
| BOUNCER | 100 HP · 100% speed | GROOVE PISTOL | +1 MIRROR CAP |
| RAVER | 75 HP · 118% speed · small hitbox | DISCO SHREDDER | BLINK |
| TITAN | 150 HP · 80% speed · big hitbox | MIRRORBALL SCATTER | MIRROR SUIT |
| PRISMANCER | 85 HP · 102% speed | RAVE LANCE | PRISM OVERDRIVE |

Your weapon is fixed by your class. Your **first loot box each match** always pays out your
class signature item; after that the roulette is random.

## Directional hits

Laser knockback follows the beam: hit from **above** = spiked into the stage with a
platformer-style floor bounce, from **below** = launched, head-on = shoved. Applies to
PvP lasers, your own bounced shots, and bot orbs — spike your rivals into the pits.

## Run it locally

```
npm install        # once (ws)
npm start          # game + room server on http://localhost:8124  (PORT env / argv override)
```

(Claude Code preview config: `laser-rev-4`.)

## Host it online (friends over the internet)

```
cloudflared tunnel --url http://localhost:8124
```

Share the printed `https://….trycloudflare.com` URL — client, WebSocket rooms, everything
goes through it. Quick-tunnel URLs are ephemeral (new URL each run, dies with the process).

**itch.io** hosts static files only — it can't run `server.js`, so the room server lives on
a free Node host (Render/Fly/Railway — `server.js` reads `PORT`) and every itch copy of the
game connects to it. Pipeline:

1. Deploy this repo as a Node web service (start command `node server.js`) → note the URL.
2. `node build-itch.js wss://your-app.onrender.com` → produces
   `dist/laser-revolution-4-itch.zip` with the server address baked in
   (`window.LR4_SERVER`; `?server=wss://host` also works for ad-hoc testing).
3. On itch.io: new project → Kind of project: HTML → upload the zip → check
   **"This file will be played in the browser"** → viewport ~1280×720 + fullscreen button.

Everyone playing on itch shares the same lobbies, room codes, and 4-player matches.

## Lobby flow

Host clicks HOST CO-OP / HOST FACE-OFF (stage selector cycles the VS arena, or RANDOM) →
up to 3 more players click the JOIN button that appears on their menus → host presses
START. Keep game windows visible — hidden browser tabs throttle their sim.

## Stages (Face-Off)

| Stage | Gimmick |
|---|---|
| APOCALYPSE BLOCK | the original block party |
| MIRROR TEMPLE | mirror-heavy symmetric arena · laser pits in the floor · perch atop the tower (wall-jump + double jump) |
| NEON GAUNTLET | a slow laser wall sweeps the whole arena — high deck is safe · sealed loot perch needs a dash-jump chain |
| SKY SCAFFOLD | floating platforms over a death floor · under-platform mirrors for laser-jump recoveries |

## Controls

| Input | Action |
|---|---|
| A / D | move |
| SPACE | jump ×2 (wall-jump on walls) — W does NOT jump |
| SHIFT + A/D/W/S | 8-way dash (W = up) — refunds a jump when it ends |
| S | fast-fall / drop through grates |
| Mouse + LMB | aim + fire · [T] toggles laser sight (**only you see yours**) |
| 1–4 / scroll | weapons (pistol / shredder / scatter / charge lance) |
| E or RMB | mirror placement (scroll/R rotate, click place, X pick up) |
| Q / F / C | hook · throw item · blink (when looted) |
| H / P / M | help / pause (solo) / mute |

## Mirrors

- You may have **3 placed at once** (never consumed) — placing a 4th recycles your oldest.
- Loot can raise your cap **+1 up to 6** for the match.
- **Player mirrors shatter after 5 bounces** (cracks accumulate). Stage mirrors
  are indestructible.
- **All mirrors deflect enemy orbs.** A deflected orb turns cyan, becomes friendly, and
  damages bots — bounce one into a prism and it counts as the required bounce.

## Volume

Menu has MASTER / MUSIC / SFX sliders (wide windows) — in-game `-` / `=` adjusts master,
`M` mutes. Settings persist.

## Loot boxes (respawn 8s, Mario-Kart roulette — 15 items)

HEAL +40 · MIRROR CAP +1 · FEVER FIRE ×1.8 · AMP UP ×1.5 · PRISM OVERDRIVE +3 bounces ·
DISCO STAR (invuln + speed) · NINJA HOOK (Q grapple) · JETPACK (hold jump) ·
DISCO BALL (F throw — sprays bouncing lasers that hurt everyone) · MOON BOOTS (low grav) ·
**BLINK** (C teleport to crosshair) · **MIRROR SUIT** (lasers bounce off your body — as a
bounce, so they get STRONGER) · **BEAT DROP** (instant AOE shockwave) · **SPEED SKATES** ·
**DECOY DANCER** (holographic clone that draws bot fire)

## Hype stingers (beat-synced SFX)

Big moments fire musical one-shots **quantized to the next beat** of the 128 BPM loop
(vocals land on quarter notes) — they hit like part of the track, not over it:

- **Multi-bounce kills** → "YEAH!" · **every frag** → airhorn · **Disco Star** → "WOW!" ·
  **Beat Drop loot** → orchestra hit.
- **Hype speakers**: each stage hangs 3 shootable speaker props (YEAH! / BWAAAP! /
  WIKI-WIKI / WOW!). Shoot one (bounce shots and disco balls work) → stinger on the beat,
  confetti, and the dancefloor cranks up for a couple of seconds. 2.5s cooldown each.
  Everyone in the room hears it.
- Drop **your own Suno-made samples** into `sfx/` (`yeah.mp3`, `airhorn.mp3`, `scratch.mp3`,
  `wow.mp3`, `horn.mp3`) and they replace the synth fallbacks automatically — see
  [sfx/README.md](sfx/README.md). Preview from the console with `LR4.sting('yeah')`.

## Soundtrack (Suno tracks in `music/`)

Full dynamic score, all served locally and routed through the game's audio graph:

| Track | Plays |
|---|---|
| Start the Apocalypse | menu |
| Grate Expectations | lobby (elevator music at the end of the world) |
| Dancefloor Salvation v2 / Prism Alley (+v2) | solo & co-op (random pick per match) |
| Frag Fever (+v2) | Face-Off |
| Ten Percent Battery (+v2) | crossfades in under 25% HP, out above 40 |
| Mirrorball Lift (+v2) | Disco Star overlay (main track ducks) |
| Dropped on the Beat | death sting |
| Crowned in Neon (+v2) | crown jingle at 10 frags |

v2 variants are chosen at random for variety. Overlays duck the main track to ~12%,
the danger layer to ~30%. The **beat grid — dancefloor tiles, dancing bots, and stinger
quantization — locks to the playing track's clock**, so everything stays on ITS beat.
A "♫ track name" toast shows on every change; the old synth loop remains as a fallback
if the files are missing. Test from the console: `LR4.music()` / `LR4.overlay('crown')`.

## Rules of the party

- Bounce = power; your own bounced beams hit you for 50% + knockback (laser-jumping tech).
- Taking damage refunds your air jump + dash; dashing refunds your jump. Stay airborne.
- VS scoring: kill = +1 frag to the killer; any self-inflicted or hazard death = **−1**.
- Prisms only take bounced shots · grates pass lasers · red zones are hazards.

## Architecture

- `index.html` + `game.js` — whole client (canvas, physics, raycast reflection engine,
  4-player netcode, stages, audio synth). No build step.
- `server.js` — static files + dumb WebSocket relay. Rooms of 4 with lobby + host-start;
  host client (P1) is authoritative for enemies/loot/score; shooters own their hits.

## Debug hooks (console)

`LR4.state()` · `LR4.solo()` · `LR4.host('coop'|'vs')` · `LR4.join(code)` · `LR4.begin()` ·
`LR4.setStage(i)` · `LR4.rooms()` · `LR4.leave()` · `LR4.give(id)` · `LR4.tick(dt,steps)` ·
`LR4.setWorld(mode,stageIdx)` · `LR4.shootAt(x,y)` · `LR4.teleport(x,y)` · `LR4.demo(ms)`
