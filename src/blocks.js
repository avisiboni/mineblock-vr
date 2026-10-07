// ============================================================================
// Mineblock — block & item registry
// ----------------------------------------------------------------------------
// Single source of truth for every block and item. Chunk meshing, mining,
// inventory and crafting all read from here.
//
//   BLOCKS[name]        block definition
//   BLOCK_LIST[id]      block by numeric id (used inside chunk arrays)
//   faceTile(block, face)  atlas tile name for 'top'|'bottom'|'north'|'south'|'east'|'west'
//   ITEMS[name]         non-block items (tools, ingots, ...)
//   RECIPES             crafting recipes (shaped, 3x3 grid strings)
// ============================================================================

// Tool tiers: which pickaxe can harvest a block.
export const TIER = { hand: 0, wood: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 };

// hardness: seconds to break by hand (roughly Minecraft's values)
// tool: preferred tool type ('pickaxe' | 'shovel' | 'axe' | null)
// tier: minimum pickaxe tier needed for drops (0 = any)
// drops: item/block name dropped (null = nothing, undefined = itself)
// solid: blocks movement, occludes neighbouring faces
// transparent: rendered in the transparent pass, does not occlude neighbours
// liquid: swimmable, no collision, slows movement
// light: emitted light level 0..15
// friction: 0.6 default ground friction; ice 0.98 (slippery)
const def = (o) => Object.assign({ solid: true, transparent: false, liquid: false, light: 0, hardness: 1, tool: null, tier: 0, friction: 0.6 }, o);

export const BLOCKS = {
  air:          def({ name: 'Air', faces: null, solid: false, transparent: true, hardness: 0 }),
  // ---- overworld ----
  stone:        def({ name: 'Stone', faces: 'stone', hardness: 1.5, tool: 'pickaxe', tier: 1, drops: 'cobblestone' }),
  cobblestone:  def({ name: 'Cobblestone', faces: 'cobblestone', hardness: 2, tool: 'pickaxe', tier: 1 }),
  dirt:         def({ name: 'Dirt', faces: 'dirt', hardness: 0.5, tool: 'shovel' }),
  grass:        def({ name: 'Grass Block', faces: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', drops: 'dirt' }),
  snow_grass:   def({ name: 'Snowy Grass', faces: { top: 'snow', bottom: 'dirt', side: 'snow_grass_side' }, hardness: 0.6, tool: 'shovel', drops: 'dirt' }),
  snow:         def({ name: 'Snow Block', faces: 'snow', hardness: 0.2, tool: 'shovel', drops: 'snowball' }),
  sand:         def({ name: 'Sand', faces: 'sand', hardness: 0.5, tool: 'shovel', gravity: true }),
  gravel:       def({ name: 'Gravel', faces: 'gravel', hardness: 0.6, tool: 'shovel', gravity: true }),
  bedrock:      def({ name: 'Bedrock', faces: 'bedrock', hardness: -1 }),
  oak_log:      def({ name: 'Oak Log', faces: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log_side' }, hardness: 2, tool: 'axe' }),
  oak_planks:   def({ name: 'Oak Planks', faces: 'oak_planks', hardness: 2, tool: 'axe' }),
  oak_leaves:   def({ name: 'Oak Leaves', faces: 'oak_leaves', hardness: 0.2, transparent: true, drops: null }),
  water:        def({ name: 'Water', faces: 'water', solid: false, transparent: true, liquid: true, hardness: 100, drops: null, animated: true }),
  ice:          def({ name: 'Ice', faces: 'ice', hardness: 0.5, tool: 'pickaxe', transparent: true, friction: 0.98, drops: null, meltsTo: 'water' }),
  glass:        def({ name: 'Glass', faces: 'glass', hardness: 0.3, transparent: true, drops: null }),
  // ---- ores ----
  coal_ore:     def({ name: 'Coal Ore', faces: 'coal_ore', hardness: 3, tool: 'pickaxe', tier: 1, drops: 'coal' }),
  iron_ore:     def({ name: 'Iron Ore', faces: 'iron_ore', hardness: 3, tool: 'pickaxe', tier: 2 }),
  gold_ore:     def({ name: 'Gold Ore', faces: 'gold_ore', hardness: 3, tool: 'pickaxe', tier: 3 }),
  lapis_ore:    def({ name: 'Lapis Lazuli Ore', faces: 'lapis_ore', hardness: 3, tool: 'pickaxe', tier: 2, drops: 'lapis_lazuli', dropCount: [4, 9] }),
  redstone_ore: def({ name: 'Redstone Ore', faces: 'redstone_ore', hardness: 3, tool: 'pickaxe', tier: 3, drops: 'redstone_dust', dropCount: [4, 5] }),
  diamond_ore:  def({ name: 'Diamond Ore', faces: 'diamond_ore', hardness: 3, tool: 'pickaxe', tier: 3, drops: 'diamond' }),
  emerald_ore:  def({ name: 'Emerald Ore', faces: 'emerald_ore', hardness: 3, tool: 'pickaxe', tier: 3, drops: 'emerald' }),
  // ---- mineral blocks ----
  coal_block:      def({ name: 'Block of Coal', faces: 'coal_block', hardness: 5, tool: 'pickaxe', tier: 1 }),
  iron_block:      def({ name: 'Block of Iron', faces: 'iron_block', hardness: 5, tool: 'pickaxe', tier: 2 }),
  gold_block:      def({ name: 'Block of Gold', faces: 'gold_block', hardness: 3, tool: 'pickaxe', tier: 3 }),
  lapis_block:     def({ name: 'Block of Lapis Lazuli', faces: 'lapis_block', hardness: 3, tool: 'pickaxe', tier: 2 }),
  diamond_block:   def({ name: 'Block of Diamond', faces: 'diamond_block', hardness: 5, tool: 'pickaxe', tier: 3 }),
  emerald_block:   def({ name: 'Block of Emerald', faces: 'emerald_block', hardness: 5, tool: 'pickaxe', tier: 3 }),
  netherite_block: def({ name: 'Block of Netherite', faces: 'netherite_block', hardness: 50, tool: 'pickaxe', tier: 4 }),
  // ---- nether ----
  netherrack:     def({ name: 'Netherrack', faces: 'netherrack', hardness: 0.4, tool: 'pickaxe', tier: 1 }),
  soul_sand:      def({ name: 'Soul Sand', faces: 'soul_sand', hardness: 0.5, tool: 'shovel', friction: 0.4, slow: true }),
  glowstone:      def({ name: 'Glowstone', faces: 'glowstone', hardness: 0.3, light: 15 }),
  nether_bricks:  def({ name: 'Nether Bricks', faces: 'nether_bricks', hardness: 2, tool: 'pickaxe', tier: 1 }),
  magma:          def({ name: 'Magma Block', faces: 'magma', hardness: 0.5, tool: 'pickaxe', tier: 1, light: 3, damage: 1, animated: true }),
  nether_quartz_ore: def({ name: 'Nether Quartz Ore', faces: 'nether_quartz_ore', hardness: 3, tool: 'pickaxe', tier: 1, drops: 'quartz' }),
  nether_gold_ore:   def({ name: 'Nether Gold Ore', faces: 'nether_gold_ore', hardness: 3, tool: 'pickaxe', tier: 1, drops: 'gold_ingot' }),
  ancient_debris: def({ name: 'Ancient Debris', faces: { top: 'ancient_debris_top', bottom: 'ancient_debris_top', side: 'ancient_debris_side' }, hardness: 30, tool: 'pickaxe', tier: 4 }),
  lava:           def({ name: 'Lava', faces: 'lava', solid: false, transparent: false, liquid: true, light: 15, hardness: 100, drops: null, damage: 4, animated: true }),
  obsidian:       def({ name: 'Obsidian', faces: 'obsidian', hardness: 50, tool: 'pickaxe', tier: 4 }),
  nether_portal:  def({ name: 'Nether Portal', faces: 'nether_portal', solid: false, transparent: true, light: 11, hardness: -1, drops: null, animated: true }),
  // ---- utility ----
  crafting_table: def({ name: 'Crafting Table', faces: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', north: 'crafting_table_front' }, hardness: 2.5, tool: 'axe', interact: 'crafting' }),
  furnace:        def({ name: 'Furnace', faces: { top: 'cobblestone', bottom: 'cobblestone', side: 'cobblestone', north: 'furnace_front' }, hardness: 3.5, tool: 'pickaxe', tier: 1, interact: 'furnace' }),
  furnace_lit:    def({ name: 'Furnace', faces: { top: 'cobblestone', bottom: 'cobblestone', side: 'cobblestone', north: 'furnace_front_lit' }, hardness: 3.5, tool: 'pickaxe', tier: 1, light: 13, drops: 'furnace', interact: 'furnace', animated: true }),
  torch:          def({ name: 'Torch', faces: 'torch', solid: false, transparent: true, light: 14, hardness: 0, model: 'cross' }),
  tnt:            def({ name: 'TNT', faces: 'tnt', hardness: 0 }),
  bookshelf:      def({ name: 'Bookshelf', faces: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe' }),
};

export const BLOCK_LIST = Object.keys(BLOCKS);
BLOCK_LIST.forEach((key, id) => { BLOCKS[key].id = id; BLOCKS[key].key = key; });
export const BLOCK_ID = Object.fromEntries(BLOCK_LIST.map((k, i) => [k, i]));

// Returns the atlas tile name for one face of a block.
export function faceTile(block, face) {
  const f = block.faces;
  if (!f) return null;
  if (typeof f === 'string') return f;
  return f[face] || (face === 'top' || face === 'bottom' ? f[face] || f.side : f.side);
}
export const FACES = ['top', 'bottom', 'north', 'south', 'east', 'west'];

// ------------------------------------------------------------------ items
// stack: max stack size. tool: type. tier. durability. damage (attack).
const item = (o) => Object.assign({ stack: 64 }, o);
const toolset = (mat, tier, durability, dmg) => ({
  [`${mat}_pickaxe`]: item({ name: cap(mat) + ' Pickaxe', tool: 'pickaxe', tier, durability, damage: dmg, stack: 1, tile: `${mat}_pickaxe`, speed: [2, 4, 6, 8, 9][tier - 1] }),
  [`${mat}_axe`]:     item({ name: cap(mat) + ' Axe', tool: 'axe', tier, durability, damage: dmg + 2, stack: 1, tile: `${mat}_axe`, speed: [2, 4, 6, 8, 9][tier - 1] }),
  [`${mat}_shovel`]:  item({ name: cap(mat) + ' Shovel', tool: 'shovel', tier, durability, damage: dmg - 1, stack: 1, tile: `${mat}_shovel`, speed: [2, 4, 6, 8, 9][tier - 1] }),
  [`${mat}_sword`]:   item({ name: cap(mat) + ' Sword', tool: 'sword', tier, durability, damage: dmg + 1, stack: 1, tile: `${mat}_sword` }),
});
function cap(s) { return s[0].toUpperCase() + s.slice(1); }

export const ITEMS = {
  stick: item({ name: 'Stick', tile: 'stick' }),
  coal: item({ name: 'Coal', tile: 'coal', fuel: 80 }),
  iron_ingot: item({ name: 'Iron Ingot', tile: 'iron_ingot' }),
  gold_ingot: item({ name: 'Gold Ingot', tile: 'gold_ingot' }),
  diamond: item({ name: 'Diamond', tile: 'diamond' }),
  emerald: item({ name: 'Emerald', tile: 'emerald' }),
  lapis_lazuli: item({ name: 'Lapis Lazuli', tile: 'lapis_lazuli' }),
  redstone_dust: item({ name: 'Redstone Dust', tile: 'redstone_dust' }),
  quartz: item({ name: 'Nether Quartz', tile: 'quartz' }),
  netherite_scrap: item({ name: 'Netherite Scrap', tile: 'netherite_scrap' }),
  netherite_ingot: item({ name: 'Netherite Ingot', tile: 'netherite_ingot' }),
  flint_and_steel: item({ name: 'Flint and Steel', tile: 'flint_and_steel', stack: 1, durability: 64, use: 'ignite' }),
  blaze_rod: item({ name: 'Blaze Rod', tile: 'blaze_rod', fuel: 120 }),
  porkchop: item({ name: 'Raw Porkchop', tile: 'porkchop', food: 3 }),
  cooked_porkchop: item({ name: 'Cooked Porkchop', tile: 'cooked_porkchop', food: 8 }),
  snowball: item({ name: 'Snowball', tile: 'snowball', stack: 16, throwable: true }),
  ...toolset('wood', 1, 59, 2),
  ...toolset('stone', 2, 131, 3),
  ...toolset('iron', 3, 250, 4),
  ...toolset('gold', 2, 32, 2),
  ...toolset('diamond', 4, 1561, 5),
  ...toolset('netherite', 5, 2031, 6),
};
// Gold digs fast but is weak
Object.keys(ITEMS).filter((k) => k.startsWith('gold_') && ITEMS[k].tool).forEach((k) => (ITEMS[k].speed = 12));
Object.keys(ITEMS).forEach((k) => (ITEMS[k].key = k));

// Any inventory entry is a "stack": { item: 'stone' | 'iron_pickaxe', count, durability? }
export function isBlockItem(key) { return key in BLOCKS; }
export function itemDef(key) { return BLOCKS[key] || ITEMS[key]; }
export function maxStack(key) { return isBlockItem(key) ? 64 : (ITEMS[key]?.stack ?? 64); }

// ---------------------------------------------------------------- recipes
// Shaped recipes: pattern rows (up to 3x3), key letters -> item, result {item,count}.
// 2x2 crafting (inventory) only accepts recipes whose pattern fits in 2x2.
export const RECIPES = [
  { pattern: ['L'], key: { L: 'oak_log' }, result: { item: 'oak_planks', count: 4 } },
  { pattern: ['P', 'P'], key: { P: 'oak_planks' }, result: { item: 'stick', count: 4 } },
  { pattern: ['PP', 'PP'], key: { P: 'oak_planks' }, result: { item: 'crafting_table', count: 1 } },
  { pattern: ['C', 'S'], key: { C: 'coal', S: 'stick' }, result: { item: 'torch', count: 4 } },
  { pattern: ['CCC', 'C C', 'CCC'], key: { C: 'cobblestone' }, result: { item: 'furnace', count: 1 } },
  { pattern: ['SSS', 'SSS', 'SSS'], key: { S: 'snowball' }, result: { item: 'snow', count: 1 } },
  { pattern: ['I', 'F'], key: { I: 'iron_ingot', F: 'gravel' }, result: { item: 'flint_and_steel', count: 1 } },
  { pattern: ['NNN', 'NNN', 'NNN'], key: { N: 'netherite_ingot' }, result: { item: 'netherite_block', count: 1 } },
  { pattern: ['PPP', 'BBB', 'PPP'], key: { P: 'oak_planks', B: 'oak_planks' }, result: { item: 'bookshelf', count: 1 } },
  ...['iron_ingot', 'gold_ingot', 'diamond', 'lapis_lazuli', 'emerald', 'coal'].map((m) => ({
    pattern: ['MMM', 'MMM', 'MMM'], key: { M: m },
    result: { item: m.replace('_ingot', '').replace('lapis_lazuli', 'lapis') + '_block', count: 1 },
  })),
  ...[['wood', 'oak_planks'], ['stone', 'cobblestone'], ['iron', 'iron_ingot'], ['gold', 'gold_ingot'], ['diamond', 'diamond']].flatMap(([mat, m]) => [
    { pattern: ['MMM', ' S ', ' S '], key: { M: m, S: 'stick' }, result: { item: `${mat}_pickaxe`, count: 1 } },
    { pattern: ['MM ', 'MS ', ' S '], key: { M: m, S: 'stick' }, result: { item: `${mat}_axe`, count: 1 } },
    { pattern: ['M', 'S', 'S'], key: { M: m, S: 'stick' }, result: { item: `${mat}_shovel`, count: 1 } },
    { pattern: ['M', 'M', 'S'], key: { M: m, S: 'stick' }, result: { item: `${mat}_sword`, count: 1 } },
  ]),
];

// Smelting: input -> output (furnace). Fuel: coal (80s), planks (15s), log (15s), blaze_rod (120s).
export const SMELTING = {
  iron_ore: 'iron_ingot', gold_ore: 'gold_ingot', nether_gold_ore: 'gold_ingot',
  ancient_debris: 'netherite_scrap', cobblestone: 'stone', sand: 'glass',
};
// Netherite upgrade: 4 scrap + 4 gold ingots (shapeless) -> netherite ingot
export const SHAPELESS = [
  { inputs: { netherite_scrap: 4, gold_ingot: 4 }, result: { item: 'netherite_ingot', count: 1 } },
  { inputs: { diamond_pickaxe: 1, netherite_ingot: 1 }, result: { item: 'netherite_pickaxe', count: 1 } },
  { inputs: { diamond_axe: 1, netherite_ingot: 1 }, result: { item: 'netherite_axe', count: 1 } },
  { inputs: { diamond_shovel: 1, netherite_ingot: 1 }, result: { item: 'netherite_shovel', count: 1 } },
  { inputs: { diamond_sword: 1, netherite_ingot: 1 }, result: { item: 'netherite_sword', count: 1 } },
];

// Creative / showcase palette order (also the default creative inventory order).
export const CREATIVE_ORDER = [
  'grass', 'dirt', 'stone', 'cobblestone', 'sand', 'gravel', 'snow', 'snow_grass', 'ice', 'water', 'glass',
  'oak_log', 'oak_planks', 'oak_leaves', 'crafting_table', 'furnace', 'torch', 'bookshelf', 'tnt',
  'coal_ore', 'iron_ore', 'gold_ore', 'lapis_ore', 'redstone_ore', 'diamond_ore', 'emerald_ore',
  'coal_block', 'iron_block', 'gold_block', 'lapis_block', 'diamond_block', 'emerald_block', 'netherite_block',
  'netherrack', 'soul_sand', 'glowstone', 'nether_bricks', 'magma', 'nether_quartz_ore', 'nether_gold_ore', 'ancient_debris', 'lava', 'obsidian', 'nether_portal', 'bedrock',
];
