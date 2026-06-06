// Pure camera-framing math for the shared/tethered co-op camera. No Babylon —
// returns a plain focus point + height the scene layer applies to the camera.

export interface Point2 { x: number; z: number }
export interface FocusOpts { baseHeight: number; maxHeight: number; zoomPerUnit: number }
export interface Focus { x: number; z: number; height: number }

/**
 * Frame one or two heroes. With a teammate, focus on the midpoint and raise the
 * camera height proportional to their separation (zoom-to-fit), capped.
 */
export function computeCameraFocus(self: Point2, mate: Point2 | null, opts: FocusOpts): Focus {
    if (!mate) {
        return { x: self.x, z: self.z, height: opts.baseHeight };
    }
    const midX = (self.x + mate.x) / 2;
    const midZ = (self.z + mate.z) / 2;
    const sep = Math.hypot(self.x - mate.x, self.z - mate.z);
    const height = Math.min(opts.maxHeight, opts.baseHeight + sep * opts.zoomPerUnit);
    return { x: midX, z: midZ, height };
}
