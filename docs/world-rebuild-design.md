# World Rebuild — Design Brief, Loop Contract, and World Plan

Rebuild of the survivors-mode scenario as a from-scratch system under a true orthographic isometric camera.
Supersedes the `src/survivors/globe/` package (kept alive behind a flag until this is approved).

## Design Brief

**Player promise.**
You are one hunter holding ground on land that is rotting under your feet while the horde thickens around you.

**Target feeling.**
Mounting dread with total legibility.
The world should get uglier and more hostile as the run escalates, but never harder to read.

**Primary verb.** Reposition — kiting the swarm is the whole game.

**Secondary verbs.** Cast, collect, level.

**Core loop (5-30s).**
Read the swarm shape, pick an escape lane, kite through it, let autocast powers clear the trail, hoover the drops.

**Progression loop (1-5 min).**
Waves escalate, XP levels raise every attribute, power slots fill and fuse, and the ground itself changes biome as a standing signal of how deep the run is.

**Fail/retry loop.**
Contact damage drains HP; death ends the run to the summary screen; restart is one click from the menu.

**Skill expression.**
Better players read the swarm earlier, keep an open lane behind them, and never let two spawn arcs close into a ring.

**Readability promise.**
Ground value stays inside a narrow mid-dark band in every biome, so bright enemies, drops, and power VFX always separate from it by luminance alone — never by hue alone.

**Non-goals for this rebuild.**
Hero, enemies, powers, HUD, co-op protocol, and wave logic are all untouched.
No bounded arena, no walls, no destructible terrain, no verticality.

## Core Loop Contract

```
Player REPOSITIONS to survive the swarm while CONTACT DAMAGE AND ENCIRCLEMENT create risk;
success gives XP, levels, drops, and power fusions;
failure costs the run and returns to the summary screen.
```

The world's only job in that contract is to keep the next decision readable and to make motion legible.
Everything below is subordinate to those two jobs.

## Camera Contract

True orthographic isometric.
Pitch 35.264 degrees (`atan(1/sqrt(2))`), yaw 45 degrees, parallel projection, no vanishing point.

What the camera can see:

- The hero, always centred, with roughly 44 x 28 world units of ground at default zoom on 16:9.
- Every enemy that matters, because the spawn ring at radius 40 sits outside the frame's half-diagonal of about 26 — enemies always enter from off-screen, which is the Vampire Survivors contract.
- Mid-height props up to about 4 units before they start occluding gameplay.

What the camera cannot see:

- A useful horizon.
  This is the load-bearing consequence of choosing true orthographic.
  With no vanishing point the sky compresses into a thin band at the top of the frame and stops carrying any depth.
- Anything behind a tall prop, which is why nothing in the prop kit may exceed 4 units of height near the play area.

**Consequence for art direction.**
Because the sky is nearly irrelevant under this projection, the world has to carry itself on ground detail and mid-height silhouettes.
Budget shifts accordingly: terrain and scatter get the spend, the sky vault gets a cheap gradient and stays out of the way.

## World Plan

**Spatial format.** Infinite hero-centred treadmill. No edges, no walls, no clamp.

**Player start.** Origin, in the Verdant Wake biome, with no threat for the first spawn beat.

**First decision.** Which direction to open a lane, made legible by the first landmark prop being visible on screen at spawn.

**First threat.** The wave-1 spawn arc entering from off-screen.

**Orientation anchors.**
This is the single biggest risk of an infinite ground plane: with nothing but terrain, motion reads as a treadmill and the hero feels static.
Landmark props recycle around the hero at a density tuned so that **one to two landmarks are in frame at all times**.
They are the only thing that proves the player is actually moving.

**Escalation — biome bands.**

| Waves | Biome | Ground read | Signature props | Atmosphere |
| --- | --- | --- | --- | --- |
| 1-9 | Verdant Wake | Dusk meadow turf, dry golden patches | Standing stones, mossy boulders | Warm dusk key, soft haze |
| 10-19 | Scorched Reach | Cracked black soil, ash drifts, ember cracks | Burnt trees, ruined arches | Hot low key, ember motes, heavier haze |
| 20+ | Cursed Hollow | Pale ash, violet rot veins, bone flecks | Bone piles, monoliths, totems | Cold violet key, low ground mist |

Transitions cross-fade over the final 1.5 waves of each band.
The terrain shader lerps two biome material sets; scatter and prop kits cross-fade by instance scale so nothing pops.

**Recovery beats.**
The wave-clear gap is the breathing room.
The biome transition itself is deliberately placed on a wave boundary so the change lands during calm, not mid-swarm.

**Failure readability.**
The world never hides a threat.
Ground mist stays below 0.4 units, no prop exceeds 4 units near the hero, and bloom is restricted to authored emissives (ember cracks, rot veins) so it can never stand in for missing geometry.

**Reuse plan.**
Terrain is one shader with a biome-pair uniform.
Scatter and props are instanced kits parameterised per biome.
Adding a fourth biome is a table entry, not new code.

## Difficulty And Pacing Note

The world does not change difficulty.
It is a *signal* of difficulty that the wave system already applies.
This is deliberate: coupling terrain to damage would make the biome a hidden mechanic, and the readability promise above forbids that.
