(() => {
const $ = id => document.getElementById(id);
const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  heartOn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  repeatOne: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11 10h1.5v5" stroke-width="1.8"/></svg>'
};

// ---------- small settings (localStorage) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let favs = new Set(store.get("favs", []));
let shuffle = store.get("shuffle", false);
let repeat = store.get("repeat", "off"); // off | all | one
let view = store.get("view", "all");      // "all" | "fav" | playlist id

// ---------- IndexedDB: songs, playlists, blobs (audio + covers) ----------
const DB_NAME = "diskothiki";
const idb = new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    d.createObjectStore("songs", { keyPath: "id" });
    d.createObjectStore("playlists", { keyPath: "id" });
    d.createObjectStore("blobs");
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx(stores, mode, fn) {
  const d = await idb;
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    let out;
    Promise.resolve(fn(...[].concat(stores).map(s => t.objectStore(s)))).then(v => out = v);
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("abort"));
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getAll = name => tx(name, "readonly", s => req(s.getAll()));
const put = (name, val, key) => tx(name, "readwrite", s => req(key === undefined ? s.put(val) : s.put(val, key)));
const del = (name, key) => tx(name, "readwrite", s => req(s.delete(key)));
const getBlob = key => tx("blobs", "readonly", s => req(s.get(key)));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- state ----------
let songs = [], playlists = [];
let queue = [], qi = -1, current = null, query = "";
const audio = $("audio");
const urlCache = new Map(); // blob key -> object URL
async function blobUrl(key) {
  if (!key) return null;
  if (urlCache.has(key)) return urlCache.get(key);
  const b = await getBlob(key); if (!b) return null;
  const u = URL.createObjectURL(b); urlCache.set(key, u); return u;
}
function dropUrl(key) { const u = urlCache.get(key); if (u) { URL.revokeObjectURL(u); urlCache.delete(key); } }

async function reload() {
  songs = (await getAll("songs")).sort((a, b) => b.createdAt - a.createdAt);
  playlists = (await getAll("playlists")).sort((a, b) => a.createdAt - b.createdAt);
  if (view !== "all" && view !== "fav" && !plById(view)) { view = "all"; store.set("view", view); }
  if (current) current = byId(current.id) || null;
  render(); renderPlayer();
}

// ---------- helpers ----------
const fmt = s => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ":" + String(r).padStart(2, "0"); };
const hash = str => { let h = 0; for (const c of str) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); };
const gradientFor = s => { const h = hash(s.id || s.title || "x") % 360; return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 60) % 360} 65% 32%))`; };
const initial = s => (s.title || "♪").trim().charAt(0).toUpperCase() || "♪";
function paintCover(el, s) {
  el.innerHTML = "";
  el.style.background = s ? gradientFor(s) : "var(--surface-2)";
  el.textContent = s ? initial(s) : "♪";
  if (s && s.cover) blobUrl(s.cover).then(u => {
    if (!u) return;
    el.textContent = ""; el.style.background = "var(--surface-2)";
    const img = new Image(); img.alt = ""; img.src = u; el.appendChild(img);
  });
}
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
const byId = id => songs.find(s => s.id === id);
const plById = id => playlists.find(p => p.id === id);
const mb = n => (n / 1048576).toFixed(1) + " MB";

// ---------- library ----------
function viewSongs() {
  if (view === "fav") return songs.filter(s => favs.has(s.id));
  const pl = plById(view);
  if (pl) return (pl.songIds || []).map(byId).filter(Boolean);
  return songs;
}
function visibleSongs() {
  const q = query.trim().toLowerCase();
  return viewSongs().filter(s => !q || (s.title || "").toLowerCase().includes(q) || (s.artist || "").toLowerCase().includes(q));
}
function setView(v) { view = v; store.set("view", v); render(); }
function renderLists() {
  const row = $("lists"); row.innerHTML = "";
  const mk = (label, v, hue) => {
    const b = document.createElement("button"); b.className = "chip"; b.setAttribute("aria-pressed", String(view === v));
    if (hue != null) { const d = document.createElement("span"); d.className = "dot"; d.style.background = `hsl(${hue} 75% 58%)`; b.appendChild(d); }
    b.appendChild(document.createTextNode(label));
    b.onclick = () => setView(v); row.appendChild(b);
  };
  mk("Όλα", "all"); mk("♥ Αγαπημένα", "fav");
  for (const p of playlists) mk(p.name || "Χωρίς όνομα", p.id, hash(p.id) % 360);
  const a = document.createElement("button"); a.className = "chip add"; a.textContent = "+ Νέα playlist";
  a.onclick = () => openPlaylist(null); row.appendChild(a);
  const pl = plById(view);
  $("plhead").hidden = !pl;
  if (pl) {
    const vs = viewSongs(), mins = Math.round(vs.reduce((t, s) => t + (s.duration || 0), 0) / 60);
    $("plName").textContent = pl.name || "Χωρίς όνομα";
    $("plSub").textContent = `${vs.length} ${vs.length === 1 ? "τραγούδι" : "τραγούδια"} · ${mins} λεπτά`;
  }
}
function render() {
  renderLists();
  const list = $("tracks"); list.innerHTML = "";
  const vis = visibleSongs(), curPl = plById(view);
  // Colour wash at the top, per view (like a playlist page)
  document.documentElement.style.setProperty("--hero", curPl ? `hsl(${hash(curPl.id) % 360} 45% 32%)` : view === "fav" ? "#4527a0" : "#2d4a3a");
  const total = songs.reduce((a, s) => a + (s.duration || 0), 0);
  $("stats").textContent = songs.length
    ? `${songs.length} ${songs.length === 1 ? "τραγούδι" : "τραγούδια"} · ${Math.round(total / 60)} λεπτά μουσικής`
    : "Κανένα τραγούδι ακόμα";
  $("playall").hidden = vis.length === 0;
  $("playAllSub").textContent = query ? "από την αναζήτηση" : curPl ? "την playlist " + (curPl.name || "") : view === "fav" ? "από τα αγαπημένα" : "όλη η δισκοθήκη";

  vis.forEach((s, i) => {
    const li = document.createElement("li");
    const isCur = current && current.id === s.id;
    li.className = "track" + (isCur ? " current" : "");
    const hit = document.createElement("button"); hit.className = "hit"; hit.setAttribute("aria-label", "Παίξε " + s.title);
    const num = document.createElement("span"); num.className = "num"; num.textContent = isCur && !audio.paused ? "▶" : String(i + 1);
    const cov = document.createElement("div"); cov.className = "cover"; paintCover(cov, s);
    const meta = document.createElement("div"); meta.className = "meta";
    const t = document.createElement("div"); t.className = "t"; t.textContent = s.title || "Χωρίς τίτλο";
    const a = document.createElement("div"); a.className = "a"; a.textContent = s.artist || "";
    meta.append(t, a); hit.append(num, cov, meta);
    hit.onclick = () => playFrom(vis.map(x => x.id), i);
    const dur = document.createElement("span"); dur.className = "dur"; dur.textContent = fmt(s.duration);
    const more = document.createElement("button"); more.className = "iconbtn"; more.innerHTML = ICON.dots;
    more.setAttribute("aria-label", "Επεξεργασία " + s.title); more.onclick = () => openEdit(s.id);
    li.append(hit, dur, more); list.appendChild(li);
  });

  const empty = $("empty"); empty.innerHTML = "";
  const st = document.createElement("strong"), p = document.createElement("div");
  if (songs.length === 0) {
    st.textContent = "Η δισκοθήκη είναι άδεια";
    p.textContent = "Πρόσθεσε το πρώτο της τραγούδι από τα αρχεία του κινητού. Μένει αποθηκευμένο εδώ και παίζει και χωρίς ίντερνετ.";
    const b = document.createElement("button"); b.className = "btn primary"; b.textContent = "Προσθήκη τραγουδιού"; b.onclick = openUpload;
    empty.append(st, p, b); empty.hidden = false;
  } else if (vis.length === 0) {
    if (query) { st.textContent = "Τίποτα δεν ταιριάζει"; p.textContent = "Δοκίμασε άλλη λέξη."; }
    else if (curPl) { st.textContent = "Η playlist είναι άδεια"; p.textContent = "Πάτα τις τρεις τελίτσες σε ένα τραγούδι και τσέκαρε αυτή την playlist."; }
    else { st.textContent = "Δεν έχεις αγαπημένα ακόμα"; p.textContent = "Πάτα την καρδιά σε ένα τραγούδι για να το κρατήσεις εδώ."; }
    empty.append(st, p); empty.hidden = false;
  } else empty.hidden = true;
}

function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id);
  store.set("favs", [...favs]); render(); renderPlayer();
}

// ---------- playback ----------
const shuffled = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function playFrom(ids, index) {
  if (shuffle) { queue = [ids[index], ...shuffled(ids.filter((_, i) => i !== index))]; qi = 0; }
  else { queue = ids.slice(); qi = index; }
  load(queue[qi], true);
}
async function load(id, autoplay, startAt) {
  const s = byId(id); if (!s) return;
  current = s;
  render(); renderPlayer();
  const u = await blobUrl(s.audio);
  if (!u) { toast("Δεν βρέθηκε το αρχείο του τραγουδιού."); return; }
  // Keep only the current track's audio URL around; covers stay cached.
  for (const [k] of urlCache) if (k.startsWith("a_") && k !== s.audio) dropUrl(k);
  audio.src = u;
  if (startAt) audio.addEventListener("loadedmetadata", () => { if (startAt < audio.duration - 2) audio.currentTime = startAt; }, { once: true });
  store.set("last", { id: s.id, t: startAt || 0, queue, qi });
  if (autoplay) audio.play().catch(() => {});
  setMediaSession();
}
function togglePlay() {
  if (!current) { const v = visibleSongs(); if (v.length) playFrom(v.map(s => s.id), 0); return; }
  if (!audio.src) { load(current.id, true); return; }
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}
function next(auto) {
  if (!queue.length) return;
  if (auto && repeat === "one") { audio.currentTime = 0; audio.play(); return; }
  if (qi < queue.length - 1) qi++;
  else if (repeat === "all" || !auto) qi = 0;
  else { audio.pause(); audio.currentTime = 0; renderPlayer(); return; }
  load(queue[qi], true);
}
function prev() {
  if (audio.currentTime > 3 || !queue.length) { audio.currentTime = 0; return; }
  qi = qi > 0 ? qi - 1 : queue.length - 1;
  load(queue[qi], true);
}
function renderPlayer() {
  $("mini").hidden = !current;
  if (!current) { $("sheet").hidden = true; return; }
  const playing = !audio.paused;
  paintCover($("miniCover"), current); paintCover($("npCover"), current);
  $("miniTitle").textContent = $("npTitle").textContent = current.title || "Χωρίς τίτλο";
  $("miniArtist").textContent = $("npArtist").textContent = current.artist || "";
  for (const b of [$("miniPlay"), $("npPlay")]) { b.innerHTML = playing ? ICON.pause : ICON.play; b.setAttribute("aria-label", playing ? "Παύση" : "Αναπαραγωγή"); }
  const f = favs.has(current.id);
  for (const b of [$("miniFav"), $("npFav")]) { b.innerHTML = f ? ICON.heartOn : ICON.heart; b.classList.toggle("on", f); }
  $("shuffleBtn").classList.toggle("on", shuffle);
  $("repeatBtn").innerHTML = repeat === "one" ? ICON.repeatOne : ICON.repeat;
  $("repeatBtn").classList.toggle("on", repeat !== "off");
  $("repeatBtn").setAttribute("aria-label", repeat === "off" ? "Επανάληψη: όχι" : repeat === "all" ? "Επανάληψη: όλα" : "Επανάληψη: ένα");
  const note = (current.note || "").trim();
  $("npNote").hidden = !note; $("npNoteText").textContent = note;
  const hue = hash(current.id) % 360;
  $("sheet").style.setProperty("--glow", `hsl(${hue} 40% 30%)`);
  document.documentElement.style.setProperty("--mini", `hsl(${hue} 30% 20%)`);
}
let seeking = false, lastSave = 0;
function renderTime() {
  const d = isFinite(audio.duration) ? audio.duration : (current && current.duration) || 0;
  const c = audio.currentTime || 0;
  $("miniProg").style.width = d ? (c / d * 100) + "%" : "0";
  if (!seeking) { $("seek").value = d ? Math.round(c / d * 1000) : 0; $("seek").style.setProperty("--pct", ($("seek").value / 10) + "%"); }
  $("tCur").textContent = fmt(c); $("tDur").textContent = fmt(d);
}
audio.addEventListener("timeupdate", () => {
  renderTime();
  if (current && Date.now() - lastSave > 4000) { lastSave = Date.now(); store.set("last", { id: current.id, t: audio.currentTime, queue, qi }); }
  if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && isFinite(audio.duration)) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: 1 }); } catch {}
  }
});
audio.addEventListener("play", () => { renderPlayer(); render(); });
audio.addEventListener("pause", () => { renderPlayer(); render(); });
audio.addEventListener("ended", () => next(true));
audio.addEventListener("loadedmetadata", renderTime);
$("seek").addEventListener("input", () => { seeking = true; $("seek").style.setProperty("--pct", ($("seek").value / 10) + "%"); $("tCur").textContent = fmt($("seek").value / 1000 * (audio.duration || 0)); });
$("seek").addEventListener("change", () => { const d = audio.duration || 0; if (d) audio.currentTime = $("seek").value / 1000 * d; seeking = false; });

async function setMediaSession() {
  if (!("mediaSession" in navigator) || !current) return;
  try {
    const art = [];
    if (current.cover) { const u = await blobUrl(current.cover); if (u) art.push({ src: u, sizes: "512x512" }); }
    else art.push({ src: "icon-512.png", sizes: "512x512", type: "image/png" });
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title || "", artist: current.artist || "", album: "Η Δισκοθήκη μας", artwork: art });
    const h = { play: () => audio.play(), pause: () => audio.pause(), previoustrack: prev, nexttrack: () => next(false),
      seekto: e => { if (e.seekTime != null) audio.currentTime = e.seekTime; } };
    for (const k in h) { try { navigator.mediaSession.setActionHandler(k, h[k]); } catch {} }
  } catch {}
}

// ---------- controls ----------
$("miniPlay").onclick = togglePlay; $("npPlay").onclick = togglePlay;
$("nextBtn").onclick = () => next(false); $("prevBtn").onclick = prev;
$("miniFav").onclick = () => current && toggleFav(current.id);
$("npFav").onclick = () => current && toggleFav(current.id);
const openSheet = () => { $("sheet").hidden = false; document.body.style.overflow = "hidden"; history.pushState({ sheet: 1 }, ""); };
const closeSheet = () => { $("sheet").hidden = true; document.body.style.overflow = ""; };
$("openSheet").onclick = openSheet;
$("closeSheet").onclick = () => history.state && history.state.sheet ? history.back() : closeSheet();
window.addEventListener("popstate", () => { if (!$("sheet").hidden) closeSheet(); }); // Android back button closes the player
$("shuffleBtn").onclick = () => {
  shuffle = !shuffle; store.set("shuffle", shuffle);
  if (current && queue.length) {
    let rest = queue.filter(id => id !== current.id);
    rest = shuffle ? shuffled(rest) : rest.sort((a, b) => songs.findIndex(s => s.id === a) - songs.findIndex(s => s.id === b));
    queue = [current.id, ...rest]; qi = 0;
  }
  renderPlayer(); toast(shuffle ? "Τυχαία σειρά: ναι" : "Τυχαία σειρά: όχι");
};
$("repeatBtn").onclick = () => { repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off"; store.set("repeat", repeat); renderPlayer(); };
$("playAllBtn").onclick = () => { const v = visibleSongs(); if (v.length) playFrom(v.map(s => s.id), 0); };
$("shuffleAll").onclick = () => { const v = visibleSongs(); if (!v.length) return; shuffle = true; store.set("shuffle", true); playFrom(v.map(s => s.id), Math.floor(Math.random() * v.length)); };
$("q").addEventListener("input", e => { query = e.target.value; render(); });
$("editCurrent").onclick = () => current && openEdit(current.id);
document.addEventListener("keydown", e => {
  if (e.target.closest("input, textarea")) return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
});

// ---------- playlists ----------
function fillChecks(el, field, checked) {
  el.innerHTML = ""; $(field).hidden = !playlists.length;
  for (const p of playlists) {
    const l = document.createElement("label"); l.className = "check";
    const i = document.createElement("input"); i.type = "checkbox"; i.value = p.id; i.checked = checked.has(p.id);
    l.append(i, document.createTextNode(p.name || "Χωρίς όνομα")); el.appendChild(l);
  }
}
const checkedIn = el => new Set([...el.querySelectorAll("input:checked")].map(i => i.value));
async function setMembership(add, remove, plIds) {
  for (const pid of plIds) {
    const p = plById(pid); if (!p) continue;
    const ids = (p.songIds || []).filter(x => !remove.includes(x));
    for (const x of add) if (!ids.includes(x)) ids.push(x);
    await put("playlists", { ...p, songIds: ids });
  }
}
let plEditing = null, plConfirm = false;
function openPlaylist(id) {
  plEditing = id; plConfirm = false;
  const p = id && plById(id);
  $("plFormTitle").textContent = p ? "Μετονομασία playlist" : "Νέα playlist";
  $("plSave").textContent = p ? "Αποθήκευση" : "Δημιουργία";
  $("plInput").value = p ? p.name || "" : "";
  $("plDelete").hidden = !p; $("plDelete").textContent = "Διαγραφή playlist";
  $("plMsg").textContent = ""; $("plMsg").className = "msg";
  $("plModal").hidden = false; setTimeout(() => $("plInput").focus(), 30);
}
$("plEdit").onclick = () => openPlaylist(view);
$("plCancel").onclick = () => $("plModal").hidden = true;
$("plModal").addEventListener("click", e => { if (e.target === $("plModal")) $("plModal").hidden = true; });
$("plForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("plInput").value.trim();
  if (!name) { $("plMsg").textContent = "Γράψε ένα όνομα."; $("plMsg").className = "msg err"; return; }
  if (plEditing) { await put("playlists", { ...plById(plEditing), name }); toast("Αποθηκεύτηκε"); }
  else { const id = "p_" + uid(); await put("playlists", { id, name, songIds: [], createdAt: Date.now() }); view = id; store.set("view", id); toast(`Η playlist «${name}» φτιάχτηκε`); }
  $("plModal").hidden = true; reload();
});
$("plDelete").onclick = async () => {
  if (!plConfirm) { plConfirm = true; $("plDelete").textContent = "Σίγουρα; Πάτα ξανά"; return; }
  await del("playlists", plEditing);
  $("plModal").hidden = true; view = "all"; store.set("view", view); reload();
  toast("Η playlist διαγράφηκε. Τα τραγούδια έμειναν.");
};

// ---------- add songs ----------
function probeDuration(blob) {
  return new Promise(res => {
    const a = document.createElement("audio"); a.preload = "metadata";
    const u = URL.createObjectURL(blob);
    const done = v => { res(v); URL.revokeObjectURL(u); };
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(-1);
    setTimeout(() => done(0), 8000);
    a.src = u;
  });
}
async function shrinkImage(file) {
  // Covers are resized to 600px so the library stays light.
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", .85));
  } catch { return file; }
}
let upFiles = [], upCover = null, busy = false;
function openUpload() {
  upFiles = []; upCover = null; busy = false;
  $("upForm").reset(); $("upArtist").value = store.get("artist", "");
  $("upMsg").textContent = ""; $("upMsg").className = "msg"; $("upProgWrap").hidden = true;
  paintCover($("upCoverPrev"), null); refreshQueue();
  fillChecks($("upLists"), "upListsField", new Set(plById(view) ? [view] : []));
  $("upModal").hidden = false;
}
const closeUpload = () => { if (!busy) $("upModal").hidden = true; };
const cleanName = n => n.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();
function refreshQueue() {
  const ql = $("queueList"); ql.innerHTML = "";
  for (const f of upFiles) {
    const d = document.createElement("div");
    const a = document.createElement("span"); a.textContent = f.name;
    const b = document.createElement("span"); b.textContent = mb(f.size); b.style.color = "var(--muted)";
    d.append(a, b); ql.appendChild(d);
  }
  const multi = upFiles.length > 1;
  $("titleField").hidden = multi; $("noteField").hidden = multi;
  if (upFiles.length === 1 && !$("upTitle").value) $("upTitle").value = cleanName(upFiles[0].name);
  $("upGo").disabled = !upFiles.length;
  $("upGo").textContent = multi ? `Προσθήκη ${upFiles.length} τραγουδιών` : "Προσθήκη";
}
$("uploadBtn").onclick = openUpload;
$("upCancel").onclick = closeUpload;
$("upModal").addEventListener("click", e => { if (e.target === $("upModal")) closeUpload(); });
$("pickAudio").onclick = () => $("audioIn").click();
$("audioIn").onchange = e => {
  const a = [...e.target.files].filter(f => f.type.startsWith("audio/") || f.type.startsWith("video/") || /\.(mp3|wav|m4a|flac|ogg|oga|opus|aac|mp4|webm)$/i.test(f.name));
  if (!a.length) { $("upMsg").textContent = "Αυτά δεν μοιάζουν με αρχεία ήχου."; $("upMsg").className = "msg err"; return; }
  upFiles = a; $("upMsg").textContent = ""; $("upMsg").className = "msg"; refreshQueue();
};
$("pickCover").onclick = () => $("coverIn").click();
$("coverIn").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  upCover = f; const el = $("upCoverPrev"); el.innerHTML = ""; const img = new Image(); img.src = URL.createObjectURL(f); el.appendChild(img);
};
$("upForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (busy || !upFiles.length) return;
  busy = true; $("upGo").disabled = true; $("upCancel").disabled = true;
  const msg = $("upMsg"), bar = $("upProg"); $("upProgWrap").hidden = false; msg.className = "msg";
  const artist = $("upArtist").value.trim(); store.set("artist", artist);
  const lists = [...checkedIn($("upLists"))], newIds = [], skipped = [];
  try {
    let coverKey = null;
    if (upCover) { coverKey = "c_" + uid(); await put("blobs", await shrinkImage(upCover), coverKey); }
    for (let n = 0; n < upFiles.length; n++) {
      const f = upFiles[n];
      msg.textContent = upFiles.length > 1 ? `Αποθήκευση ${n + 1}/${upFiles.length}…` : "Αποθήκευση…";
      const duration = await probeDuration(f);
      if (duration < 0) { skipped.push(f.name); continue; }
      const id = "s_" + uid(), audioKey = "a_" + uid();
      await put("blobs", f, audioKey);
      await put("songs", {
        id, title: upFiles.length === 1 ? ($("upTitle").value.trim() || cleanName(f.name)) : cleanName(f.name),
        artist, note: upFiles.length === 1 ? $("upNote").value.trim() : "",
        audio: audioKey, cover: coverKey, duration: Math.round(duration), size: f.size, createdAt: Date.now() + n
      });
      newIds.push(id);
      bar.style.width = ((n + 1) / upFiles.length * 100) + "%";
    }
    if (newIds.length && lists.length) { playlists = await getAll("playlists"); await setMembership(newIds, [], lists); }
    busy = false; $("upCancel").disabled = false;
    await reload();
    if (skipped.length) { msg.textContent = "Δεν παίζουν σε αυτό το κινητό: " + skipped.join(", "); msg.className = "msg err"; $("upGo").disabled = false; if (newIds.length) toast(`Προστέθηκαν ${newIds.length}`); return; }
    $("upModal").hidden = true;
    toast(newIds.length === 1 ? "Προστέθηκε" : `Προστέθηκαν ${newIds.length} τραγούδια`);
  } catch (err) {
    busy = false; $("upGo").disabled = false; $("upCancel").disabled = false;
    msg.className = "msg err";
    msg.textContent = err && err.name === "QuotaExceededError" ? "Δεν φτάνει ο χώρος στο κινητό. Σβήσε κάτι και ξαναδοκίμασε." : "Η αποθήκευση απέτυχε. Δοκίμασε ξανά.";
    reload();
  }
});

// ---------- edit / delete ----------
let edId = null, edCoverFile = null, edConfirm = false;
function openEdit(id) {
  const s = byId(id); if (!s) return;
  edId = id; edCoverFile = null; edConfirm = false;
  $("edTitle").value = s.title || ""; $("edArtist").value = s.artist || ""; $("edNote").value = s.note || "";
  paintCover($("edCoverPrev"), s);
  fillChecks($("edLists"), "edListsField", new Set(playlists.filter(p => (p.songIds || []).includes(id)).map(p => p.id)));
  $("edDelete").textContent = "Διαγραφή"; $("edMsg").textContent = ""; $("edMsg").className = "msg";
  $("edModal").hidden = false;
}
$("edCancel").onclick = () => $("edModal").hidden = true;
$("edModal").addEventListener("click", e => { if (e.target === $("edModal")) $("edModal").hidden = true; });
$("edPickCover").onclick = () => $("edCoverIn").click();
$("edCoverIn").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  edCoverFile = f; const el = $("edCoverPrev"); el.innerHTML = ""; el.style.background = "var(--surface-2)";
  const img = new Image(); img.src = URL.createObjectURL(f); el.appendChild(img);
};
const coverInUse = (key, exceptId) => songs.some(x => x.id !== exceptId && x.cover === key);
$("edForm").addEventListener("submit", async e => {
  e.preventDefault();
  const s = byId(edId); if (!s) return;
  $("edSave").disabled = true;
  try {
    const upd = { ...s, title: $("edTitle").value.trim() || s.title, artist: $("edArtist").value.trim(), note: $("edNote").value.trim() };
    if (edCoverFile) {
      upd.cover = "c_" + uid(); await put("blobs", await shrinkImage(edCoverFile), upd.cover);
      if (s.cover && !coverInUse(s.cover, s.id)) { await del("blobs", s.cover); dropUrl(s.cover); }
    }
    await put("songs", upd);
    const want = checkedIn($("edLists"));
    await setMembership([s.id], [], playlists.filter(p => want.has(p.id) && !(p.songIds || []).includes(s.id)).map(p => p.id));
    await setMembership([], [s.id], playlists.filter(p => !want.has(p.id) && (p.songIds || []).includes(s.id)).map(p => p.id));
    $("edModal").hidden = true; toast("Αποθηκεύτηκε"); reload();
  } catch { $("edMsg").textContent = "Η αποθήκευση απέτυχε."; $("edMsg").className = "msg err"; }
  $("edSave").disabled = false;
});
$("edDelete").onclick = async () => {
  const s = byId(edId); if (!s) return;
  if (!edConfirm) { edConfirm = true; $("edDelete").textContent = "Σίγουρα; Πάτα ξανά"; return; }
  if (current && current.id === s.id) { audio.pause(); audio.removeAttribute("src"); current = null; closeSheet(); }
  queue = queue.filter(x => x !== s.id);
  await setMembership([], [s.id], playlists.filter(p => (p.songIds || []).includes(s.id)).map(p => p.id));
  await del("songs", s.id); await del("blobs", s.audio); dropUrl(s.audio);
  if (s.cover && !coverInUse(s.cover, s.id)) { await del("blobs", s.cover); dropUrl(s.cover); }
  favs.delete(s.id); store.set("favs", [...favs]);
  $("edModal").hidden = true; toast("Διαγράφηκε"); reload();
};

// ---------- storage info + persistence ----------
async function renderFoot() {
  const foot = $("foot"); foot.innerHTML = "";
  const span = document.createElement("span");
  try {
    const est = await navigator.storage.estimate();
    span.textContent = `Χώρος: ${mb(est.usage || 0)} από ${Math.round((est.quota || 0) / 1073741824)} GB διαθέσιμα στο κινητό`;
  } catch { span.textContent = ""; }
  foot.appendChild(span);
  try {
    const persisted = await navigator.storage.persisted();
    if (!persisted) {
      const b = document.createElement("button"); b.textContent = "Προστασία από αυτόματο σβήσιμο";
      b.onclick = async () => { const ok = await navigator.storage.persist(); toast(ok ? "Τα τραγούδια προστατεύονται" : "Βάλε την εφαρμογή στην αρχική οθόνη και ξαναδοκίμασε"); renderFoot(); };
      foot.appendChild(b);
    }
  } catch {}
}

// ---------- boot ----------
(async () => {
  try { await reload(); }
  catch { $("stats").textContent = "Ο browser δεν επιτρέπει αποθήκευση. Βγες από την ανώνυμη περιήγηση."; return; }
  const last = store.get("last", null), s = last && byId(last.id);
  if (s) {
    queue = (last.queue || []).filter(byId); qi = queue.indexOf(s.id);
    if (qi < 0) { queue = songs.map(x => x.id); qi = queue.indexOf(s.id); }
    load(s.id, false, last.t);
  }
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
  renderFoot();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
})();
