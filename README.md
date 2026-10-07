# Mineblock

A Minecraft-style voxel sandbox for the browser. No build step: plain ES modules + Three.js from a CDN, deployable to any static host.

**Status:** playable. Infinite procedural overworld (biomes, water, snow, ice, caves, ores, trees), first-person and top-down cameras, mining and crafting with a full inventory, furnace and netherite chain, Nether portals and the Nether, mobs, baked smooth lighting, day/night, three save slots. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for controls, architecture notes and known limits.

## Run locally

```bash
python3 serve.py 8765
```

Then open <http://localhost:8765/> (the game) or <http://localhost:8765/showcase.html> (design showcase). Any static server works; `serve.py` only disables caching so edits show on reload. ES modules do not load from `file://`, so a server is required.

## Layout

| File | Purpose |
| --- | --- |
| `showcase.html` | Interactive design reference: diorama, Nether, cameras, HUD, inventory, atlas, skins |
| `index.html` + `src/main.js` | Game entry point: boot, title / world list / new world menus |
| `src/game.js` | The game object: renderer, loop, fixed-step physics, panels, dimension switching, pause / death, saving |
| `src/world.js`, `worldgen.js`, `noise.js`, `light.js` | Chunk storage, terrain + Nether generation, seeded noise, sky/block light propagation |
| `src/chunkmesh.js`, `streaming.js`, `sky.js` | Chunk meshing with baked light + AO, chunk streaming, sky / fog / clouds / day-night |
| `src/player.js`, `physics.js`, `input.js`, `view.js` | Player physics and vitals, AABB collision + raycast, input, cameras and held-item view model |
| `src/interact.js`, `entities.js`, `sim.js`, `furnace.js` | Break / place / use, particles + dropped items + falling blocks, world simulation, furnace logic |
| `src/portal.js`, `mobs.js`, `save.js`, `menus.js`, `sfx.js` | Portals and travel, mobs, localStorage saves, menu screens, procedural sounds |
| `src/textures.js` | Procedural 16x16 texture atlas (blocks, items, tools, crack overlay, animated frames) |
| `src/blocks.js` | Block/item registry, tool tiers, recipes, smelting |
| `src/blockmesh.js` | Voxel mesher (face culling, 3 render passes, cross models) |
| `src/characters.js` | Player + mob rigs, procedural 64x64 skins, walk/mine/attack animation, first-person arm |
| `src/ui.css` / `src/ui.js` | HUD, hotbar, hearts, tints, inventory / crafting / furnace panels, tooltips, menus |
| `src/inventory.js` | Inventory model: stacks, click semantics, shaped + shapeless crafting |
| `.github/workflows/pages.yml` | Deploys the folder to GitHub Pages on push to `main` |

## Controls

WASD move · Space jump / swim · Shift sneak · double-tap W sprint · E inventory · F5 first person / top-down · F3 debug · Esc menu · 1-9 hotbar. Full table in [IMPLEMENTATION.md](IMPLEMENTATION.md).

## VR (Meta Quest)

Open the site in the Quest Browser, start a world, then press **ENTER VR**. Left stick moves (where you look), right stick snap-turns (left/right) and changes hotbar slot (up/down), right trigger breaks, right grip places, A jumps, B sneaks. WebXR needs HTTPS or `localhost`. Code: `src/xr.js`.

## Deploy

Push to GitHub, enable **Settings → Pages → Source: GitHub Actions**. Every push to `main` publishes the site. After the first deploy, set `og:image` in `index.html` to the absolute URL of `og.jpg`. Netlify / Vercel / Cloudflare Pages also work with "no build command, publish directory `.`".
