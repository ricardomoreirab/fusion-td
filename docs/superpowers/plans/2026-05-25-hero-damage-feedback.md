# Hero Damage Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the hero takes damage, fire a coordinated reaction — red mesh flash, knockback shove, blood particle burst, and brief camera shake — rate-limited so per-frame contact damage doesn't produce a permanent strobe.

**Architecture:** Add `lastHitReactionTime` to `HeroController` to gate visual/physical feedback to at most once per 0.5s of continuous contact (HP still ticks every frame). `HeroController.takeDamage(amount, sourcePos?)` accepts the source position to compute knockback direction. Knockback is an additive velocity that decays over 0.15s, camera shake is an additive offset that decays over 0.1s, blood particles are a one-shot `ParticleSystem` modeled on `Champion.spawnBloodSplatter()`, and the red flash is a new `Champion.flashHitRed()` modeled on `Enemy.flashHit()`.

**Tech Stack:** BabylonJS, TypeScript. No test suite — verification is `npx tsc --noEmit` + manual in-browser playtest via `npm start`.

**Spec reference:** `docs/superpowers/specs/2026-05-25-hero-damage-feedback-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/game/gameplay/HeroController.ts` | Owns the rate limiter, knockback velocity integration, camera shake offset, blood-burst spawn helper, and the call into `Champion.flashHitRed()`. All four effects are orchestrated here through `triggerHitReaction()`. |
| `src/game/gameplay/Champion.ts` | New `flashHitRed()` method — pulses red emissive across the champion mesh tree for 150ms, with in-flight refresh so concurrent reactions don't corrupt the restore color. |
| `src/game/states/SurvivorsGameplayState.ts` | Passes `ePos` (enemy position) as the second argument to `heroController.takeDamage()` in `applyContactDamage()`. |

All tuning constants live as named `const`s near the top of `HeroController.ts` so playtest adjustments have a single home.

---

### Task 1: Plumb `sourcePos` through `takeDamage` signature

Pure refactor. No behavior change yet. The new parameter is unused inside `takeDamage()` — wired so Task 2 can use it without touching the caller again.

**Files:**
- Modify: `src/game/gameplay/HeroController.ts:135-143`
- Modify: `src/game/states/SurvivorsGameplayState.ts:712-730`

- [ ] **Step 1: Update `HeroController.takeDamage` signature**

Replace the existing `takeDamage` method body (currently at line 135) with:

```typescript
public takeDamage(amount: number, _sourcePos?: Vector3): void {
    if (this.isDead) return;
    this.currentHealth -= amount;
    if (this.currentHealth <= 0) {
        this.currentHealth = 0;
        this.isDead = true;
        this.onDeathCallback();
    }
}
```

The `_sourcePos` parameter is intentionally prefixed with `_` to mark it as unused for this task — Task 2 will start consuming it. Leaving it unprefixed now would draw a lint/IDE warning.

- [ ] **Step 2: Update the caller in `SurvivorsGameplayState.applyContactDamage`**

Find the line at `src/game/states/SurvivorsGameplayState.ts:727`:

```typescript
this.heroController.takeDamage(e.contactDamagePerSecond * deltaTime * reductionMult);
```

Change to:

```typescript
this.heroController.takeDamage(e.contactDamagePerSecond * deltaTime * reductionMult, ePos);
```

`ePos` is already in scope from `const ePos = e.getPosition();` four lines above.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors. (If errors appear, they likely indicate another caller of hero `takeDamage` that the spec missed — read the error, find the caller, pass `undefined` as the second arg or omit it.)

- [ ] **Step 4: Commit**

```bash
git add src/game/gameplay/HeroController.ts src/game/states/SurvivorsGameplayState.ts
git commit -m "refactor(hero): thread sourcePos into takeDamage signature"
```

---

### Task 2: Add tuning constants, rate-limited trigger, and red flash

After this task, the hero mesh flashes red every ~0.5s while in contact with an enemy. The other three effects come in Tasks 3–5.

**Files:**
- Modify: `src/game/gameplay/HeroController.ts` (constants block near top, new fields, new `triggerHitReaction` method, call from `takeDamage`)
- Modify: `src/game/gameplay/Champion.ts` (new `flashHitRed` method, new private flash-tracking fields)

- [ ] **Step 1: Add `flashHitRed` to `Champion`**

Add these private fields to the `Champion` class (group them with the existing `// Cached Color3 instances` block around line 82):

```typescript
// Red hit-flash state — used by flashHitRed() to refresh the in-flight
// flash instead of stacking snapshots that capture the already-red emissive.
private flashHitRedActive: boolean = false;
private flashHitRedRestoreTimer: ReturnType<typeof setTimeout> | null = null;
private flashHitRedSnapshot: { mat: StandardMaterial; color: Color3 }[] = [];
```

Then add this method (place it next to other public visual helpers — e.g. just above the `dispose` method or near `triggerSpinAttack`):

```typescript
/**
 * Pulse the champion mesh red for 150ms to signal damage taken.
 * Walks the full child-mesh tree. If a flash is already in progress,
 * restart its timer instead of re-snapshotting (which would otherwise
 * capture the already-red emissive and "restore" to red).
 */
public flashHitRed(): void {
    if (!this.mesh || this.mesh.isDisposed()) return;

    const RED = new Color3(1, 0.15, 0.15);
    const DURATION_MS = 150;

    if (!this.flashHitRedActive) {
        // Fresh flash — snapshot original emissive colors.
        const meshes = [this.mesh, ...this.mesh.getChildMeshes(false)];
        this.flashHitRedSnapshot = [];
        for (const m of meshes) {
            const mat = m.material as StandardMaterial;
            if (mat && mat.emissiveColor !== undefined) {
                this.flashHitRedSnapshot.push({ mat, color: mat.emissiveColor.clone() });
                mat.emissiveColor = RED;
            }
        }
        this.flashHitRedActive = true;
    }
    // Reset / extend the restore timer either way.
    if (this.flashHitRedRestoreTimer !== null) {
        clearTimeout(this.flashHitRedRestoreTimer);
    }
    this.flashHitRedRestoreTimer = setTimeout(() => {
        for (const entry of this.flashHitRedSnapshot) {
            try { entry.mat.emissiveColor = entry.color; } catch (_) { /* mat disposed */ }
        }
        this.flashHitRedSnapshot = [];
        this.flashHitRedActive = false;
        this.flashHitRedRestoreTimer = null;
    }, DURATION_MS);
}
```

Verify the existing imports at the top of `Champion.ts` already include `Color3` and `StandardMaterial` (they do — line 1).

- [ ] **Step 2: Add tuning constants and reaction trigger to `HeroController`**

Add this block above the `CLASS_ATTACK_CONFIG` declaration (around line 7 in `HeroController.ts`):

```typescript
/** Hero damage-feedback tuning — adjust here, not deep in the update loop. */
const HIT_REACTION_COOLDOWN_S = 0.5;
const KNOCKBACK_SPEED         = 7.0;   // units / sec
const KNOCKBACK_DURATION_S    = 0.15;
const CAMERA_SHAKE_MAGNITUDE  = 0.15;  // world units on camera target XZ
const CAMERA_SHAKE_DURATION_S = 0.10;
const BLOOD_BURST_COUNT       = 12;
```

Add these private fields to `HeroController` (group with the other state — e.g. just below `private moveSpeedMultiplier`, around line 40):

```typescript
// Damage-feedback state — see HIT_REACTION_* / KNOCKBACK_* constants.
private lastHitReactionTime: number = -Infinity;
private elapsedTime: number = 0;
```

Add the trigger method (place near `takeDamage`, around line 145):

```typescript
/**
 * Fire the damage-feedback reaction (flash for now, knockback / particles /
 * shake added in later tasks). Rate-limited to once per HIT_REACTION_COOLDOWN_S
 * so per-frame contact damage doesn't produce a permanent strobe.
 */
private triggerHitReaction(_sourcePos: Vector3 | undefined): void {
    if (this.elapsedTime - this.lastHitReactionTime < HIT_REACTION_COOLDOWN_S) return;
    this.lastHitReactionTime = this.elapsedTime;

    this.hero.flashHitRed();
}
```

- [ ] **Step 3: Drive `elapsedTime` and call the trigger from `takeDamage`**

In the `update(deltaTime)` method at line 186, add at the top (right after the method signature):

```typescript
    this.elapsedTime += deltaTime;
```

In `takeDamage`, change the body from:

```typescript
public takeDamage(amount: number, _sourcePos?: Vector3): void {
    if (this.isDead) return;
    this.currentHealth -= amount;
    if (this.currentHealth <= 0) {
        this.currentHealth = 0;
        this.isDead = true;
        this.onDeathCallback();
    }
}
```

to:

```typescript
public takeDamage(amount: number, sourcePos?: Vector3): void {
    if (this.isDead) return;
    this.currentHealth -= amount;
    if (this.currentHealth <= 0) {
        this.currentHealth = 0;
        this.isDead = true;
        this.onDeathCallback();
        return;
    }
    this.triggerHitReaction(sourcePos);
}
```

(Note: `sourcePos` is no longer underscored. The reaction is suppressed on the killing blow — death cinematic takes over.)

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Manual browser verification**

Run: `npm start`, open http://localhost:9000, click Play, pick any champion, walk into an enemy.
Expected: Every ~0.5 seconds of contact, the hero mesh briefly turns red (~150ms). Between flashes the hero looks normal. HP bar continues to drop every frame as before.

- [ ] **Step 6: Commit**

```bash
git add src/game/gameplay/HeroController.ts src/game/gameplay/Champion.ts
git commit -m "feat(hero): rate-limited red flash on damage taken"
```

---

### Task 3: Add knockback shove

After this task, each hit reaction also pushes the hero a short distance away from the attacking enemy.

**Files:**
- Modify: `src/game/gameplay/HeroController.ts`

- [ ] **Step 1: Add knockback state fields**

Below the damage-feedback state added in Task 2, add:

```typescript
// Knockback impulse — decays over KNOCKBACK_DURATION_S, added to player velocity.
private knockbackVelocity: Vector3 = new Vector3();
private knockbackTimeRemaining: number = 0;
```

- [ ] **Step 2: Apply knockback inside `triggerHitReaction`**

Replace the body of `triggerHitReaction` (from Task 2) with:

```typescript
private triggerHitReaction(sourcePos: Vector3 | undefined): void {
    if (this.elapsedTime - this.lastHitReactionTime < HIT_REACTION_COOLDOWN_S) return;
    this.lastHitReactionTime = this.elapsedTime;

    this.hero.flashHitRed();

    if (sourcePos) {
        const heroPos = this.hero.getPosition();
        const dx = heroPos.x - sourcePos.x;
        const dz = heroPos.z - sourcePos.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.0001) {
            this.knockbackVelocity.set(
                (dx / len) * KNOCKBACK_SPEED,
                0,
                (dz / len) * KNOCKBACK_SPEED,
            );
            this.knockbackTimeRemaining = KNOCKBACK_DURATION_S;
        }
    }
}
```

- [ ] **Step 3: Integrate knockback into the movement update**

In `update(deltaTime)` at line 186, find the velocity setup:

```typescript
this._scratchVel.set(
    dx * this.moveSpeed * this.moveSpeedMultiplier,
    0,
    dz * this.moveSpeed * this.moveSpeedMultiplier,
);
this.hero.setPlayerVelocity(this._scratchVel);
```

Change to:

```typescript
this._scratchVel.set(
    dx * this.moveSpeed * this.moveSpeedMultiplier,
    0,
    dz * this.moveSpeed * this.moveSpeedMultiplier,
);

// Decay knockback impulse, add it on top of player input.
if (this.knockbackTimeRemaining > 0) {
    const decay = Math.max(0, this.knockbackTimeRemaining / KNOCKBACK_DURATION_S);
    this._scratchVel.x += this.knockbackVelocity.x * decay;
    this._scratchVel.z += this.knockbackVelocity.z * decay;
    this.knockbackTimeRemaining -= deltaTime;
}

this.hero.setPlayerVelocity(this._scratchVel);
```

The arena-bounds clamp at lines 207–219 still runs after `Champion.update`, so knockback can't push the hero through the wall.

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Manual browser verification**

Run: `npm start`, walk into an enemy.
Expected: Each red flash is accompanied by a small shove backward (away from the enemy). The shove is brief (~0.15s) and additive — holding W into the enemy still moves you toward it, you just get pushed back a bit on each hit reaction. The hero doesn't get pushed through the arena wall.

- [ ] **Step 6: Commit**

```bash
git add src/game/gameplay/HeroController.ts
git commit -m "feat(hero): add knockback shove on damage taken"
```

---

### Task 4: Add blood particle burst

After this task, each hit reaction spawns a small red particle spray at the hero's torso.

**Files:**
- Modify: `src/game/gameplay/HeroController.ts`

- [ ] **Step 1: Add the imports needed for `ParticleSystem`**

Update the import at the top of `HeroController.ts` from:

```typescript
import { Scene, Vector3, FreeCamera, KeyboardEventTypes } from '@babylonjs/core';
```

to:

```typescript
import { Scene, Vector3, FreeCamera, KeyboardEventTypes, ParticleSystem, Color4 } from '@babylonjs/core';
```

- [ ] **Step 2: Add the blood-burst spawn helper**

Place this private method below `triggerHitReaction` (model is `Champion.spawnBloodSplatter` at `Champion.ts:1100`):

```typescript
/** One-shot red particle burst at the hero's torso to signal damage taken. */
private spawnHeroBloodBurst(): void {
    const heroPos = this.hero.getPosition();
    const burstPos = new Vector3(heroPos.x, heroPos.y + 0.8, heroPos.z);

    const ps = new ParticleSystem('heroBloodBurst', BLOOD_BURST_COUNT, this.scene);
    ps.emitter = burstPos;
    ps.minEmitBox = new Vector3(-0.10, 0, -0.10);
    ps.maxEmitBox = new Vector3(0.10, 0, 0.10);
    ps.color1 = new Color4(0.80, 0.05, 0.05, 1);
    ps.color2 = new Color4(0.50, 0.02, 0.02, 1);
    ps.colorDead = new Color4(0.10, 0, 0, 0);
    ps.minSize = 0.10;
    ps.maxSize = 0.20;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.40;
    ps.emitRate = 80;
    ps.manualEmitCount = BLOOD_BURST_COUNT; // one-shot
    ps.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    ps.direction1 = new Vector3(-1, 0.4, -1);
    ps.direction2 = new Vector3(1, 1.2, 1);
    ps.minEmitPower = 1.5;
    ps.maxEmitPower = 3.0;
    ps.gravity = new Vector3(0, -15, 0);
    ps.start();
    // Stop emission shortly after, then dispose once particles finish their lifetime.
    setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 500); }, 80);
}
```

- [ ] **Step 3: Call it from `triggerHitReaction`**

Add one line inside `triggerHitReaction`, right after `this.hero.flashHitRed();`:

```typescript
    this.hero.flashHitRed();
    this.spawnHeroBloodBurst();
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Manual browser verification**

Run: `npm start`, walk into an enemy.
Expected: Each hit reaction now also sprays ~12 small red particles from the hero's torso area. They fall under gravity and fade within ~0.4s. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/game/gameplay/HeroController.ts
git commit -m "feat(hero): spawn blood particle burst on damage taken"
```

---

### Task 5: Add camera shake

After this task, each hit reaction gives the camera a brief kick that decays back to neutral within ~0.1s.

**Files:**
- Modify: `src/game/gameplay/HeroController.ts`

- [ ] **Step 1: Add shake state fields**

Below the knockback fields added in Task 3, add:

```typescript
// Camera shake — decays to zero over CAMERA_SHAKE_DURATION_S.
private cameraShakeTimeRemaining: number = 0;
```

- [ ] **Step 2: Trigger shake in `triggerHitReaction`**

Add one line inside `triggerHitReaction`, right after `this.spawnHeroBloodBurst();`:

```typescript
    this.spawnHeroBloodBurst();
    this.cameraShakeTimeRemaining = CAMERA_SHAKE_DURATION_S;
```

- [ ] **Step 3: Apply shake offset in the camera lerp**

In `update(deltaTime)`, find the camera-follow block at lines 221–228:

```typescript
// Camera follow — position only, rotation is locked at construction.
this._scratchCamTarget.set(pos.x, this.cameraHeight, pos.z + this.cameraOffsetZ);
Vector3.LerpToRef(
    this.camera.position,
    this._scratchCamTarget,
    Math.min(1, deltaTime * 6),
    this.camera.position,
);
```

Change to:

```typescript
// Camera follow — position only, rotation is locked at construction.
this._scratchCamTarget.set(pos.x, this.cameraHeight, pos.z + this.cameraOffsetZ);

// Additive shake offset that decays to zero. Random direction per frame
// while active; magnitude scales with remaining time.
if (this.cameraShakeTimeRemaining > 0) {
    const k = this.cameraShakeTimeRemaining / CAMERA_SHAKE_DURATION_S;
    const angle = Math.random() * Math.PI * 2;
    this._scratchCamTarget.x += Math.cos(angle) * CAMERA_SHAKE_MAGNITUDE * k;
    this._scratchCamTarget.z += Math.sin(angle) * CAMERA_SHAKE_MAGNITUDE * k;
    this.cameraShakeTimeRemaining -= deltaTime;
}

Vector3.LerpToRef(
    this.camera.position,
    this._scratchCamTarget,
    Math.min(1, deltaTime * 6),
    this.camera.position,
);
```

The shake is applied to the lerp *target*, not the camera position directly — the existing 6× lerp factor smooths it slightly, which reads better than a hard per-frame jitter. With a 0.1s duration the shake still feels punchy.

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Manual browser verification**

Run: `npm start`, walk into an enemy.
Expected: Each hit reaction now also gives the camera a brief jitter that settles back to neutral within ~0.1s. The shake is subtle, not nauseating. All four effects (red flash, knockback, particles, shake) fire together at the rate-limited cadence.

- [ ] **Step 6: Final type check + commit**

Run: `npx tsc --noEmit`
Expected: No errors.

```bash
git add src/game/gameplay/HeroController.ts
git commit -m "feat(hero): camera shake on damage taken"
```

---

## Spec coverage check

| Spec section | Implemented in |
|---|---|
| Trigger model (`lastHitReactionTime`, 0.5s rate limit) | Task 2 |
| Signature change (`sourcePos?: Vector3`) | Task 1 |
| Red mesh flash via new `Champion.flashHitRed()` | Task 2 |
| Knockback shove (additive velocity, 0.15s decay, away from source) | Task 3 |
| Blood particle burst (~12 particles, gravity, ~0.3s lifetime) | Task 4 |
| Camera shake (~0.1s, additive offset, decay) | Task 5 |
| Tuning constants grouped near top of `HeroController.ts` | Task 2 (added) + extended in Tasks 3–5 |
| Death-blow suppression (don't react on killing damage) | Task 2 (early return in `takeDamage`) |
| Arena-bounds clamp still respected by knockback | Task 3 (uses existing clamp) |
| In-flight flash refresh (no restore-to-red bug) | Task 2 (`flashHitRedActive` guard) |

All sections covered. No placeholders. Types and field names are consistent across tasks (`triggerHitReaction`, `lastHitReactionTime`, `knockbackVelocity`, `knockbackTimeRemaining`, `cameraShakeTimeRemaining`, `flashHitRed`).
