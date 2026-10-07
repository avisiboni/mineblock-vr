// ============================================================================
// Mineblock — inventory data model + crafting
// ----------------------------------------------------------------------------
// Pure logic, no DOM. The UI calls inv.click(section, index, button, shift)
// and then re-renders. Stacks are { item, count, durability? } or null.
// ============================================================================
import { RECIPES, SHAPELESS, maxStack, itemDef } from './blocks.js';

export class Inventory {
  constructor() {
    this.main = new Array(27).fill(null);
    this.hotbar = new Array(9).fill(null);
    this.armor = new Array(4).fill(null);
    this.craft = new Array(4).fill(null);   // resized to 9 when a crafting table is open
    this.craftResult = null;
    this.cursor = null;
    this.selected = 0;
  }
  get held() { return this.hotbar[this.selected]; }
  setCraftSize(n) { this.returnCraft(); this.craft = new Array(n).fill(null); this.craftResult = null; }

  // Add items to hotbar first, then main. Returns leftover count.
  add(item, count = 1) {
    const def = itemDef(item); if (!def) return count;
    const max = maxStack(item);
    for (const arr of [this.hotbar, this.main]) {
      for (let i = 0; i < arr.length && count > 0; i++) {
        const s = arr[i];
        if (s && s.item === item && s.count < max && !def.durability) { const n = Math.min(max - s.count, count); s.count += n; count -= n; }
      }
    }
    for (const arr of [this.hotbar, this.main]) {
      for (let i = 0; i < arr.length && count > 0; i++) {
        if (!arr[i]) { const n = Math.min(max, count); arr[i] = { item, count: n, ...(def.durability ? { durability: def.durability } : {}) }; count -= n; }
      }
    }
    return count;
  }
  count(item) { return [...this.hotbar, ...this.main].reduce((a, s) => a + (s?.item === item ? s.count : 0), 0); }
  // Remove n of the held stack (after placing a block).
  consumeHeld(n = 1) {
    const s = this.held; if (!s) return;
    s.count -= n; if (s.count <= 0) this.hotbar[this.selected] = null;
  }
  damageHeld(n = 1) {
    const s = this.held; if (!s || s.durability === undefined) return false;
    s.durability -= n; if (s.durability <= 0) { this.hotbar[this.selected] = null; return true; }
    return false;
  }
  section(name) { return this[name === 'result' ? 'craftResult' : name]; }

  // Slot interaction, Minecraft-style.
  // left: pick up / place / swap / merge. right: split half / place one. shift: quick move.
  click(section, index, button, shift) {
    if (section === 'outside') { if (this.cursor) { this.drop?.(this.cursor); this.cursor = null; } return; }
    if (section === 'result') { this.takeResult(shift); return; }
    const arr = this[section];
    const s = arr[index];
    if (shift) {
      if (!s) return;
      const target = section === 'hotbar' ? this.main : this.hotbar;
      const left = this._addTo(target, s);
      arr[index] = left > 0 ? { ...s, count: left } : null;
      this.updateCraft(); return;
    }
    if (section === 'armor' && this.cursor && !this._isArmor(this.cursor.item)) return;
    if (button === 2) { // right click
      if (!this.cursor && s) { const half = Math.ceil(s.count / 2); this.cursor = { ...s, count: half }; s.count -= half; if (s.count <= 0) arr[index] = null; }
      else if (this.cursor && (!s || (s.item === this.cursor.item && s.count < maxStack(s.item)))) {
        if (!s) arr[index] = { ...this.cursor, count: 1 }; else s.count++;
        this.cursor.count--; if (this.cursor.count <= 0) this.cursor = null;
      }
    } else {
      if (!this.cursor) { this.cursor = s; arr[index] = null; }
      else if (!s) { arr[index] = this.cursor; this.cursor = null; }
      else if (s.item === this.cursor.item && s.durability === undefined) {
        const max = maxStack(s.item); const n = Math.min(max - s.count, this.cursor.count);
        s.count += n; this.cursor.count -= n; if (this.cursor.count <= 0) this.cursor = null;
      } else { arr[index] = this.cursor; this.cursor = s; }
    }
    this.updateCraft();
  }
  _isArmor(item) { return /_(helmet|chestplate|leggings|boots)$/.test(item); }
  _addTo(target, stack) {
    let count = stack.count; const max = maxStack(stack.item);
    for (let i = 0; i < target.length && count > 0; i++) { const t = target[i]; if (t && t.item === stack.item && t.count < max && stack.durability === undefined) { const n = Math.min(max - t.count, count); t.count += n; count -= n; } }
    for (let i = 0; i < target.length && count > 0; i++) if (!target[i]) { target[i] = { ...stack, count }; count = 0; }
    return count;
  }
  returnCraft() { this.craft.forEach((s, i) => { if (s) { const left = this.add(s.item, s.count); if (left) this.drop?.({ ...s, count: left }); this.craft[i] = null; } }); this.craftResult = null; }

  // ---- crafting ----
  updateCraft() { this.craftResult = matchRecipe(this.craft); }
  takeResult(shift) {
    if (!this.craftResult) return;
    const r = this.craftResult;
    if (!shift) {
      if (this.cursor && (this.cursor.item !== r.item || this.cursor.count + r.count > maxStack(r.item))) return;
      this.cursor = this.cursor ? { ...this.cursor, count: this.cursor.count + r.count } : { ...r, ...(itemDef(r.item).durability ? { durability: itemDef(r.item).durability } : {}) };
      this._consumeCraft();
    } else {
      let guard = 64;
      while (this.craftResult && guard--) {
        const res = this.craftResult;
        if (this.add(res.item, res.count) > 0) break;
        this._consumeCraft();
      }
    }
    this.updateCraft();
  }
  _consumeCraft() {
    this.craft.forEach((s, i) => { if (s) { s.count--; if (s.count <= 0) this.craft[i] = null; } });
    this.updateCraft();
  }
  toJSON() { return { main: this.main, hotbar: this.hotbar, armor: this.armor, selected: this.selected }; }
  static fromJSON(j) { const inv = new Inventory(); Object.assign(inv, { main: j.main, hotbar: j.hotbar, armor: j.armor, selected: j.selected || 0 }); return inv; }
}

// grid: array of stacks (4 => 2x2, 9 => 3x3). Returns {item,count} or null.
export function matchRecipe(grid) {
  const size = grid.length === 9 ? 3 : 2;
  // shapeless first
  const counts = {};
  grid.forEach((s) => { if (s) counts[s.item] = (counts[s.item] || 0) + 1; });
  for (const r of SHAPELESS) {
    const keys = Object.keys(r.inputs);
    if (keys.length === Object.keys(counts).length && keys.every((k) => counts[k] === r.inputs[k])) return { ...r.result };
  }
  // shaped: trim the grid to its bounding box and compare
  let minR = size, minC = size, maxR = -1, maxC = -1;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r * size + c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  if (maxR < 0) return null;
  const rows = [];
  for (let r = minR; r <= maxR; r++) { const row = []; for (let c = minC; c <= maxC; c++) row.push(grid[r * size + c]?.item || null); rows.push(row); }
  for (const rec of RECIPES) {
    const pat = rec.pattern.map((p) => p.split('').map((ch) => (ch === ' ' ? null : rec.key[ch])));
    if (pat.length !== rows.length || pat[0].length !== rows[0].length) continue;
    if (pat.length > size || pat[0].length > size) continue;
    let ok = true;
    for (let r = 0; r < rows.length && ok; r++) for (let c = 0; c < rows[0].length; c++) if (pat[r][c] !== rows[r][c]) { ok = false; break; }
    if (ok) return { ...rec.result };
  }
  return null;
}
