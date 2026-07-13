/**
 * ProjectilePool - lightweight mesh-reuse pool for short-lived projectile meshes.
 *
 * Instead of creating + disposing a mesh for every shot (GPU buffer
 * allocations and GC pressure), callers acquire a mesh from the pool and
 * release it back when the projectile lands or expires.
 *
 * Usage:
 *   const mesh = acquireProjectile('basic_attack', () =>
 *       createSphere('basicProj', { diameter: 0.3 }, host));
 *   // ... move mesh each frame ...
 *   releaseProjectile('basic_attack', mesh); // instead of disposeMesh(mesh)
 *
 * Pool growth is capped at MAX_POOL_SIZE per key. Above that cap, the caller's
 * factory function is used to create a temporary mesh that is disposed on release
 * (same as the old behaviour), preventing unbounded memory growth in edge cases
 * where many projectiles are live simultaneously.
 */

import { Mesh } from 'three';
import { disposeMesh, isMeshDisposed } from '../three/primitives';

const MAX_POOL_SIZE = 32;

interface PoolEntry {
    mesh: Mesh;
    inUse: boolean;
    /** True = this mesh was allocated beyond the cap and must be disposed on release. */
    ephemeral: boolean;
}

const pools = new Map<string, PoolEntry[]>();

/**
 * Acquire a projectile mesh from the pool (or create a new one on miss).
 * The returned mesh is visible and at an unspecified position - callers MUST
 * reset position, scale, and rotation before use.
 */
export function acquireProjectile(
    key: string,
    create: () => Mesh,
): Mesh {
    let pool = pools.get(key);
    if (!pool) { pool = []; pools.set(key, pool); }

    // Find a free slot
    for (const entry of pool) {
        if (!entry.inUse && !isMeshDisposed(entry.mesh)) {
            entry.inUse = true;
            entry.mesh.visible = true;
            // Reset transforms so previous flight state doesn't leak
            entry.mesh.position.set(0, 0, 0);
            entry.mesh.scale.set(1, 1, 1);
            entry.mesh.rotation.set(0, 0, 0);
            return entry.mesh;
        }
    }

    // No free slot - create a new mesh
    const mesh = create();
    const ephemeral = pool.length >= MAX_POOL_SIZE;
    pool.push({ mesh, inUse: true, ephemeral });
    return mesh;
}

/**
 * Release a projectile mesh back to its pool.
 * The mesh is hidden so it doesn't appear in the scene.
 * Ephemeral meshes (created beyond the cap) are disposed instead.
 */
export function releaseProjectile(key: string, mesh: Mesh): void {
    const pool = pools.get(key);
    if (!pool) {
        // Unknown pool - just dispose to avoid leaking
        if (!isMeshDisposed(mesh)) disposeMesh(mesh);
        return;
    }
    const entry = pool.find(e => e.mesh === mesh);
    if (!entry) {
        if (!isMeshDisposed(mesh)) disposeMesh(mesh);
        return;
    }
    if (entry.ephemeral) {
        // Above-cap mesh - dispose and remove from pool
        if (!isMeshDisposed(mesh)) disposeMesh(mesh);
        const idx = pool.indexOf(entry);
        if (idx !== -1) pool.splice(idx, 1);
        return;
    }
    entry.inUse = false;
    mesh.visible = false;
}

/**
 * Dispose all pooled meshes and clear all pools.
 * Called alongside clearMaterialCache() from SurvivorsGameplayState.exit().
 */
export function clearProjectilePools(): void {
    for (const pool of pools.values()) {
        for (const entry of pool) {
            try { if (!isMeshDisposed(entry.mesh)) disposeMesh(entry.mesh); } catch { /* ignore */ }
        }
    }
    pools.clear();
}
