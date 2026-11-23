'use strict';

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */
const STORE_KEY = 'mumShopping.v1';
const DEFAULT_LOCATIONS = ['Large fridge', 'Little fridge', 'Freezer', 'Larder', 'Bathroom'];

function freshState() {
  return {
    locations: [...DEFAULT_LOCATIONS],
    items: {},        // id -> { id, name, location, aisle }
    list: {},         // id -> qty needed (current trip)
    dismissed: [],    // ids marked "has enough" on this walk-round
    basket: [],       // ids ticked off in the shop
    shops: [],        // [{ id, date, items: [{ itemId, name, qty }] }]  newest first
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return freshState();
    return { ...freshState(), ...JSON.parse(raw) };
  } catch {
    return freshState();
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save — storage may be full or disabled.');
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byName = (a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' });
const NEW_LOC = '__new__';

function lastBought(itemId) {
  for (const shop of state.shops) {
    const line = shop.items.find((l) => l.itemId === itemId);
    if (line) return { date: shop.date, qty: line.qty };
  }
  return null;
}

function relDate(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const days = Math.round((today - that) / 86400000);
  let rel;
  if (days <= 0) rel = 'today';
  else if (days === 1) rel = 'yesterday';
  else if (days < 14) rel = `${days} days ago`;
  else if (days < 60) rel = `${Math.round(days / 7)} weeks ago`;
  else rel = `${Math.round(days / 30)} months ago`;
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return { rel, abs: d.toLocaleDateString('en-GB', opts) };
}

function lastBoughtText(itemId) {
  const lb = lastBought(itemId);
  if (!lb) return 'Never bought';
  const { rel, abs } = relDate(lb.date);
  return `Last bought ${rel} (${abs}) · ×${lb.qty}`;
}

/* Aisle sort: numbers first (numerically), then named aisles A–Z, then none. */
function aisleKey(aisle) {
  const a = (aisle || '').trim();
  if (!a) return [2, 0, ''];
  const m = a.match(/^(\d+)/);
  if (m) return [0, parseInt(m[1], 10), a.toLowerCase()];
  return [1, 0, a.toLowerCase()];
}
function compareAisles(a, b) {
  const ka = aisleKey(a), kb = aisleKey(b);
  for (let i = 0; i < 3; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}
const aisleLabel = (a) => (/^\d/.test(a) ? `Aisle ${a}` : a);

function allAisles() {
  return [...new Set(Object.values(state.items).map((i) => (i.aisle || '').trim()).filter(Boolean))].sort(compareAisles);
}

function listCount() {
  return Object.values(state.list).filter((q) => q > 0).length;
}

function askNewLocation() {
  const name = (prompt('Name of the new location (e.g. Under the sink):') || '').trim();
  if (!name) return null;
  const existing = state.locations.find((l) => l.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  state.locations.push(name);
  return name;
}

function locationOptions(selected, { includeNone = false, placeholder = null } = {}) {
  let html = '';
  if (placeholder) html += `<option value="" selected disabled>${esc(placeholder)}</option>`;
  if (includeNone) html += `<option value="" ${!selected ? 'selected' : ''}>— No location —</option>`;
  html += state.locations
    .map((l) => `<option value="${esc(l)}" ${l === selected ? 'selected' : ''}>${esc(l)}</option>`)
    .join('');
  html += `<option value="${NEW_LOC}">+ New location…</option>`;
  return html;
}

let toastTimer;
function toast(msg, undoFn) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${undoFn ? '<button type="button">Undo</button>' : ''}`;
  if (undoFn) el.querySelector('button').onclick = () => { undoFn(); el.remove(); };
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */
function setQty(id, qty) {
  qty = Math.max(0, qty);
  if (qty > 0) {
    state.list[id] = qty;
    state.dismissed = state.dismissed.filter((d) => d !== id);
  } else {
    delete state.list[id];
    state.basket = state.basket.filter((b) => b !== id);
  }
  save(); render();
}

function dismiss(id) {
  if (!state.dismissed.includes(id)) state.dismissed.push(id);
  delete state.list[id];
  save(); render();
}

function undismiss(id) {
  state.dismissed = state.dismissed.filter((d) => d !== id);
  save(); render();
}

function addItem(name, location, qty = 1) {
  name = name.trim();
  if (!name) return;
  let item = Object.values(state.items).find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (item) {
    if (location && !item.location) item.location = location;
    toast(`"${item.name}" already exists — added to the list`);
  } else {
    item = { id: uid(), name, location: location || '', aisle: '' };
    state.items[item.id] = item;
  }
  state.list[item.id] = (state.list[item.id] || 0) + qty;
  state.dismissed = state.dismissed.filter((d) => d !== item.id);
  save(); render();
}

function setLocation(id, loc) {
  state.items[id].location = loc;
  save(); render();
}

function setAisle(id, aisle) {
  state.items[id].aisle = (aisle || '').trim();
  save(); render();
}

function toggleBasket(id) {
  if (state.basket.includes(id)) state.basket = state.basket.filter((b) => b !== id);
  else state.basket.push(id);
  save(); render();
}

function finishShop() {
  const got = state.basket.filter((id) => state.list[id] > 0 && state.items[id]);
  if (!got.length) {
    alert('Nothing is ticked off yet. Tick items as you put them in the basket.');
    return;
  }
  const missing = listCount() - got.length;
  const msg = missing
    ? `Save this shop with ${got.length} item(s)?\n\n${missing} item(s) not ticked will stay on the list for next time.`
    : `Save this shop with ${got.length} item(s)?`;
  if (!confirm(msg)) return;

  state.shops.unshift({
    id: uid(),
    date: new Date().toISOString(),
    items: got.map((id) => ({ itemId: id, name: state.items[id].name, qty: state.list[id] })),
  });
  got.forEach((id) => delete state.list[id]);
  state.basket = [];
  state.dismissed = [];
  save();
  location.hash = '#more';
  toast('Shop saved');
}

/* ------------------------------------------------------------------ *
 * House page
 * ------------------------------------------------------------------ */
function itemRowHouse(item) {
  const qty = state.list[item.id] || 0;
  const dismissed = state.dismissed.includes(item.id);
  let controls;
  if (dismissed) {
    controls = `<button data-act="undismiss" data-id="${item.id}">Undo</button>`;
  } else if (qty > 0) {
    controls = `
      <span class="stepper">
        <button data-act="dec" data-id="${item.id}" aria-label="Fewer">−</button>
        <span class="qty">${qty}</span>
        <button data-act="inc" data-id="${item.id}" aria-label="More">+</button>
      </span>`;
  } else {
    controls = `
      <button class="enough" data-act="dismiss" data-id="${item.id}">Enough</button>
      <button class="need" data-act="inc" data-id="${item.id}">Need</button>`;
  }
  const placer = !item.location
    ? `<div class="placer"><select data-act="place" data-id="${item.id}">${locationOptions('', { placeholder: 'Choose where it lives…' })}</select></div>`
    : '';
  return `
    <li class="item ${qty > 0 ? 'needed' : ''}">
      <div class="info">
        <div class="name">${esc(item.name)}</div>
        <div class="meta">${esc(lastBoughtText(item.id))}</div>
      </div>
      <div class="controls">
        ${controls}
        <button class="more" data-act="edit" data-id="${item.id}" aria-label="Edit ${esc(item.name)}">⋯</button>
      </div>
      ${placer}
    </li>`;
}

function sectionHtml(title, items, extraClass = '') {
  const active = items.filter((i) => !state.dismissed.includes(i.id)).sort(byName);
  const done = items.filter((i) => state.dismissed.includes(i.id)).sort(byName);
  const needed = items.filter((i) => state.list[i.id] > 0).length;
  const toCheck = active.filter((i) => !(state.list[i.id] > 0)).length;
  const countBits = [];
  if (needed) countBits.push(`${needed} needed`);
  if (toCheck) countBits.push(`${toCheck} to check`);
  if (!countBits.length && items.length) countBits.push('all checked ✓');
  return `
    <section class="section ${extraClass}">
      <h2>${esc(title)} <span class="count">${countBits.join(' · ')}</span></h2>
      ${active.length ? `<ul class="items">${active.map(itemRowHouse).join('')}</ul>` : (items.length ? '' : '<p class="muted small">Nothing here yet.</p>')}
      ${done.length ? `
        <details class="dismissed">
          <summary>${done.length} with enough</summary>
          <ul class="items">${done.map(itemRowHouse).join('')}</ul>
        </details>` : ''}
    </section>`;
}

function renderHouse() {
  const items = Object.values(state.items);
  const unplaced = items.filter((i) => !i.location || !state.locations.includes(i.location));
  const n = listCount();

  $('#page-title').textContent = "Sort Mother Out";
  $('#page-sub').textContent = n ? `${n} item${n === 1 ? '' : 's'} on the list` : 'Walk round and check what she needs';

  let html = `
    <form class="card add-form" id="add-form" autocomplete="off">
      <input name="name" placeholder="Add a new item…" required>
      <select name="location">${locationOptions('', { includeNone: true })}</select>
      <button class="primary">Add</button>
    </form>`;

  if (!items.length) {
    html += `<p class="empty">No items yet.<br>Add things above as you spot what Mum needs — they'll be remembered for next time.</p>`;
  }

  if (unplaced.length) html += sectionHtml('Needs a location', unplaced, 'unplaced');
  for (const loc of state.locations) {
    const inLoc = items.filter((i) => i.location === loc);
    if (inLoc.length) html += sectionHtml(loc, inLoc);
  }
  const emptyLocs = state.locations.filter((loc) => !items.some((i) => i.location === loc));
  if (items.length && emptyLocs.length) {
    html += `<p class="muted small">Empty locations: ${emptyLocs.map(esc).join(', ')}</p>`;
  }

  if (n) {
    html += `<div class="finish-bar"><a class="btn primary" href="#shop" style="text-align:center;text-decoration:none;padding:13px">Go shopping → (${n})</a></div>`;
  }
  $('#app').innerHTML = html;
}

/* ------------------------------------------------------------------ *
 * Shop page
 * ------------------------------------------------------------------ */
function renderShop() {
  const ids = Object.keys(state.list).filter((id) => state.list[id] > 0 && state.items[id]);
  const items = ids.map((id) => state.items[id]);
  const got = items.filter((i) => state.basket.includes(i.id)).length;

  $('#page-title').textContent = 'Shopping';
  $('#page-sub').textContent = items.length ? `${got} of ${items.length} in the basket` : '';

  if (!items.length) {
    $('#app').innerHTML = `<p class="empty">The list is empty.<br><a href="#house">Go round the house first</a> to build it.</p>`;
    return;
  }

  const groups = new Map();
  items
    .sort((a, b) => compareAisles(a.aisle, b.aisle) || byName(a, b))
    .forEach((i) => {
      const key = (i.aisle || '').trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });

  let html = `<div class="progress"><div style="width:${(100 * got) / items.length}%"></div></div>`;
  for (const [aisle, list] of groups) {
    const title = aisle ? aisleLabel(aisle) : 'No aisle yet';
    html += `
      <section class="section ${aisle ? '' : 'unplaced'}">
        <h2>${esc(title)} <span class="count">${list.length}</span></h2>
        <ul class="items">${list.map((i) => shopRow(i, !aisle)).join('')}</ul>
      </section>`;
  }
  html += `
    <div class="finish-bar">
      <button class="primary" data-act="finish">Finish shop &amp; save</button>
    </div>`;
  $('#app').innerHTML = html;
}

function shopRow(item, noAisle) {
  const got = state.basket.includes(item.id);
  const qty = state.list[item.id];
  return `
    <li class="item shop-item ${got ? 'got' : ''}" data-act="tick" data-id="${item.id}">
      <span class="tick">${got ? '✓' : ''}</span>
      <div class="info">
        <div class="name">${esc(item.name)} ${qty > 1 ? `<span class="qtytag">×${qty}</span>` : ''}</div>
        <div class="meta">${esc(item.location || 'No location')}</div>
      </div>
      ${noAisle ? '' : `<button class="aisle-chip" data-act="aisle" data-id="${item.id}">${esc(aisleLabel(item.aisle))}</button>`}
      ${noAisle ? `
        <form class="aisle-setter" data-id="${item.id}" autocomplete="off">
          <input name="aisle" list="aisle-list" placeholder="Which aisle? e.g. 7 or Bakery" inputmode="text">
          <button>Set</button>
        </form>` : ''}
    </li>`;
}

/* ------------------------------------------------------------------ *
 * History / settings page
 * ------------------------------------------------------------------ */
function renderMore() {
  $('#page-title').textContent = 'History';
  $('#page-sub').textContent = `${state.shops.length} previous shop${state.shops.length === 1 ? '' : 's'}`;

  let html = '';
  if (!state.shops.length) {
    html += `<p class="empty">No shops saved yet. Finish a shop on the Shop page and it will appear here.</p>`;
  } else {
    html += state.shops.map((s) => {
      const { rel, abs } = relDate(s.date);
      return `
        <details class="card shop-log">
          <summary>${esc(abs)} <span class="muted small">— ${esc(rel)}, ${s.items.length} item${s.items.length === 1 ? '' : 's'}</span></summary>
          <ul>${s.items.map((l) => `<li>${esc(l.name)}${l.qty > 1 ? ` ×${l.qty}` : ''}</li>`).join('')}</ul>
          <p><button class="link danger" data-act="del-shop" data-id="${s.id}">Delete this shop</button></p>
        </details>`;
    }).join('');
  }

  html += `
    <section class="section">
      <h2>Locations in the house</h2>
      <p class="muted small">Put them in the order you walk round.</p>
      <div class="card">
        ${state.locations.map((l, idx) => `
          <div class="loc-row">
            <span>${esc(l)}</span>
            <button data-act="loc-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button data-act="loc-down" data-idx="${idx}" ${idx === state.locations.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
            <button data-act="loc-rename" data-idx="${idx}">Rename</button>
            <button data-act="loc-del" data-idx="${idx}" class="danger" aria-label="Delete">✕</button>
          </div>`).join('')}
        <div class="row" style="margin-top:8px"><button data-act="loc-add">+ Add location</button></div>
      </div>
    </section>

    <section class="section">
      <h2>Backup</h2>
      <p class="muted small">Everything is saved in this browser only. Export a backup file to keep it safe or move it to another phone.</p>
      <div class="card row">
        <button data-act="export">Export backup</button>
        <label class="btn" style="display:inline-flex;align-items:center">Import backup
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </label>
      </div>
      <p><button class="link" data-act="reset-walk">Clear today's list and start the walk-round again</button></p>
    </section>`;
  $('#app').innerHTML = html;
}

/* ------------------------------------------------------------------ *
 * Edit dialog
 * ------------------------------------------------------------------ */
const dialog = $('#edit-dialog');
const form = $('#edit-form');
let editingId = null;

function openEdit(id) {
  const item = state.items[id];
  if (!item) return;
  editingId = id;
  form.name.value = item.name;
  form.location.innerHTML = locationOptions(item.location, { includeNone: true });
  form.aisle.value = item.aisle || '';
  dialog.returnValue = '';
  dialog.showModal();
}

form.location.addEventListener('change', () => {
  if (form.location.value === NEW_LOC) {
    const loc = askNewLocation();
    form.location.innerHTML = locationOptions(loc || state.items[editingId].location, { includeNone: true });
    save();
  }
});

dialog.addEventListener('close', () => {
  if (dialog.returnValue === 'save' && editingId && state.items[editingId]) {
    const item = state.items[editingId];
    item.name = form.name.value.trim() || item.name;
    item.location = form.location.value === NEW_LOC ? item.location : form.location.value;
    item.aisle = form.aisle.value.trim();
    save(); render();
  }
  editingId = null;
});

$('#edit-delete').addEventListener('click', () => {
  const item = state.items[editingId];
  if (!item || !confirm(`Delete "${item.name}"? Past shops will still show it.`)) return;
  delete state.items[editingId];
  delete state.list[editingId];
  state.dismissed = state.dismissed.filter((d) => d !== editingId);
  state.basket = state.basket.filter((b) => b !== editingId);
  save();
  dialog.close('cancel');
  render();
});

/* ------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------ */
const app = $('#app');

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'FORM') return;
  if (e.target.closest('form.aisle-setter')) return; // typing an aisle shouldn't tick the item
  const { act, id } = el.dataset;
  const idx = Number(el.dataset.idx);

  switch (act) {
    case 'inc': setQty(id, (state.list[id] || 0) + 1); break;
    case 'dec': setQty(id, (state.list[id] || 0) - 1); break;
    case 'dismiss': {
      const name = state.items[id].name;
      dismiss(id);
      toast(`${name}: has enough`, () => undismiss(id));
      break;
    }
    case 'undismiss': undismiss(id); break;
    case 'edit': openEdit(id); break;
    case 'tick': toggleBasket(id); break;
    case 'aisle': {
      e.stopPropagation();
      const v = prompt(`Aisle for ${state.items[id].name} (number or name, blank to clear):`, state.items[id].aisle || '');
      if (v !== null) setAisle(id, v);
      break;
    }
    case 'finish': finishShop(); break;
    case 'del-shop':
      if (confirm('Delete this shop from the history?')) {
        state.shops = state.shops.filter((s) => s.id !== id);
        save(); render();
      }
      break;
    case 'loc-up':
    case 'loc-down': {
      const j = act === 'loc-up' ? idx - 1 : idx + 1;
      [state.locations[idx], state.locations[j]] = [state.locations[j], state.locations[idx]];
      save(); render();
      break;
    }
    case 'loc-rename': {
      const old = state.locations[idx];
      const nu = (prompt('Rename location:', old) || '').trim();
      if (!nu || nu === old) break;
      state.locations[idx] = nu;
      Object.values(state.items).forEach((i) => { if (i.location === old) i.location = nu; });
      save(); render();
      break;
    }
    case 'loc-del': {
      const loc = state.locations[idx];
      const n = Object.values(state.items).filter((i) => i.location === loc).length;
      if (!confirm(`Delete "${loc}"?${n ? `\n\n${n} item(s) will move to "Needs a location".` : ''}`)) break;
      state.locations.splice(idx, 1);
      Object.values(state.items).forEach((i) => { if (i.location === loc) i.location = ''; });
      save(); render();
      break;
    }
    case 'loc-add':
      if (askNewLocation()) { save(); render(); }
      break;
    case 'export': exportData(); break;
    case 'reset-walk':
      if (confirm('Clear the current list and all "enough" marks?')) {
        state.list = {}; state.dismissed = []; state.basket = [];
        save(); render();
      }
      break;
  }
});

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('select[data-act="place"]')) {
    let loc = el.value;
    if (loc === NEW_LOC) loc = askNewLocation();
    if (loc) setLocation(el.dataset.id, loc);
    else render();
  } else if (el.matches('#add-form select[name=location]') && el.value === NEW_LOC) {
    const loc = askNewLocation();
    save();
    el.innerHTML = locationOptions(loc || '', { includeNone: true });
  } else if (el.id === 'import-file' && el.files[0]) {
    importData(el.files[0]);
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'add-form') {
    const loc = f.location.value === NEW_LOC ? '' : f.location.value;
    addItem(f.name.value, loc);
    // keep the chosen location for the next add, and refocus for speed
    const input = $('#add-form input[name=name]');
    const sel = $('#add-form select[name=location]');
    if (sel) sel.value = loc;
    input?.focus();
  } else if (f.classList.contains('aisle-setter')) {
    const v = f.aisle.value.trim();
    if (v) setAisle(f.dataset.id, v);
  }
});

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mums-shopping-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data.items !== 'object' || !Array.isArray(data.locations)) throw new Error('bad');
      if (!confirm('Replace everything in this browser with the backup?')) return;
      state = { ...freshState(), ...data };
      save(); render();
      toast('Backup imported');
    } catch {
      alert("That file doesn't look like a backup from this app.");
    }
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */
function currentTab() {
  const t = location.hash.replace('#', '');
  return ['house', 'shop', 'more'].includes(t) ? t : 'house';
}

function render() {
  const tab = currentTab();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const n = listCount();
  const badge = $('#shop-badge');
  badge.hidden = !n;
  badge.textContent = n;
  $('#aisle-list').innerHTML = allAisles().map((a) => `<option value="${esc(a)}">`).join('');

  if (tab === 'house') renderHouse();
  else if (tab === 'shop') renderShop();
  else renderMore();
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { state = load(); render(); } });
render();
