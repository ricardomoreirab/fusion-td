// Pure pose interpolation buffer for the ghost teammate. No Babylon — operates
// on plain {x,y,z,ry}. The render side reads sample(renderTimeMs) each frame.

export interface Pose { x: number; y: number; z: number; ry: number }

interface Stamped { t: number; p: Pose }

function lerp(a: number, b: number, k: number): number {
    return a + (b - a) * k;
}

/** Interpolate an angle along the shortest arc. */
function lerpAngle(a: number, b: number, k: number): number {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
}

export class PoseBuffer {
    private samples: Stamped[] = [];
    private maxSamples = 32;

    push(t: number, p: Pose): void {
        this.samples.push({ t, p });
        if (this.samples.length > this.maxSamples) this.samples.shift();
    }

    /** Interpolated pose at render time `t` (ms), or null if no samples yet. */
    sample(t: number): Pose | null {
        const s = this.samples;
        if (s.length === 0) return null;
        if (s.length === 1) return { ...s[0].p };
        if (t <= s[0].t) return { ...s[0].p };
        const last = s[s.length - 1];
        if (t >= last.t) return { ...last.p };

        for (let i = 0; i < s.length - 1; i++) {
            const a = s[i], b = s[i + 1];
            if (t >= a.t && t <= b.t) {
                const k = (t - a.t) / (b.t - a.t);
                return {
                    x: lerp(a.p.x, b.p.x, k),
                    y: lerp(a.p.y, b.p.y, k),
                    z: lerp(a.p.z, b.p.z, k),
                    ry: lerpAngle(a.p.ry, b.p.ry, k),
                };
            }
        }
        return { ...last.p };
    }

    /** Horizontal speed (units/sec) of the buffered motion at render time `t`,
     *  i.e. the XZ displacement rate of the segment sample(t) interpolates
     *  across. 0 outside the buffered range — there the pose is clamped, not
     *  moving. Allocation-free (called per enemy per frame on the guest). */
    speedAt(t: number): number {
        const s = this.samples;
        if (s.length < 2 || t <= s[0].t || t >= s[s.length - 1].t) return 0;
        for (let i = 0; i < s.length - 1; i++) {
            const a = s[i], b = s[i + 1];
            if (t >= a.t && t <= b.t) {
                const dtMs = b.t - a.t;
                if (dtMs <= 0) return 0;
                const dx = b.p.x - a.p.x;
                const dz = b.p.z - a.p.z;
                return Math.sqrt(dx * dx + dz * dz) / (dtMs / 1000);
            }
        }
        return 0;
    }
}
