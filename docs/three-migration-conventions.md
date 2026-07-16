# Three.js migration conventions (Phase C converters MUST follow)

TEMPORARY doc - deleted in Phase H. Full plan: `~/.claude/plans/fuzzy-fluttering-raven.md`.

## Engine layer (src/engine/three/)
- `SceneHost` (from `game.getScene()`): `.scene` = THREE.Scene, `.deltaSeconds` (replaces `engine.getDeltaTime()/1000`), `.onBeforeRender.add(cb) -> token` / `.remove(token)` (replaces `scene.onBeforeRenderObservable`), `.onAnimUpdate` (pause-gated bus), `.animationsEnabled`, `.particleSystems`.
- `primitives.ts`: `createBox/Cylinder/Sphere/Torus/Polyhedron/Disc/Plane/IcoSphere/Lines/Ground(name, opts, host)` - same opts fields as Babylon MeshBuilder; torus + ground orientations pre-baked (flat in XZ). Meshes auto-added to `host.scene` when host passed.
- `disposeMesh(mesh, {materials?: true})` replaces `mesh.dispose()` / `mesh.dispose(false, true)`. `isMeshDisposed(mesh)` replaces `mesh.isDisposed()`. Flag `mesh.userData.ownedMaterial = true` when a mesh owns a unique material.
- `ParticleSystem(name, capacity, host)` from `engine/three/particles/ParticleSystem`: same field names as Babylon (minSize..., direction1/2, color1/color2/colorDead as `RGBA`, minEmitBox/maxEmitBox/gravity as THREE.Vector3, blendMode `ParticleSystem.BLENDMODE_ONEONE|BLENDMODE_STANDARD`, emitter = Vector3 | Object3D, manualEmitCount, updateSpeed, start/stop/reset/isStarted()/dispose, `onDispose` callback prop).
- `AnimGroup`: `.start(loop)`, `.stop()`, `.reset()`, `.isPlaying`, `.speedRatio`, `.duration`, `.onEnded` callback, `.dispose()`. Non-loop clamps on final frame.
- `assets.ts`: `await loadContainer(url)` (module-cached) -> `container.instantiate(host, namePrefix?)` -> `{ root: Group, animationGroups: AnimGroup[], mixer, dispose() }`. Replaces LoadAssetContainerAsync + instantiateModelsToScene. dispose() frees cloned materials + skeletons + mixer hook.
- `tween(host, seconds, t => {...}, {onEnd?, loop?, ease?})` replaces `new Animation` + `beginAnimation` (Babylon frames/30 = seconds). Import from `engine/three/tween`.
- `DynamicTexture(name, {width, height})`: `.getContext()`, `.update()`, `.texture` (THREE.CanvasTexture), `.dispose()`.
- `math.ts`: `RGBA`/`rgba()`, `headingToYaw(dx, dz)` - ALL facing/yaw atan2 math MUST route through this (single handedness conversion point), `yawToHeading`, `setArcPosition`, `colorFromHex`.

## engine/rendering (already converted)
- `getCachedMaterial(key, setup)` - NO scene param. Returns MeshPhongMaterial with userData.cached=true. Keys stay BOUNDED (color hex / element literals).
- `createLowPolyMaterial(name, color)` / `createEmissiveMaterial(name, color, strength)` - NO scene param, return MeshPhongMaterial.
- `makeFlatShaded(mesh)` unchanged name. `markGlowing(mesh)` = Babylon GlowLayer registration for emissive meshes.
- `setMeshOpacity(mesh, alpha)` replaces `mesh.visibility = a` fades (clone-on-write; never mutate a shared material's opacity).
- `acquireProjectile(key, create)` / `releaseProjectile(key, mesh)` - NO scene param.
- PALETTE colors are THREE.Color (SKY is RGBA).

## Game API changes
- `game.getScene(): SceneHost`. `game.getRendererHost()`. NO `game.getEngine()`.
- `game.setActiveCamera(cam)` / `game.restoreDefaultCamera()` / `game.getActiveCamera()`.
- `game.setClearColor(rgba(...))` replaces `scene.clearColor = new Color4(...)`.
- Render size: `game.getCanvas().clientWidth/Height` replaces `engine.getRenderWidth/Height()`.
- Keyboard: `window.addEventListener('keydown'/'keyup', ...)` (track + remove in exit()) replaces `scene.onKeyboardObservable` + KeyboardEventTypes.

## Mechanical type mapping
- `Vector3` from 'three'. In-place: `addInPlace->add`, `subtractInPlace->sub`, `scaleInPlace->multiplyScalar`, `copyFrom->copy`, `copyFromFloats->set`, `lengthSquared->lengthSq`, `Vector3.Distance(a,b)->a.distanceTo(b)`, `DistanceSquared->distanceToSquared`, `Vector3.Lerp(a,b,t)->new/scratch.lerpVectors(a,b,t)`, `LerpToRef(a,b,t,ref)->ref.lerpVectors(a,b,t)`, `Dot->a.dot(b)`, `Cross->ref.crossVectors(a,b)`, `Vector3.Zero()->new Vector3()`, `Up()->V3_UP (readonly!)`.
- Allocating `v.add/subtract/scale(s)` -> `v.clone().add(...)` / prefer scratch vectors.
- `Quaternion.RotationAxis(axis,a)->q.setFromAxisAngle(axis,a)`, `FromEulerAngles->setFromEuler(new Euler(...))`, `Slerp->q.slerpQuaternions(a,b,t)`.
- `Matrix -> Matrix4`; `Matrix.ComposeToRef(s,q,p,m) -> m.compose(p,q,s)` (ARG ORDER FLIPS).
- `Color3 -> Color` ('three'); `Color3.FromHexString(h) -> new Color(h)`; `c.scale(s) -> c.clone().multiplyScalar(s)`; `Color4 -> RGBA`.
- `StandardMaterial -> MeshPhongMaterial`: diffuseColor->color, emissiveColor->emissive, specularColor->specular, alpha->opacity (+ transparent=true), disableLighting->use MeshBasicMaterial instead (unlit), backFaceCulling=false->side: DoubleSide. `freeze()` -> DELETE.
- `mesh.scaling -> mesh.scale`, `mesh.setEnabled(b) -> mesh.visible = b`, `mesh.isEnabled() -> mesh.visible`, `mesh.isVisible -> mesh.visible`, `mesh.isPickable -> DELETE (no picking)`, `mesh.parent = x -> x.add(mesh)`, `TransformNode -> Group`, `mesh.rotationQuaternion -> mesh.quaternion`, `billboardMode -> use THREE.Sprite` (damage numbers) or manual lookAt.
- `mesh.visibility = a` -> `setMeshOpacity(mesh, a)`.
- `VertexData` -> `BufferGeometry` + `setAttribute('position'|'normal'|'uv', new Float32BufferAttribute(arr, 3|2))` + `setIndex`; `createNormals -> geo.computeVertexNormals()`.
- `scene.getEngine().getDeltaTime()/1000` -> `host.deltaSeconds`.
- `Effect.ShadersStore + ShaderMaterial(...)` -> `new THREE.ShaderMaterial({vertexShader, fragmentShader, uniforms})`; `setFloat/setVector3/setColor3/setMatrix/setArray3` -> `mat.uniforms.x.value = ...`.
- `thinInstanceSetBuffer('matrix', arr, 16) -> THREE.InstancedMesh(geo, mat, count)` + set `instanceMatrix`; `alwaysSelectAsActiveMesh = true -> frustumCulled = false`.
- Screen projection: `Vector3.ProjectToRef(p, ...) -> p.clone().project(camera)` then `x = (ndc.x*0.5+0.5)*w`, `y = (-ndc.y*0.5+0.5)*h`.
- Yaw/facing: `Math.atan2(dx, dz)` for rotation.y -> `headingToYaw(dx, dz)`.

## Rules
- Do NOT change gameplay logic, numbers, timings, or structure - engine types only.
- Keep existing comments (adjust engine references where wrong).
- Never mutate shared/cached materials' colors in place (clone or use per-instance mats).
- Every transient FX mesh: cached material (bounded key) OR ownedMaterial + disposeMesh.
- No em dashes in new text; plain dash.
