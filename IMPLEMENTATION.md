# Mineblock — Implementation Guide

> ## STATUS: Phases 1–9 implemented (2026-09-30)
> Everything below was built and verified in the browser. The sections after this box are kept as the design reference
> (APIs, algorithms, rationale). Read **Implementation notes** first; it lists where the code differs from the plan.
>
> | Phase | Status | Where |
> |---|---|---|
> | 1 World generation + rendering | done | `noise.js`, `worldgen.js`, `world.js`, `chunkmesh.js`, `streaming.js`, `sky.js` |
> | 2 Player physics + cameras | done | `physics.js`, `player.js`, `input.js`, `view.js` |
> | 3 Block interaction | done | `interact.js`, `entities.js`, `sim.js`, `furnace.js` |
> | 4 Inventory / crafting UX | done | `game.js` (panels, furnace wiring, hover-swap, double-click gather), `menus.js` (creative palette) |
> | 5 Nether + portals | done | `portal.js`, `worldgen.js` (`generateNether`) |
> | 6 Mobs | done | `mobs.js` |
> | 7 Polish | done (see limits) | `sky.js`, `sfx.js`, `entities.js`, `view.js` |
> | 8 Lighting | done | `light.js`, `chunkmesh.js` |
> | 9 Save / load / website | done | `save.js`, `menus.js`, `main.js`, `.github/workflows/pages.yml` |
>
> ### Controls
> | Key | Action |
> |---|---|
> | WASD | move (top-down: world-relative) |
> | Space | jump / swim up / fly up (creative) · double-tap Space toggles flying in creative |
> | Shift | sneak (cannot walk off edges) / fly down |
> | Double-tap W or Ctrl | sprint |
> | Mouse | look (first person) · aim with the cursor (top-down) |
> | Left / right / middle click | break or attack / place, use, open · pick block |
> | 1–9, wheel | hotbar (top-down: wheel zooms) |
> | E | inventory (creative: item palette) · Esc closes panels / opens the pause menu |
> | Q (Ctrl+Q) | drop one (all) |
> | F5 | toggle first person / top-down · F3 debug overlay |
>
> ### Implementation notes (deviations from the plan)
> * **Mesher.** Chunks are meshed by `chunkmesh.js`, not `meshVoxels`. It reads a padded 18x18 cache of ids + light, bakes per-vertex smooth
>   light and ambient occlusion, and outputs `r = sky, g = block, b = shade*AO`. A small `onBeforeCompile` patch on `MeshBasicMaterial`
>   computes `max(sky * uDay, block, uMin) * shade`, so the day/night cycle only changes a uniform (no remesh). `blockmesh.js` is still used
>   for `FACE_VERTS`, `blockGeometry` (held / dropped blocks) and the showcase.
> * **Noise.** `noise.js` is improved Perlin (seeded), not simplex. Caves and the Nether are sampled on a 4-block lattice and interpolated
>   (about 1.4 ms per chunk to generate + light, 2 ms to mesh).
> * **World storage.** `Dimension` keeps chunks in a `Map`; edits live in `dim.stores` (`ckey -> {edits, meta}`) so they survive unloading and
>   are the only thing saved. Both dimensions persist; switching dimension disposes the old chunk meshes.
> * **Portals** render as one double-sided quad in the frame plane (meta 0 = spans X, 1 = spans Z). Sizes 2x3 to 21x21, either axis. Arrival
>   reuses a portal within 128 blocks or builds a 4x5 frame plus obsidian platform. Breaking the frame dissolves the portal.
> * **Top-down camera** hides everything above `player.y + 3` with a global clipping plane (cut-away roof) and aims from the mouse cursor;
>   the ray starts where it crosses the clip plane. Reach is limited to about 6 blocks from the player.
> * **Lighting** is full propagation with incremental updates across chunk borders (`light.js`). Chunks are meshed only once their four
>   neighbours exist, so border faces never need a second pass.
> * **Mobs** use the same AABB physics as the player. Wisps fire slow fireballs (6 damage). Piglins are always hostile (no gold-armour rule).
> * **Food.** `porkchop` / `cooked_porkchop` items were added (pig drop, smeltable) so hunger has a purpose.
> * The game **auto-pauses when the tab is hidden** and on pointer-lock loss.
>
> ### Known limits / ideas for next steps
> * Water and lava are static (no flow, no buckets). TNT is inert. There is no fire block and no armour items (the armour bar is hidden).
> * No third-person camera, no mob saving, no multiplayer, no sounds beyond procedural effects.
> * Placed-block pop-in animation and water-surface vertex waves from Phase 7 were skipped.
> * Only the first 255 block ids fit in `Uint8Array` chunks; switch to `Uint16Array` before adding more blocks.

---

This document is the handoff from the design phase to the implementation phase. The visual layer is **done and verified in the browser** (open `showcase.html`). Your job is to build the game on top of it, in the order below, without redesigning what exists.

Read this whole file once before writing code. Then work phase by phase; each phase ends with a checklist you must verify in the browser (run `python3 serve.py 8765`, open `http://localhost:8765/`).

---

## 0. Ground rules

1. **No build step, no bundler, no npm.** Plain ES modules, Three.js `0.160.0` from unpkg via the import map already in `index.html`. The site must deploy by copying the folder (GitHub Pages workflow is in `.github/workflows/pages.yml`).
2. **Do not modify the look.** `src/textures.js`, `src/ui.css`, the skins in `src/characters.js` and the palette are final. You may *add* tiles/blocks/items to the registries, and you may add CSS classes for new UI, but keep the style (pixel font, bevelled grey panels, 3px UI unit).
3. **Reuse the existing modules exactly as the showcase does.** `showcase.html` is a working reference for: building the atlas, creating materials, meshing voxels, animated water/lava/portal textures, building and animating characters, the first-person arm, HUD updates, the inventory panel, day/night and Nether fog. Copy patterns from it rather than inventing new ones.
4. **One concern per file.** Keep the module layout listed in `src/main.js`. Files over ~600 lines should be split.
5. **Performance budget:** 60 fps on a 2020 laptop with 8-chunk render distance. Never allocate in the render loop (reuse `THREE.Vector3`s), never rebuild a chunk mesh more than once per frame, mesh chunks in a queue (max 2 per frame).
6. **Coordinates:** +y up, 1 block = 1 unit, block `(x,y,z)` occupies `[x,x+1)×[y,y+1)×[z,z+1)`. Characters face **+z** in local space; yaw 0 = facing +z. `Math.floor` for world→block.
7. **Verify in the browser after every phase.** Take the checklist literally. If something in the existing modules is genuinely broken, fix it minimally and note it at the bottom of this file under "Changes to design modules".

---

## 1. What already exists (APIs you will call)

### `src/textures.js`
```js
const atlas = buildAtlas();          // { canvas, tiles, cols, rows, uv(name) }
atlas.uv('grass_top')               // { u0, v0, u1, v1, index, x, y }  (v already flipped for WebGL)
paintTile('diamond_pickaxe')        // 16x16 canvas, for icons
animatedTexture('water')            // { canvas, update(t) -> bool changed }  fps preset per tile
TILE_NAMES, ANIMATED_TILES, C (palette), MATERIALS (tool tiers)
```
Break animation: tiles `destroy_stage_0` … `destroy_stage_9`.

### `src/blocks.js`
```js
BLOCKS[key]      // { id, key, name, faces, solid, transparent, liquid, light, hardness, tool, tier, drops, dropCount, friction, gravity, damage, interact, model, animated, meltsTo }
BLOCK_LIST[id]   // key by numeric id   BLOCK_ID[key] -> id   (store ids in chunk arrays)
faceTile(block, 'top'|'bottom'|'north'|'south'|'east'|'west')
ITEMS[key]       // { name, tile, stack, tool, tier, durability, damage, speed, fuel, use }
itemDef(key), isBlockItem(key), maxStack(key)
RECIPES (shaped), SHAPELESS, SMELTING, TIER, CREATIVE_ORDER
```
Notes: `hardness: -1` = unbreakable. `tier` is the minimum pickaxe tier to get drops (`TIER.wood = 1`). `drops: undefined` = drops itself, `null` = nothing. `friction 0.98` = ice. `gravity: true` = falls like sand. `interact: 'crafting' | 'furnace'`. `model: 'cross'` = torch style.

### `src/blockmesh.js`
```js
const mats = makeAtlasMaterials(THREE, atlas);   // { texture, opaque, cutout, blend }
meshVoxels(THREE, atlas, mats, getBlock, bounds, getLight?, include?) // -> { opaque?, cutout?, blend? } meshes
pushQuad(buf, x, y, z, face, tile, light, inset) / pushCross(...) / bufferToGeometry(THREE, buf) / makeBuffer()
FACE, FACE_NAMES, FACE_DIR, FACE_SHADE, faceVisible(block, neighbour), passFor(block)
blockGeometry(THREE, atlas, key)                 // single textured cube (held item, dropped item)
```
`getBlock(x,y,z)` returns a **key string** (`'air'` outside). `getLight` returns 0..1. `include(key)` lets you split animated blocks into their own meshes (the showcase does exactly this for water/lava/portal/magma with `animatedTexture`).

### `src/characters.js`
```js
const rig = buildCharacter(THREE, 'player' | 'zombie' | 'piglin' | 'pig' | 'wisp');
rig.group      // move/rotate this (origin at feet)
rig.parts      // { head, body, armL, armR, legL, legR } or quadruped/wisp parts
animateCharacter(rig, timeSeconds, { speed 0..1, mining, attack 0..1, headYaw, headPitch, sneaking, inAir });
CHARACTERS[kind] // { height, width, eyeHeight, speed, hostile, hp, damage, dimension, spawnLight, flies }
const fp = buildFirstPersonArm(THREE); camera.add(fp.group); animateArm(fp, t, { mining, swing, speed });
makeSkin(kind)   // 64x64 canvas; a real Minecraft-format skin PNG can replace it for the player
```

### `src/ui.js` + `src/ui.css`
```js
initIcons(atlas);                         // once
const hud = createHUD(uiRoot);            // hud.setHotbar(stacks, sel) .setHealth(hp) .setHunger(n) .setArmor(n) .setXP(f) .setAir(f)
                                          // .showHeldName(name) .setTint('water'|'lava'|'portal'|'hurt', on) .hurt() .toast(msg) .message(msg) .setDebug(text) .toggleDebug()
const invPanel = createInventoryPanel(uiRoot, (section, index, button, shift) => {...});  // .open() .close() .isOpen() .render(inv) .doll
const craftPanel = createCraftingPanel(uiRoot, cb);   // 3x3
const furnacePanel = createFurnacePanel(uiRoot, cb);  // .render(inv, { input, fuel, output, progress, burn })
const menu = createMenu(uiRoot, 'MINEBLOCK', [[label, fn], ...], splashText);
iconFor(key, size), renderSlot(el, stack), showTooltip(x, y, stack), hideTooltip()
```
Sections passed to the callback: `main`, `hotbar`, `armor`, `craft`, `result`, `input`, `fuel`, `output`, `outside`. Buttons: 0 left, 2 right.

### `src/inventory.js`
```js
const inv = new Inventory();   // main[27], hotbar[9], armor[4], craft[4|9], craftResult, cursor, selected
inv.add(item, count) -> leftover;  inv.count(item);  inv.held;  inv.consumeHeld(n);  inv.damageHeld(n) -> broke?
inv.click(section, index, button, shift)   // full Minecraft click semantics + crafting
inv.setCraftSize(4 | 9);  inv.returnCraft();  inv.drop = (stack) => {...}  // set this to spawn dropped items
inv.toJSON() / Inventory.fromJSON(j)
matchRecipe(grid)
```
Stacks are `{ item, count, durability? }` or `null`.

---

## 2. Target architecture

```
main.js        boot → title menu → new/load world → game loop (fixed 60 Hz physics, rAF render)
world.js       Map<"cx,cz", Chunk>; Chunk = { cx, cz, blocks: Uint8Array(16*128*16), light: Uint8Array, dirty, meshes }
               getBlock/setBlock (world coords → chunk), neighbours marked dirty on edge edits
worldgen.js    generateChunk(chunk, dimension, seed)   (pure, no THREE)
chunkmesh.js   remeshChunk(chunk) using meshVoxels with getBlock spanning neighbours; separate animated meshes
player.js      Player { pos, vel, yaw, pitch, onGround, inWater, dimension, hp, air }, cameras, input
interact.js    raycast → target block + face; break progress + crack overlay mesh; place; use item
portal.js      frame validation, ignite, travel, arrival portal creation
mobs.js        spawn/despawn, AI (wander, chase, attack), damage, drops
light.js       (Phase 8) flood-fill sky + block light into chunk.light, used by getLight
save.js        localStorage (or IndexedDB for big worlds): seed, modified blocks per chunk, player, inventory
```

Index into `chunk.blocks`: `(x & 15) + 16 * (z & 15) + 256 * y` with `y` in `0..127`. Chunk key: `` `${cx},${cz}` `` with `cx = x >> 4`.

---

## 3. Phases

### Phase 1 — World generation and rendering
**Goal:** walk-free flythrough of an infinite overworld with biomes, water, snow, ice, caves, ores and trees.

1. `worldgen.js`: implement 2-D/3-D simplex noise (or copy an MIT `SimplexNoise` class — about 100 lines; do not fetch it from the network at runtime). Seeded from `world.seed`.
2. Terrain height: `h = 64 + continent(x,z)*18 + hills(x,z)*8 + detail*2`, where each term is fractal noise (3–4 octaves). Sea level = **62**.
3. Biomes from two low-frequency noises, `temperature` and `humidity`:
   - `temperature < -0.3` → **snow**: surface `snow_grass`, `snow` block on top where `detail > 0.2`, water surface blocks become `ice`.
   - `temperature > 0.5 && humidity < -0.2` → **desert**: `sand` surface 4 deep, no trees, no water freezing.
   - otherwise **plains/forest**: `grass` over `dirt` (3–4 deep) over `stone`; tree density from humidity.
   - Beaches: `sand` where `h` is within 2 of sea level.
   - Below `h`: stone; `y === 0` bedrock; `y in 1..3` bedrock where noise > 0.5.
4. Water: fill air below sea level with `water` (ice in snow biome for the top layer only).
5. Caves: 3-D noise `cave(x, y*1.5, z) > 0.62` carves air for `y < h-4`; do not carve below y=6; skip if it would expose water.
6. Ores (replace stone, blob of 3–8 using a random walk, per chunk):
   | ore | count/chunk | y range |
   |---|---|---|
   | coal | 20 | 5–100 |
   | iron | 16 | 5–60 |
   | gold | 4 | 5–32 |
   | lapis | 3 | 5–30 |
   | redstone | 8 | 5–16 |
   | diamond | 2 | 5–14 |
   | emerald | 1 | 5–30 (only in snow biome) |
   Gravel/dirt pockets: 6 blobs of 8–12 anywhere in stone.
7. Trees: 4–6 log trunk, leaves 5×5×2 then 3×3×1 plus a cap, as in `showcase.html buildOverworld`. Trees may cross chunk borders: generate "decorations" for chunk (cx,cz) only after its 8 neighbours' terrain exists, or clip to the chunk.
8. `chunkmesh.js`: mesh per chunk with `meshVoxels` where `getBlock` reads through `world.getBlock` (so faces at chunk borders are culled correctly); `include` excludes `water`, `lava`, `nether_portal`, `magma`; build those with `animatedTexture` materials as the showcase does (one shared animated material per key, reused across chunks). Position the meshes at chunk origin and mesh in **local** coordinates so the buffers stay small.
9. Streaming: load chunks within `renderDistance` (default 8) around the player, generate in a queue (2 per frame), unload beyond `renderDistance + 2`. Use `requestIdleCallback`-style budgeting (measure with `performance.now()`, stop when a frame budget of 6 ms is spent).
10. Sky: `scene.background` + fog colours from `ENV` in the showcase; day/night cycle 20 minutes (`sun` orbits, fog and ambient lerp). Nether has fixed dark-red fog and no daylight.
11. Fly camera for now (WASD + mouse with pointer lock, Space/Shift up/down).

**Checklist:** ✅ chunks stream in/out without gaps or z-fighting at borders · ✅ water is blended and its top face is lowered by 1/8 · ✅ leaves are cut-out (see through holes) · ✅ snow biome has ice on lakes · ✅ ores appear at the listed depths (dig with F3-style debug "set block" command or fly into caves) · ✅ 60 fps at render distance 8 · ✅ no console errors.

### Phase 2 — Player physics and cameras
1. AABB player 0.6×1.8×0.6, eye at 1.62. Gravity −32 m/s², jump velocity 9 (≈1.25 block jump), walk 4.3 m/s, sprint 5.6 (double-tap W or Ctrl), sneak 1.3 (Shift; cannot walk off edges).
2. Collision: swept AABB per axis (move x, resolve; move y, resolve; move z, resolve) against `solid` blocks. Step-up is **not** needed (Minecraft has none). Terminal velocity −78.
3. Ground friction from the block under the feet: `vel *= friction` where friction is `BLOCKS[b].friction` (0.6 normal, 0.98 ice → slide, 0.4 soul sand + `slow` halves max speed). Air control 0.02.
4. Water (`liquid` blocks): buoyancy — gravity −4, drag `vel *= 0.8`, Space swims up 3 m/s, max horizontal 2.2. Show `hud.setTint('water', true)` when the eye block is water; air meter decreases 1 bubble/second underwater, drowning damage 2 per second at 0. Lava: `hud.setTint('lava')`, 4 damage per 0.5 s, movement 0.5×.
5. Damage: fall damage `max(0, fallDistance - 3)` hearts; magma 1 per second while standing on it; `hud.hurt()` + red tint 0.3 s; death → respawn screen (menu with "Respawn"), keep inventory (no item drop; simpler).
6. Cameras (key **F5** cycles, also a menu option):
   - **First person**: pointer lock, mouse sensitivity 0.002 rad/px, pitch clamped ±89°. Camera at eye, plus head bob `y += |sin(t*9)|*0.03*speed`; FOV 70, 80 while sprinting (lerp 0.1). First-person arm from `buildFirstPersonArm`, `animateArm` every frame; when holding a block show a small `blockGeometry` cube instead of the arm (position `(0.45,-0.42,-0.7)`, rotation `(0.2, -0.6, 0)`), when holding a tool show the tool tile on a plane.
   - **Top-down**: camera `(px, py + 22, pz + 6)` looking at the player, follows with lerp 0.15; the player rig is visible and animated with `animateCharacter`; movement keys are world-relative (W = −z); mouse wheel zooms 12–36 units; left-click still mines the block under the crosshair (crosshair = screen centre) **or** the block under the mouse cursor (use `raycaster.setFromCamera`) — implement the cursor version.
   - Third person over-the-shoulder is optional.
7. Interpolate rendering between physics ticks (`alpha = accumulator / dt`) so motion is smooth at any refresh rate.

**Checklist:** ✅ cannot clip through blocks at any speed · ✅ jump exactly 1 block, not 2 · ✅ sliding on ice, sinking slowly in water, swimming up with Space · ✅ head bob and FOV change feel smooth (no snapping) · ✅ F5 toggles both cameras; top-down keeps the player centred · ✅ fall damage and lava damage shake hearts and tint the screen.

### Phase 3 — Block interaction
1. Raycast: DDA voxel traversal from the eye along the view direction, max 5 blocks (top-down: from camera through cursor, max 40). Return `{ x, y, z, face, prev }` where `prev` is the adjacent air block. Skip `air` and `water`/`lava` unless holding a bucket.
2. Selection outline: `THREE.LineSegments` box (`EdgesGeometry` of a 1.002 cube), black, 2px, positioned at the target.
3. Breaking: hold left mouse. `timeToBreak = hardness * 1.5 / speedMultiplier` seconds where `speedMultiplier = tool.speed` if the held tool type matches `block.tool` (and `tool.tier >= block.tier`), else 1; if the block needs a tier you lack, multiply time by 5 and drop nothing. Show crack overlay: a slightly enlarged cube (1.01) with material `map: atlas texture`, UVs of `destroy_stage_N`, `transparent: true, depthWrite: false`; `N = floor(progress*10)`. Release resets progress. Play `animateArm(..., {mining:true})`.
4. On break: set `air`, spawn 8–12 particles (small planes using the block's tile with random UV sub-rects, gravity, 0.8 s life), spawn a dropped item (rotating `blockGeometry` at 0.25 scale bobbing, magnetised to the player within 1.5 blocks, picked up into `inv.add`). Falling blocks: when the block below `sand`/`gravel` becomes air, replace with a falling entity that lands and re-places.
5. Placing: right-click on `prev`; refuse if it intersects the player AABB or any mob; consume one from `inv.held`; `torch` needs a solid block below or behind; `water` blocks are replaced by placement.
6. Pick block: middle click puts the target block into the hotbar (creative-only later; fine to allow always).
7. Interaction: right-click on `crafting_table` opens the 3×3 panel (`inv.setCraftSize(9)`), on `furnace` opens the furnace panel. Furnace state per position in `world.tileEntities` map: `{ input, fuel, output, progress, burn, burnMax }`; ticks 1/s even when closed: fuel value from `ITEMS[x].fuel` (coal 80 s, planks/log 15 s, blaze_rod 120 s); `SMELTING[input]` result after 10 s. Swap `furnace`↔`furnace_lit` blocks when burning. Furnace front (`north` face) should face the player when placed: store rotation in `world.meta` and choose face tiles accordingly (extend `faceTile` with a rotation param).
8. Hotbar: keys 1–9, mouse wheel, `hud.showHeldName`. `E` opens inventory (release pointer lock, `inv.setCraftSize(4)`), `Esc` closes; `Q` drops one held item.
9. Melting: an `ice` block within 3 blocks of a light ≥ 11 source (torch, lava, glowstone) turns into `water` after 10 s (random tick: check 3 random blocks per chunk per second). Snow on top of blocks melts the same way (becomes air).

**Checklist:** ✅ crack overlay animates through 10 stages and resets on release · ✅ diamond ore breaks only with iron+ pickaxe and drops a diamond · ✅ particles and dropped items · ✅ cannot place a block inside yourself · ✅ crafting table 3×3 makes a pickaxe from 3 planks + 2 sticks · ✅ furnace smelts iron ore with coal, shows fire + arrow progress · ✅ torch lights up nearby blocks visually (Phase 8 makes it exact; until then use `block.light` to brighten faces within 6 blocks by distance falloff in `getLight`).

### Phase 4 — Inventory and crafting UX
Most of the logic is in `inventory.js` and the panels are built. You need to:
1. Wire `createInventoryPanel`, `createCraftingPanel`, `createFurnacePanel` callbacks to `inv.click`, then `panel.render(inv)` and `hud.setHotbar` after every click.
2. Paper doll: render the player rig into the `invPanel.doll` element with a second `WebGLRenderer` (copy from the showcase) and make the head follow the mouse (`headYaw = (mouseX - dollCenterX) / 300`).
3. `inv.drop = (stack) => spawnDroppedItem(...)` in front of the player.
4. Number keys while hovering a slot move that stack into that hotbar slot (swap). Double-click gathers a stack. These are polish; do them last.
5. Creative mode (toggle in pause menu for testing): an extra tab that lists `CREATIVE_ORDER` blocks and all `ITEMS`; clicking gives a stack.
6. Save inventory in the world save.

**Checklist:** ✅ left/right/shift click behave as in Minecraft · ✅ result slot crafts with shift-click for all · ✅ tooltips show tier/durability · ✅ tools lose durability on use and break (`inv.damageHeld`) · ✅ hotbar mirrors inventory instantly.

### Phase 5 — The Nether and portals
1. **Dimension model:** `world` holds `{ overworld: ChunkMap, nether: ChunkMap }`; `player.dimension` selects which one renders and collides. Keep both loaded only around their portal positions; otherwise unload.
2. **Nether generation** (`worldgen.generateNether`): height 0–127. Bedrock at y=0 and y=127. 3-D noise `n(x, y, z) > 0.1` = `netherrack`, else air, for `y` in 5–120; lava ocean fills air below **y=31**; `soul_sand` patches where a 2-D noise > 0.55 on surfaces; `glowstone` clusters hanging under ceilings (5–9 blocks, where the block above is netherrack and the one below is air, 1 cluster per 3 chunks); `nether_quartz_ore` 12 blobs/chunk, `nether_gold_ore` 8 blobs/chunk, `ancient_debris` 1–2 single blocks/chunk at y 8–22 fully enclosed; `magma` patches at the lava shore; `nether_bricks` ruins: 1 in 40 chunks, a hollow 7×5×7 box like `buildNether` in the showcase. Fog: `ENV.nether`. No sky light: `getLight` returns ambient 0.35 + block light.
3. **Portal frame:** obsidian rectangle 4 wide × 5 tall (interior 2×3), in the X-Z or Z-X plane; corners optional. Validation (`portal.js validateFrame(x,y,z)`): from the clicked interior air block flood-fill air within a 2×3 region, verify every neighbour outside the region (in-plane) is obsidian. Support interior sizes from 2×3 up to 21×21 if easy; 2×3 is required.
4. **Ignition:** right-click with `flint_and_steel` on obsidian (or inside a frame) → validate → fill interior with `nether_portal` blocks (store the portal's axis in `world.meta` so the portal quads render in the frame's plane — render `nether_portal` as two thin quads at 0.375–0.625 in the plane, double-sided, using `pushQuad` with custom positions; the showcase renders it as a full cube, which is acceptable for v1). Play the portal tint briefly. Lava next to a frame does not ignite it (keep simple).
5. **Travel:** when the player AABB overlaps a portal block for 4 continuous seconds (`hud.setTint('portal', true)` and wobble the camera FOV ±3° meanwhile; creative: instant), switch dimension: target coords = overworld `(x/8, y, z/8)` → nether, nether `(x*8, y, z*8)` → overworld. Search for an existing portal within 128 blocks (list in `world.portals[dimension]`); otherwise **build** one: find the nearest solid ground column near the target with 5×4 space, place an obsidian frame + portal blocks + a 3-block obsidian floor platform, register it. Put the player in front of it, keep velocity 0, 10-second cooldown before re-entry. Show `hud.toast('Entering the Nether')`.
6. **Fire/heat:** standing in lava as Phase 2. Water placed in the Nether evaporates (becomes air with a hiss: spawn 5 white particles).
7. **Netherite:** `ancient_debris` smelts to `netherite_scrap`; 4 scrap + 4 gold ingots (shapeless, any slots) → `netherite_ingot`; diamond tool + ingot → netherite tool. All recipes exist in `blocks.js`.
8. Mobs in the Nether: `piglin` (hostile unless the player wears gold armour — optional), `wisp` (flies, shoots slow fireballs that do 6 damage and set `magma` on impact — fireball = glowing sphere, optional).

**Checklist:** ✅ ignite a 4×5 obsidian frame with flint and steel → animated purple portal · ✅ standing in it 4 s teleports to the Nether at 1/8 coordinates, a portal exists on the other side, going back returns to the original portal · ✅ Nether has lava ocean, glowstone ceilings, soul sand slow-down, ancient debris deep inside netherrack · ✅ red fog, no day/night in the Nether · ✅ netherite pickaxe can be crafted end-to-end.

### Phase 6 — Mobs
1. Spawning: every 2 s attempt 4 spawns per loaded chunk ring (24–48 blocks from the player) on solid ground in air with 2 free blocks above. Overworld: `pig` in light (day, on grass), `zombie` in darkness (night or caves, light < 0.3). Nether: `piglin` on netherrack, `wisp` in open air spaces ≥ 5 blocks tall. Cap 20 mobs total, despawn beyond 64 blocks.
2. Movement: same physics as the player (reuse `player.js` step function on an AABB of `CHARACTERS[kind].width/height`); `flies` → no gravity, lerp toward target height. Wander: pick a random point within 8 blocks every 3–6 s, walk toward it, jump when blocked (`onGround && blocked` → jump). Hostile: if the player is within 16 blocks and visible (raycast), chase at `speed`; attack when within 1.5 blocks every 1 s for `damage`; knock the player back 0.4.
3. Animation: `animateCharacter(rig, t, { speed: horizontalSpeed / maxSpeed, attack: attackProgress, headYaw: angleToTarget })`, yaw lerps toward the velocity direction (`rig.group.rotation.y`).
4. Damage: left-click a mob within 3 blocks (raycast against mob AABBs before blocks) for `held.damage || 1`; flash the rig red (`material.color.set(0xff6060)` for 0.15 s), knockback, death after `hp <= 0`: rig tips over (`rotation.z → π/2` over 0.5 s) then despawns, drops (`pig` → 1–3 `porkchop`: add item; `zombie` → nothing; `piglin` → 1 `gold_ingot`; `wisp` → 1 `blaze_rod`).
5. Hunger (optional): `hud.setHunger`, decreases 1 per 80 s, sprinting faster; eating porkchop restores 8; at 0 no sprint.

**Checklist:** ✅ pigs wander in daylight, zombies appear at night and chase · ✅ mobs never sink into or clip through blocks · ✅ hitting flashes and knocks back, killing drops items · ✅ mobs animate with walk cycle proportional to speed.

### Phase 7 — Polish: "clean and smooth" animation
1. Fixed-step physics (60 Hz) with render interpolation; camera always uses interpolated position.
2. Camera: smooth pitch/yaw (no smoothing in first person — raw input is what feels right; smooth only the top-down follow and FOV).
3. Block place/break: 0.1 s arm swing (`animateArm swing`); placed block scales from 0.85 → 1 over 80 ms (use a temporary mesh, then remesh the chunk).
4. Water surface UV scroll (already animated by frames) + slight vertex wave on the top face (optional).
5. Day/night: sun/moon sprites (two planes with radial gradient canvas textures) orbiting, fog and sky colour lerp; stars (Points) fade in at night.
6. Torch flame particle every 0.3 s; portal spawns purple particles drifting inward.
7. Clouds: a 2-D noise texture on a huge plane at y=128 scrolling slowly (overworld only).
8. Screen shake 0.2 s on damage; heart shake already in CSS.
9. Sounds (optional, no assets): use WebAudio oscillators/noise for dig, place, hurt, portal hum, water splash.

### Phase 8 — Lighting (recommended, improves the look a lot)
1. Per chunk `light: Uint8Array` with two nibbles: sky (0–15) and block (0–15).
2. Sky light: column propagation from y=127 downward, 15 until the first `solid && !transparent` block, then flood-fill decreasing by 1 through air/transparent blocks. Block light: BFS from each emitter (`block.light`) decreasing by 1. Re-propagate on `setBlock` locally (BFS removal + add). Cross-chunk: run on the 3×3 neighbourhood after neighbours generate.
3. `getLight(x,y,z) = max(sky * dayFactor, block) / 15` smoothed with the "ambient occlusion" trick: average the light of the 4 blocks touching each vertex (needs per-vertex light → extend `pushQuad` to accept 4 light values; keep the default path working).
4. Night should be dark but readable (min 0.15). The Nether: sky light 0 everywhere, ambient 0.35.

### Phase 9 — Save / load and website
1. `save.js`: `localStorage['mineblock:<slot>']` = `{ seed, player, inventory, dimension, portals, time, chunks: { "cx,cz": [[index, id], ...] } }` storing **only edited blocks** (delta vs generation). Autosave every 30 s and on `beforeunload`. Three slots on the title screen with "Delete" (confirm).
2. Title screen: "Singleplayer" → world list; "New World" asks for a name and seed (random default); "Design Showcase" link stays.
3. Pause menu (Esc): Back to game, Camera mode, Render distance (4/8/12), Creative toggle, Save & quit.
4. Mobile: the `.touch` pad in `index.html` shows on coarse pointers; map buttons to key events, touch-drag on the right half of the screen looks around, tap = place, long-press = break.
5. Deploy: push to GitHub, enable Pages (Actions source). Verify `https://<user>.github.io/<repo>/` loads with no console errors and the showcase link works. Add a `<meta property="og:image">` screenshot.

---

## 4. Algorithms you may need (reference implementations)

**DDA raycast**
```js
function raycast(getBlock, origin, dir, maxDist, hits = (b) => BLOCKS[b].solid || b === 'nether_portal') {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = Math.abs(1 / dir.x), tDeltaY = Math.abs(1 / dir.y), tDeltaZ = Math.abs(1 / dir.z);
  let tMaxX = dir.x > 0 ? (x + 1 - origin.x) * tDeltaX : (origin.x - x) * tDeltaX;
  let tMaxY = dir.y > 0 ? (y + 1 - origin.y) * tDeltaY : (origin.y - y) * tDeltaY;
  let tMaxZ = dir.z > 0 ? (z + 1 - origin.z) * tDeltaZ : (origin.z - z) * tDeltaZ;
  let face = null, t = 0;
  while (t <= maxDist) {
    const b = getBlock(x, y, z);
    if (b !== 'air' && hits(b)) return { x, y, z, face, block: b, t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = stepX > 0 ? 'west' : 'east'; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = stepY > 0 ? 'bottom' : 'top'; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 'north' : 'south'; }
  }
  return null;
}
```
`prev` (placement position) = hit position moved one block along `FACE_DIR[FACE[face]]`.

**Axis-separated AABB collision**
```js
function moveAxis(box, axis, amount, isSolid) {
  // box: {min:[x,y,z], max:[x,y,z]}; returns actual movement and whether blocked
  if (amount === 0) return { moved: 0, blocked: false };
  const min = [...box.min], max = [...box.max];
  min[axis] += amount; max[axis] += amount;
  const lo = min.map(Math.floor), hi = max.map((v) => Math.ceil(v) - 1);
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    if (!isSolid(x, y, z)) continue;
    const blockMin = [x, y, z][axis], blockMax = blockMin + 1;
    const clamped = amount > 0 ? blockMin - box.max[axis] - 1e-4 : blockMax - box.min[axis] + 1e-4;
    return { moved: clamped, blocked: true };
  }
  return { moved: amount, blocked: false };
}
```
Apply y first when falling (so landing is detected before sliding), then x, then z.

**Portal frame validation (2×3 interior, either axis)**
```js
function findPortalFrame(getBlock, x, y, z) {
  for (const axis of ['x', 'z']) {
    const dx = axis === 'x' ? 1 : 0, dz = axis === 'x' ? 0 : 1;
    // slide to the bottom-left interior corner
    let x0 = x, z0 = z, y0 = y;
    while (getBlock(x0 - dx, y0, z0 - dz) === 'air' || getBlock(x0 - dx, y0, z0 - dz) === 'nether_portal') { x0 -= dx; z0 -= dz; }
    while (getBlock(x0, y0 - 1, z0) === 'air' || getBlock(x0, y0 - 1, z0) === 'nether_portal') y0--;
    const W = 2, H = 3; let ok = true;
    for (let i = -1; i <= W && ok; i++) for (let j = -1; j <= H && ok; j++) {
      const bx = x0 + i * dx, bz = z0 + i * dz, by = y0 + j;
      const inside = i >= 0 && i < W && j >= 0 && j < H, corner = (i === -1 || i === W) && (j === -1 || j === H);
      const b = getBlock(bx, by, bz);
      if (inside) ok = b === 'air' || b === 'nether_portal';
      else if (!corner) ok = b === 'obsidian';
    }
    if (ok) return { x0, y0, z0, axis, w: W, h: H };
  }
  return null;
}
```

**Simplex noise**: implement 2-D and 3-D simplex noise from the standard Stefan Gustavson reference (public domain) as `class SimplexNoise { constructor(seed) noise2D(x,y) noise3D(x,y,z) }` plus `fbm(fn, x, y, octaves, lacunarity=2, gain=0.5)`.

---

## 5. Conventions and pitfalls

- **Meshing at chunk borders:** always read neighbours through `world.getBlock`; if a neighbour chunk is not generated yet, treat it as `stone` (not air) to avoid a wall of faces that later needs remeshing, then mark the chunk dirty when the neighbour arrives.
- **Never mesh `air`/`water` faces against the same block**: `faceVisible` already handles it.
- **Animated materials** are shared: make one `animatedTexture` + material per animated key at startup (like the showcase) and give every chunk's animated mesh that material; call `update(t)` once per frame and set `texture.needsUpdate = true` only when it returns `true`.
- **`vertexColors: true` materials need the `color` attribute**; `bufferToGeometry` sets it. If you write your own geometry, keep the attribute.
- **Pointer lock** must be requested from a user gesture (click on the canvas). Release it when any panel opens; re-request on close.
- **Do not put `position.y` bobbing on `rig.group`** — the animation bobs `rig.root`. Move `rig.group` only.
- **Chunk arrays store `BLOCK_ID[key]`** (Uint8, max 255 blocks). Convert to keys only at the API boundary (`world.getBlock` returns a key so it plugs into `meshVoxels`); for hot loops, use ids and `BLOCK_LIST[id]`.
- **Time**: use `performance.now()/1000` for animation `t`; use the fixed-step accumulator for physics.
- **Testing without a game**: `showcase.html` remains the fastest place to verify visual changes; keep it working (it must not import from game-only modules).
- Textures are sRGB canvases; keep `renderer.outputColorSpace = THREE.SRGBColorSpace` and `texture.colorSpace = THREE.SRGBColorSpace` (already done in the helpers) or everything looks washed out.

---

## 6. Definition of done

- `index.html` starts a playable survival game: generate world → mine → craft tools → build a house → find diamonds → build and ignite a portal → visit the Nether → mine ancient debris → craft netherite tools.
- Both camera modes work throughout, including in the Nether.
- Water, snow, ice interactions as specified (swim, slide, freeze/melt).
- Inventory, crafting table, furnace fully functional; saves survive reload.
- Deployed at a public URL from the GitHub Pages workflow with zero console errors on load.
- `showcase.html` still works and matches the game's look.

## Changes to design modules
(Record anything you had to change in `textures.js`, `blocks.js`, `blockmesh.js`, `characters.js`, `ui.js`, `ui.css`, `inventory.js`, with a one-line reason.)

- `textures.js`: `cobblestone` painter wrapped as `(px, r) => cobble(px, r)`. It was registered directly, so the animation-frame argument was used as the base colour and the tile rendered black. Added `porkchop` and `cooked_porkchop` tiles.
- `blocks.js`: added `porkchop`, `cooked_porkchop` (`food`) and `fuel: 120` on `blaze_rod`.
- `blockmesh.js`: exported `FACE_VERTS` (used by the new chunk mesher).
- `ui.css`: appended menu / creative-palette / loading styles; lowered the underwater tint opacity (fog does most of the work now).
- `index.html`: social meta tags, favicon. `src/main.js` replaced the shell with the real boot + menu flow.
- `characters.js`, `ui.js`, `inventory.js`: unchanged.
