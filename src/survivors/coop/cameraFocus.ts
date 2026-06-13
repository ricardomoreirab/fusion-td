// Pure camera-framing math for the shared/tethered co-op camera. No Babylon —
// returns a plain focus point + a slant-distance multiplier the scene layer applies
// to the camera (see setCameraSlantPosition in ../cameraZoom).

export interface Point2 { x: number; z: number }
/** Co-op framing tuning. `scalePerUnit` adds this much slant-distance multiplier per
 *  world-unit of hero separation; `maxScale` caps how far the camera pulls back. */
export interface FocusOpts { maxScale: number; scalePerUnit: number }
/** Where to point the shared camera: the ground point to centre on, plus a multiplier on
 *  the camera's BASE slant distance (1 = solo framing, >1 = pulled straight back). The
 *  scene layer scales BOTH camera height and z-offset by it, so the look-down pitch is
 *  fixed — the co-op camera never tilts differently from solo, it only pulls back. */
export interface Focus { x: number; z: number; distanceScale: number }

/**
 * Frame one or two heroes. With a teammate, focus on the midpoint and pull the camera
 * straight back (a >1 multiplier on the base slant distance) proportional to their
 * separation — zoom-to-fit — capped at `maxScale`. With no teammate, or zero separation,
 * the scale is exactly 1 so the framing is identical to solo play.
 */
export function computeCameraFocus(self: Point2, mate: Point2 | null, opts: FocusOpts): Focus {
    if (!mate) {
        return { x: self.x, z: self.z, distanceScale: 1 };
    }
    const midX = (self.x + mate.x) / 2;
    const midZ = (self.z + mate.z) / 2;
    const sep = Math.hypot(self.x - mate.x, self.z - mate.z);
    const distanceScale = Math.min(opts.maxScale, 1 + sep * opts.scalePerUnit);
    return { x: midX, z: midZ, distanceScale };
}
