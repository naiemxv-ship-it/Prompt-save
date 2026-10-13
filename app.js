import {
  auth, db, storage, setPersistence, browserLocalPersistence, browserSessionPersistence
} from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  collection, doc, addDoc, setDoc, getDocs, getDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  ref, deleteObject
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const qsa = s => [...document.querySelectorAll(s)];
let user = null, prompts = [], categories = [], collections = [], notes = [], currentNoteId = null, noteEditorOpen = false;
let activeView = "dashboard", activeCategory = "", favoritesOnly = false, listMode = false;
let activeCollection = "", recentUsedOnly = false, activeDateFilter = "", activeModelFilter = "";
let currentImageFile = null, currentAsciiArt = "", currentAsciiColors = [], currentAsciiSettings = {
  width: 72, brightness: 0, contrast: 100, charset: "detailed", invert: false
};

const defaultCategories = [
  ["Characters","purple"],["Backgrounds","blue"],["Animation","orange"],["Horror","red"],["Stock","green"],["YouTube","orange"]
];

function toast(message, type="ok") {
  const t=$("toast"); t.textContent=message; t.className=`toast show ${type}`;
  setTimeout(()=>t.className="toast",2200);
}
function escapeHTML(v=""){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function initials(name="U"){return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"U";}
function fmtDate(ts){ if(!ts) return "Just now"; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }
function escAttr(v=""){return escapeHTML(v).replace(/`/g,"&#96;");}

function showAuth(mode="login"){
  $("authView").classList.remove("hidden"); $("appView").classList.add("hidden");
  $("loginPanel").classList.toggle("hidden",mode!=="login"); $("registerPanel").classList.toggle("hidden",mode!=="register");
}
function showApp(){ $("authView").classList.add("hidden"); $("appView").classList.remove("hidden"); }

function friendlyError(e){
  const map={
    "auth/invalid-credential":"Email or password is incorrect.",
    "auth/email-already-in-use":"An account already exists with this email.",
    "auth/weak-password":"Password should be at least 6 characters.",
    "auth/invalid-email":"Please enter a valid email address.",
    "auth/too-many-requests":"Too many attempts. Please try again later.",
    "auth/network-request-failed":"Network error. Check your internet connection."
  };
  return map[e.code] || e.message || "Something went wrong.";
}

$("showRegister").onclick=()=>showAuth("register");
$("showLogin").onclick=()=>showAuth("login");

$("loginForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    await setPersistence(auth,$("rememberMe").checked?browserLocalPersistence:browserSessionPersistence);
    await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value);
  }catch(err){toast(friendlyError(err),"error");}
};

$("registerForm").onsubmit=async e=>{
  e.preventDefault();
  if($("registerPassword").value!==$("registerConfirm").value) return toast("Passwords do not match.","error");
  try{
    const cred=await createUserWithEmailAndPassword(auth,$("registerEmail").value.trim(),$("registerPassword").value);
    await updateProfile(cred.user,{displayName:$("registerName").value.trim()});
    await setDoc(doc(db,"users",cred.user.uid),{
      name:$("registerName").value.trim(),email:cred.user.email,createdAt:serverTimestamp()
    });
    await seedCategories(cred.user.uid);
    toast("Account created successfully.");
  }catch(err){toast(friendlyError(err),"error");}
};

$("forgotBtn").onclick=async()=>{
  const email=$("loginEmail").value.trim();
  if(!email) return toast("Enter your email first.","error");
  try{await sendPasswordResetEmail(auth,email);toast("Password reset email sent.");}
  catch(err){toast(friendlyError(err),"error");}
};

async function seedCategories(uid){
  const snap=await getDocs(collection(db,"users",uid,"categories"));
  if(!snap.empty)return;
  for(const [name,color] of defaultCategories)
    await addDoc(collection(db,"users",uid,"categories"),{name,color,createdAt:serverTimestamp()});
}

onAuthStateChanged(auth, async u=>{
  user=u;
  if(!u){showAuth("login");return;}
  showApp();
  await loadAll();
  renderUser();
});

async function loadAll(){
  try{
    await seedCategories(user.uid);
    let colDocs = [];
    try {
      const colSnap = await getDocs(query(collection(db,"users",user.uid,"collections"),orderBy("name")));
      colDocs = colSnap.docs;
    } catch(err) {
      console.warn("Collections subcollection not yet populated or awaiting rules:", err);
    }
    const [p,c,n]=await Promise.all([
      getDocs(query(collection(db,"users",user.uid,"prompts"),orderBy("createdAt","desc"))),
      getDocs(query(collection(db,"users",user.uid,"categories"),orderBy("name"))),
      getDocs(query(collection(db,"users",user.uid,"notes"),orderBy("updatedAt","desc")))
    ]);
    prompts=p.docs.map(d=>({id:d.id,...d.data()}));
    categories=c.docs.map(d=>({id:d.id,...d.data()}));
    notes=n.docs.map(d=>({id:d.id,...d.data()}));
    collections=colDocs.map(d=>({id:d.id,...d.data()}));
    renderAll();
  }catch(err){console.error(err);toast("Could not load your workspace. Check Firestore setup.","error");}
}

function renderUser(){
  const name=user.displayName||user.email?.split("@")[0]||"User";
  $("profileName").textContent=name; $("menuName").textContent=name; $("menuEmail").textContent=user.email||"";
  $("avatar").textContent=initials(name); $("helloName").textContent=name.split(" ")[0];
  $("settingsName").value=name; $("settingsEmail").value=user.email||"";
}

function renderAll(){
  renderCategories();
  renderCollections();
  renderStats();
  renderDashboard();
  renderLibrary();
  renderNotes();
  fillCategorySelects();
  fillCollectionSelects();
}

function renderCategories(){
  const nav=$("categoryNav");
  nav.innerHTML=categories.map(c=>`<div class="category-nav-wrap"><button class="category-nav" data-cat="${escAttr(c.id)}"><i class="dot ${c.color||"orange"}"></i><span>${escapeHTML(c.name)}</span><em>${prompts.filter(p=>p.categoryId===c.id).length}</em></button><button class="category-delete" data-delete-category="${escAttr(c.id)}" title="Delete category" aria-label="Delete ${escAttr(c.name)}">×</button></div>`).join("");
  nav.querySelectorAll(".category-nav").forEach(b=>b.onclick=()=>{activeCategory=b.dataset.cat;activeCollection="";favoritesOnly=false;recentUsedOnly=false;setView("prompts");$("categoryFilter").value=activeCategory;renderLibrary();});
  nav.querySelectorAll("[data-delete-category]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteCategory(b.dataset.deleteCategory);});
}

function renderCollections(){
  const nav=$("collectionNav");
  if(!nav) return;
  if(collections.length === 0){
    nav.innerHTML = `<p style="padding:6px 10px;font-size:11px;color:var(--muted);margin:0">No collections yet</p>`;
    return;
  }
  nav.innerHTML=collections.map(c=>`<div class="category-nav-wrap"><button class="category-nav" data-col="${escAttr(c.id)}"><i class="dot ${c.color||"purple"}"></i><span>${escapeHTML(c.name)}</span><em>${prompts.filter(p=>p.collectionId===c.id).length}</em></button><button class="category-delete" data-delete-collection="${escAttr(c.id)}" title="Delete collection" aria-label="Delete ${escAttr(c.name)}">×</button></div>`).join("");
  nav.querySelectorAll(".category-nav").forEach(b=>b.onclick=()=>{activeCollection=b.dataset.col;activeCategory="";favoritesOnly=false;recentUsedOnly=false;setView("prompts");if($("collectionFilter"))$("collectionFilter").value=activeCollection;renderLibrary();});
  nav.querySelectorAll("[data-delete-collection]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteCollection(b.dataset.deleteCollection);});
}

function fillCollectionSelects(){
  const opts=collections.map(c=>`<option value="${escAttr(c.id)}">${escapeHTML(c.name)}</option>`).join("");
  if($("collectionFilter")) {
    $("collectionFilter").innerHTML=`<option value="">All collections</option>${opts}`;
    if(activeCollection) $("collectionFilter").value=activeCollection;
  }
  if($("promptCollection")) {
    $("promptCollection").innerHTML=`<option value="">No collection (Unassigned)</option>${opts}`;
  }
}
function dateValue(v){if(!v)return 0;const d=v.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?0:d.getTime();}
function renderStats(){
  $("statPrompts").textContent=prompts.length;
  $("statCategories").textContent=categories.length;
  $("statFavorites").textContent=prompts.filter(p=>p.favorite).length;
  $("statCopied").textContent=prompts.reduce((a,p)=>a+(p.copyCount||0),0);
}
function renderDashboard(){
  const recent=[...prompts].sort((a,b)=>dateValue(b.createdAt)-dateValue(a.createdAt)).slice(0,8); $("recentGrid").innerHTML=recent.map(promptCard).join("");
  $("emptyDashboard").classList.toggle("hidden",prompts.length>0);
  bindCards($("recentGrid"));
}
function fillModelSelects(){
  const modelSelect = $("modelFilter");
  if(!modelSelect) return;
  const currentVal = modelSelect.value;
  const models = [...new Set(prompts.map(p => (p.model || "").trim()).filter(Boolean))].sort();
  modelSelect.innerHTML = `<option value="">All models</option>${models.map(m => `<option value="${escAttr(m)}">${escapeHTML(m)}</option>`).join("")}`;
  if(models.includes(currentVal)) modelSelect.value = currentVal;
}

function fillCategorySelects(){
  const opts=categories.map(c=>`<option value="${escAttr(c.id)}">${escapeHTML(c.name)}</option>`).join("");
  $("categoryFilter").innerHTML=`<option value="">All categories</option>${opts}`;
  $("promptCategory").innerHTML=opts;
  if(activeCategory)$("categoryFilter").value=activeCategory;
  fillModelSelects();
}

function getFilteredPrompts(){
  let arr = [...prompts];
  const rawSearch = $("globalSearch").value.trim().toLowerCase();
  const searchTokens = rawSearch.split(/\s+/).filter(Boolean);

  // Category filter
  if(activeCategory) arr = arr.filter(p => p.categoryId === activeCategory);

  // Collection filter (forward-compatible with Phase 2)
  if(activeCollection) arr = arr.filter(p => p.collectionId === activeCollection);

  // Favorites filter
  if(activeView === "favorites" || favoritesOnly) arr = arr.filter(p => p.favorite);

  // Recently used filter
  if(activeView === "recent" || recentUsedOnly) {
    arr = arr.filter(p => p.lastUsedAt);
  }

  // Model filter
  if(activeModelFilter) {
    arr = arr.filter(p => (p.model || "").trim().toLowerCase() === activeModelFilter.toLowerCase());
  }

  // Date filter
  if(activeDateFilter) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if(activeDateFilter === "today") {
      arr = arr.filter(p => now - dateValue(p.createdAt) <= dayMs);
    } else if(activeDateFilter === "7days") {
      arr = arr.filter(p => now - dateValue(p.createdAt) <= 7 * dayMs);
    } else if(activeDateFilter === "30days") {
      arr = arr.filter(p => now - dateValue(p.createdAt) <= 30 * dayMs);
    }
  }

  // Multi-word case-insensitive search across title, prompt text, negative, notes, model, ratio, tags, category name
  if(searchTokens.length > 0) {
    arr = arr.filter(p => {
      const cat = categories.find(c => c.id === p.categoryId);
      const col = (typeof collections !== "undefined" ? collections.find(c => c.id === p.collectionId) : null);
      const searchable = [
        p.title || "",
        p.text || "",
        p.negative || "",
        p.notes || "",
        p.model || "",
        p.ratio || "",
        ...(p.tags || []),
        cat?.name || "",
        col?.name || ""
      ].join(" ").toLowerCase();

      return searchTokens.every(token => searchable.includes(token));
    });
  }

  // Sorting
  const sort = $("sortFilter").value;
  if(activeView === "recent" && !sort) {
    arr.sort((a,b) => dateValue(b.lastUsedAt) - dateValue(a.lastUsedAt));
  } else if(sort === "oldest") {
    arr.sort((a,b) => dateValue(a.createdAt) - dateValue(b.createdAt));
  } else if(sort === "updated") {
    arr.sort((a,b) => dateValue(b.updatedAt || b.createdAt) - dateValue(a.updatedAt || a.createdAt));
  } else if(sort === "used_recent") {
    arr.sort((a,b) => dateValue(b.lastUsedAt) - dateValue(a.lastUsedAt));
  } else if(sort === "used") {
    arr.sort((a,b) => (b.copyCount || 0) - (a.copyCount || 0));
  } else if(sort === "title_asc" || sort === "title") {
    arr.sort((a,b) => (a.title || "").localeCompare(b.title || ""));
  } else if(sort === "title_desc") {
    arr.sort((a,b) => (b.title || "").localeCompare(a.title || ""));
  } else {
    // default newest
    arr.sort((a,b) => dateValue(b.createdAt) - dateValue(a.createdAt));
  }

  return arr;
}

function promptCard(p){
  const cat = categories.find(c => c.id === p.categoryId);
  const col = collections.find(c => c.id === p.collectionId);
  const image = p.asciiArt
    ? `<pre class="ascii-card-art" aria-label="ASCII art preview">${coloredAsciiHTML(p.asciiArt, p.asciiColors)}</pre>`
    : ((p.imageThumbUrl || p.imageUrl)
      ? `<img src="${escAttr(p.imageThumbUrl || p.imageUrl)}" alt="Legacy reference image" loading="lazy" decoding="async">`
      : `<div class="image-placeholder"><span>ASCII</span></div>`);

  const colBadge = col
    ? `<span class="collection-pill ${col.color || "purple"}">📁 ${escapeHTML(col.name)}</span>`
    : "";

  return `<article class="prompt-card ${listMode ? "list-card" : ""}" data-id="${p.id}">
    <div class="prompt-image">${image}<button class="star-btn ${p.favorite ? "on" : ""}" data-action="favorite" title="Favorite">★</button></div>
    <div class="prompt-card-body">
      <div class="card-meta">
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span class="category-pill ${cat?.color || "orange"}">${escapeHTML(cat?.name || "Uncategorized")}</span>
          ${colBadge}
        </div>
        <span>${fmtDate(p.createdAt)}</span>
      </div>
      <h3>${escapeHTML(p.title || "Untitled")}</h3>
      <p class="prompt-preview">${escapeHTML(p.text || "").slice(0, 180)}${(p.text || "").length > 180 ? "…" : ""}</p>
      <div class="tags">${(p.tags || []).slice(0, 4).map(t => `<span>#${escapeHTML(t)}</span>`).join("")}</div>
      <div class="card-actions"><button class="copy-btn" data-action="copy">▣ Copy prompt</button><button class="icon-btn" data-action="edit" title="Edit">✎</button><button class="icon-btn" data-action="delete" title="Delete">⌫</button></div>
    </div>
  </article>`;
}

function renderActiveFilterTags(){
  const container = $("activeFilterTags");
  const resetBtn = $("resetFiltersBtn");
  if(!container) return;

  const tags = [];
  const searchVal = $("globalSearch").value.trim();
  if(searchVal) {
    tags.push({ label: `Search: "${searchVal}"`, clear: () => { $("globalSearch").value = ""; } });
  }
  if(activeCategory) {
    const cName = categories.find(c => c.id === activeCategory)?.name || "Category";
    tags.push({ label: `Category: ${cName}`, clear: () => { activeCategory = ""; $("categoryFilter").value = ""; } });
  }
  if(activeCollection) {
    const colName = typeof collections !== "undefined" ? (collections.find(c => c.id === activeCollection)?.name || "Collection") : "Collection";
    tags.push({ label: `Collection: ${colName}`, clear: () => { activeCollection = ""; if($("collectionFilter")) $("collectionFilter").value = ""; } });
  }
  if(favoritesOnly || activeView === "favorites") {
    tags.push({ label: "Favorites", clear: () => { favoritesOnly = false; if(activeView === "favorites") activeView = "prompts"; } });
  }
  if(recentUsedOnly || activeView === "recent") {
    tags.push({ label: "Recently Used", clear: () => { recentUsedOnly = false; if(activeView === "recent") activeView = "prompts"; } });
  }
  if(activeDateFilter) {
    const dMap = { today: "Today", "7days": "Past 7 days", "30days": "Past 30 days" };
    tags.push({ label: `Date: ${dMap[activeDateFilter] || activeDateFilter}`, clear: () => { activeDateFilter = ""; $("dateFilter").value = ""; } });
  }
  if(activeModelFilter) {
    tags.push({ label: `Model: ${activeModelFilter}`, clear: () => { activeModelFilter = ""; $("modelFilter").value = ""; } });
  }

  if(tags.length > 0) {
    container.innerHTML = tags.map((t, idx) => `
      <span class="filter-tag">
        <span>${escapeHTML(t.label)}</span>
        <button type="button" data-clear-filter="${idx}" title="Remove filter" aria-label="Remove filter">×</button>
      </span>
    `).join("");
    container.querySelectorAll("[data-clear-filter]").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.clearFilter);
        tags[idx]?.clear();
        renderLibrary();
      };
    });
    if(resetBtn) resetBtn.classList.remove("hidden");
  } else {
    container.innerHTML = "";
    if(resetBtn) resetBtn.classList.add("hidden");
  }
}

function resetAllFilters(){
  $("globalSearch").value = "";
  activeCategory = "";
  activeCollection = "";
  favoritesOnly = false;
  recentUsedOnly = false;
  activeDateFilter = "";
  activeModelFilter = "";
  if($("categoryFilter")) $("categoryFilter").value = "";
  if($("collectionFilter")) $("collectionFilter").value = "";
  if($("dateFilter")) $("dateFilter").value = "";
  if($("modelFilter")) $("modelFilter").value = "";
  if($("sortFilter")) $("sortFilter").value = "newest";
  if(activeView === "favorites" || activeView === "recent") setView("prompts");
  else renderLibrary();
}

function renderLibrary(){
  $("favoritesOnly").classList.toggle("active", favoritesOnly || activeView === "favorites");
  if($("recentUsedOnly")) $("recentUsedOnly").classList.toggle("active", recentUsedOnly || activeView === "recent");

  const searchVal = $("globalSearch").value.trim();
  if($("clearSearchBtn")) $("clearSearchBtn").classList.toggle("hidden", !searchVal);

  const arr = getFilteredPrompts();
  $("libraryGrid").className = `prompt-grid ${listMode ? "list-view" : ""}`;
  $("libraryGrid").innerHTML = arr.map(promptCard).join("");
  $("libraryEmpty").classList.toggle("hidden", arr.length > 0);

  // Result count
  const countLabel = $("resultCount");
  if(countLabel) {
    countLabel.textContent = `Showing ${arr.length} of ${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`;
  }

  // Active filter tags and reset button visibility
  renderActiveFilterTags();

  $("libraryTitle").textContent = activeCategory
    ? (categories.find(c => c.id === activeCategory)?.name || "Category")
    : (activeCollection ? "Collection" : (activeView === "favorites" || favoritesOnly ? "Favorites" : activeView === "recent" ? "Recently Used" : "All prompts"));

  bindCards($("libraryGrid"));
}
function bindCards(container){
  container.querySelectorAll(".prompt-card").forEach(card=>{
    card.onclick=e=>{
      const action=e.target.closest("[data-action]")?.dataset.action;
      const id=card.dataset.id;
      if(action==="copy")return copyPrompt(id);
      if(action==="favorite")return toggleFavorite(id);
      if(action==="edit")return openPrompt(id);
      if(action==="delete")return deletePrompt(id);
      openPrompt(id);
    };
  });
}

async function toggleFavorite(id){
  const p=prompts.find(x=>x.id===id);if(!p)return;
  p.favorite=!p.favorite;
  try { await updateDoc(doc(db,"users",user.uid,"prompts",id),{favorite:p.favorite}); } catch(err) { p.favorite=!p.favorite; toast("Could not update favorite. Check Firestore rules.","error"); return; }
  renderAll();toast(p.favorite?"Added to favorites":"Removed from favorites");
}
async function copyPrompt(id){
  const p=prompts.find(x=>x.id===id);if(!p)return;
  try{
    await navigator.clipboard.writeText(p.text||"");
    p.copyCount=(p.copyCount||0)+1;
    p.lastUsedAt=new Date();
    await updateDoc(doc(db,"users",user.uid,"prompts",id),{copyCount:p.copyCount,lastUsedAt:serverTimestamp()});
    renderStats();renderLibrary();toast("Prompt copied to clipboard.");
  }catch{toast("Clipboard permission was blocked.","error");}
}


// Image-to-ASCII pipeline. Original files are processed locally in the browser.
// Only the resulting ASCII text/settings are saved to Firestore; image files are never uploaded.
const ASCII_CHARSETS = {
  simple: "@%#*+=-:. ",
  classic: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~i!lI;:,\"^`'. ",
  blocks: "█▓▒░ ",
  detailed: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~i!lI;:,\"^`'. "
};

const ASCII_PRESETS = {
  balanced: {
    name: "Balanced (Default)",
    settings: { width: 72, brightness: 0, contrast: 100, charset: "detailed", invert: false }
  },
  portrait: {
    name: "Portrait",
    settings: { width: 80, brightness: 5, contrast: 110, charset: "detailed", invert: false }
  },
  high_detail: {
    name: "High Detail",
    settings: { width: 96, brightness: 0, contrast: 120, charset: "detailed", invert: false }
  },
  landscape: {
    name: "Landscape",
    settings: { width: 88, brightness: -5, contrast: 105, charset: "detailed", invert: false }
  },
  logo: {
    name: "Logo & Shapes",
    settings: { width: 64, brightness: 10, contrast: 140, charset: "simple", invert: false }
  },
  sketch: {
    name: "Sketch",
    settings: { width: 76, brightness: 15, contrast: 130, charset: "classic", invert: false }
  },
  color: {
    name: "Color ASCII",
    settings: { width: 72, brightness: 0, contrast: 100, charset: "detailed", invert: false }
  },
  compact: {
    name: "Compact (Narrow)",
    settings: { width: 48, brightness: 0, contrast: 100, charset: "simple", invert: false }
  },
  terminal: {
    name: "Terminal Invert",
    settings: { width: 72, brightness: 0, contrast: 100, charset: "classic", invert: true }
  }
};

function getCustomAsciiPresets() {
  try {
    return JSON.parse(localStorage.getItem("pv-ascii-custom-presets") || "{}");
  } catch {
    return {};
  }
}

function saveCustomAsciiPreset(id, name, settings) {
  const customs = getCustomAsciiPresets();
  customs[id] = { name, settings };
  try {
    localStorage.setItem("pv-ascii-custom-presets", JSON.stringify(customs));
  } catch (e) {
    console.error("Failed to save custom ASCII preset:", e);
  }
}

function renderAsciiPresetOptions(selectedKey = "balanced") {
  const sel = $("asciiPresetSelect");
  if (!sel) return;
  sel.innerHTML = "";

  const builtinGroup = document.createElement("optgroup");
  builtinGroup.label = "Built-in Presets";
  Object.entries(ASCII_PRESETS).forEach(([key, val]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = val.name;
    builtinGroup.appendChild(opt);
  });
  sel.appendChild(builtinGroup);

  const customs = getCustomAsciiPresets();
  const customEntries = Object.entries(customs);
  if (customEntries.length > 0) {
    const customGroup = document.createElement("optgroup");
    customGroup.label = "Custom Presets";
    customEntries.forEach(([key, val]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = `★ ${val.name}`;
      customGroup.appendChild(opt);
    });
    sel.appendChild(customGroup);
  }

  sel.value = selectedKey;
}

function getActivePresetSettings(key) {
  if (ASCII_PRESETS[key]) return ASCII_PRESETS[key].settings;
  const customs = getCustomAsciiPresets();
  if (customs[key]) return customs[key].settings;
  return ASCII_PRESETS.balanced.settings;
}

function checkPresetCustomization() {
  const badge = $("presetDiffBadge");
  if (!badge) return;
  const currentKey = $("asciiPresetSelect")?.value || "balanced";
  const base = getActivePresetSettings(currentKey);
  const current = readAsciiSettings();

  const isDifferent =
    Number(base.width) !== Number(current.width) ||
    Number(base.brightness) !== Number(current.brightness) ||
    Number(base.contrast) !== Number(current.contrast) ||
    String(base.charset) !== String(current.charset) ||
    Boolean(base.invert) !== Boolean(current.invert);

  badge.classList.toggle("hidden", !isDifferent);
}

function applyAsciiPreset(key) {
  const settings = getActivePresetSettings(key);
  setAsciiControls(settings);
  checkPresetCustomization();
  if (currentImageFile) {
    refreshAsciiFromSelectedFile();
  }
}

function syncAsciiPresetToSettings(settings = {}) {
  let matchedPreset = null;
  for (const [key, preset] of Object.entries(ASCII_PRESETS)) {
    if (
      Number(preset.settings.width) === Number(settings.width) &&
      Number(preset.settings.brightness) === Number(settings.brightness) &&
      Number(preset.settings.contrast) === Number(settings.contrast) &&
      String(preset.settings.charset) === String(settings.charset) &&
      Boolean(preset.settings.invert) === Boolean(settings.invert)
    ) {
      matchedPreset = key;
      break;
    }
  }
  if (!matchedPreset) {
    const customs = getCustomAsciiPresets();
    for (const [key, preset] of Object.entries(customs)) {
      if (
        Number(preset.settings.width) === Number(settings.width) &&
        Number(preset.settings.brightness) === Number(settings.brightness) &&
        Number(preset.settings.contrast) === Number(settings.contrast) &&
        String(preset.settings.charset) === String(settings.charset) &&
        Boolean(preset.settings.invert) === Boolean(settings.invert)
      ) {
        matchedPreset = key;
        break;
      }
    }
  }

  renderAsciiPresetOptions(matchedPreset || "balanced");
  checkPresetCustomization();
}

function promptSaveCustomPreset() {
  const name = prompt("Enter a name for this custom ASCII preset:");
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const id = "custom_" + Date.now();
  const settings = readAsciiSettings();
  saveCustomAsciiPreset(id, trimmed, settings);
  renderAsciiPresetOptions(id);
  checkPresetCustomization();
  toast(`Custom preset “${trimmed}” saved!`);
}

function getAsciiExportFilename(extension) {
  const title = ($("promptTitle")?.value || "").trim();
  const slug = title
    ? title.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
    : "promptvault-ascii";
  return `${slug || "promptvault-ascii"}.${extension}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 300);
}

function exportAsciiTxt() {
  if (!currentAsciiArt) {
    toast("No ASCII artwork to export. Select an image first.", "error");
    return;
  }
  const blob = new Blob([currentAsciiArt], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, getAsciiExportFilename("txt"));
  toast("Exported ASCII artwork as .txt file");
}

function exportAsciiHtml() {
  if (!currentAsciiArt) {
    toast("No ASCII artwork to export. Select an image first.", "error");
    return;
  }
  const promptTitle = ($("promptTitle")?.value || "PromptVault ASCII Artwork").trim();
  const safeTitle = escapeHTML(promptTitle);
  const coloredArt = coloredAsciiHTML(currentAsciiArt, currentAsciiColors);

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} — PromptVault ASCII Art</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      padding: 32px 20px;
      background: #0b0f19;
      color: #e2e8f0;
      font-family: ui-monospace, 'JetBrains Mono', 'Courier New', monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 6px 0;
      font-size: 1.25rem;
      color: #f8fafc;
      letter-spacing: -0.02em;
    }
    .meta {
      font-size: 0.8rem;
      color: #94a3b8;
    }
    .art-container {
      background: #020617;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 24px;
      overflow: auto;
      max-width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    }
    pre {
      margin: 0;
      font-family: inherit;
      font-size: 9px;
      line-height: 1.05;
      letter-spacing: 0;
      white-space: pre;
      user-select: all;
    }
    .actions {
      margin-top: 20px;
      display: flex;
      gap: 10px;
    }
    button {
      padding: 9px 18px;
      background: #2563eb;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    button:hover {
      background: #1d4ed8;
      transform: translateY(-1px);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${safeTitle}</h1>
    <div class="meta">Exported from PromptVault • ${new Date().toLocaleDateString(undefined, {month:"short",day:"numeric",year:"numeric"})}</div>
  </div>
  <div class="art-container">
    <pre id="asciiArtPre">${coloredArt}</pre>
  </div>
  <div class="actions">
    <button onclick="navigator.clipboard.writeText(document.getElementById('asciiArtPre').innerText).then(()=>alert('ASCII copied to clipboard!'))">📋 Copy ASCII Text</button>
  </div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, getAsciiExportFilename("html"));
  toast("Exported ASCII artwork as standalone .html file");
}

async function exportAsciiPng() {
  if (!currentAsciiArt) {
    toast("No ASCII artwork to export. Select an image first.", "error");
    return;
  }

  toast("Generating high-res PNG image...");

  const lines = currentAsciiArt.split("\n");
  const rows = lines.length;
  let maxCols = 0;
  for (const line of lines) {
    if (line.length > maxCols) maxCols = line.length;
  }
  if (maxCols === 0 || rows === 0) {
    toast("ASCII art is empty.", "error");
    return;
  }

  const fontSize = 14;
  const fontFamily = "'Courier New', monospace";
  const paddingX = 36;
  const paddingY = 40;
  const headerHeight = 44;

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = `bold ${fontSize}px ${fontFamily}`;
  const charWidth = measureCtx.measureText("M").width;
  const lineHeight = Math.round(fontSize * 1.15);

  const canvasWidth = Math.round(maxCols * charWidth + paddingX * 2);
  const canvasHeight = Math.round(rows * lineHeight + paddingY * 2 + headerHeight);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#090d16";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Border
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvasWidth - 2, canvasHeight - 2);

  // Header Title
  const promptTitle = ($("promptTitle")?.value || "PromptVault ASCII Artwork").trim();
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 13px system-ui, sans-serif`;
  ctx.fillText(promptTitle, paddingX, paddingY - 14);

  // Watermark
  ctx.fillStyle = "#475569";
  ctx.font = `500 11px system-ui, sans-serif`;
  const wmText = "PromptVault";
  const wmWidth = ctx.measureText(wmText).width;
  ctx.fillText(wmText, canvasWidth - paddingX - wmWidth, paddingY - 14);

  // Art box background
  ctx.fillStyle = "#020617";
  ctx.fillRect(paddingX - 12, paddingY + 6, maxCols * charWidth + 24, rows * lineHeight + 16);
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1;
  ctx.strokeRect(paddingX - 12, paddingY + 6, maxCols * charWidth + 24, rows * lineHeight + 16);

  // Draw ASCII characters
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "top";

  const safeColors = normalizeAsciiColors(currentAsciiColors);

  for (let y = 0; y < rows; y++) {
    const line = lines[y];
    const colorRow = safeColors[y] || "";
    const startY = paddingY + 14 + y * lineHeight;

    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      if (char === " ") continue;

      let color = "#cbd5e1";
      if (colorRow && typeof colorRow === "string") {
        const hex = colorRow.slice(x * 7, x * 7 + 7);
        if (/^#[0-9a-f]{6}$/i.test(hex)) {
          color = hex;
        }
      }

      ctx.fillStyle = color;
      ctx.fillText(char, paddingX + x * charWidth, startY);
    }
  }

  canvas.toBlob(blob => {
    if (!blob) {
      toast("Could not generate PNG graphic.", "error");
      return;
    }
    downloadBlob(blob, getAsciiExportFilename("png"));
    toast("Exported ASCII artwork as .png graphic");
  }, "image/png");
}


function readAsciiSettings(){
  return {
    width: Number($("asciiWidth").value || 72),
    brightness: Number($("asciiBrightness").value || 0),
    contrast: Number($("asciiContrast").value || 100),
    charset: $("asciiCharset").value || "detailed",
    invert: $("asciiInvert").checked
  };
}

// Firestore does not allow arrays nested inside arrays. Store each color row as a
// flat string (#rrggbb repeated), while still reading older nested-array backups.
function normalizeAsciiColors(colors=[]){
  if(!Array.isArray(colors)) return [];
  return colors.map(row=>{
    if(typeof row === "string") return row;
    if(Array.isArray(row)) return row.map(c=>/^#[0-9a-f]{6}$/i.test(String(c||""))?String(c):"#000000").join("");
    return "";
  });
}
function coloredAsciiHTML(art, colors=[], maxCols=Infinity){
  const safeColors=normalizeAsciiColors(colors);
  return String(art||"").split("\n").map((line,y)=>[...line].slice(0,maxCols).map((ch,x)=>{
    const row=safeColors[y]||"";
    const color=typeof row === "string" ? row.slice(x*7,x*7+7) : "";
    return color && /^#[0-9a-f]{6}$/i.test(color) ? `<span style="color:${color}">${escapeHTML(ch)}</span>` : escapeHTML(ch);
  }).join("")).join("\n");
}
function renderAsciiPreview(art, colors=[]){
  currentAsciiArt = art || ""; currentAsciiColors=Array.isArray(colors)?colors:[];
  const preview = $("imagePreview");
  preview.innerHTML = currentAsciiArt
    ? `<pre class="ascii-preview">${coloredAsciiHTML(currentAsciiArt,currentAsciiColors)}</pre>`
    : `<div class="ascii-empty"><span>▦</span><small>ASCII preview appears here</small></div>`;
}

async function imageFileToAscii(file, settings){
  if(!file) return "";
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, {imageOrientation:"from-image"});
  } catch {}
  let source, width, height;
  if(bitmap){
    source = bitmap; width = bitmap.width; height = bitmap.height;
  } else {
    const localUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve,reject)=>{
        const im = new Image();
        im.onload = ()=>resolve(im);
        im.onerror = ()=>reject(new Error("The selected image could not be read."));
        im.src = localUrl;
      });
      source = img; width = img.naturalWidth; height = img.naturalHeight;
    } finally {
      URL.revokeObjectURL(localUrl);
    }
  }
  const cols = Math.max(24, Math.min(120, Number(settings.width) || 72));
  // Monospace glyphs are taller than they are wide; 0.48 compensates for their aspect ratio.
  const rows = Math.max(8, Math.min(100, Math.round((height / Math.max(1,width)) * cols * 0.48)));
  const canvas = document.createElement("canvas");
  canvas.width = cols; canvas.height = rows;
  const ctx = canvas.getContext("2d", {willReadFrequently:true});
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,cols,rows);
  ctx.drawImage(source,0,0,cols,rows);
  if(bitmap) bitmap.close();
  const pixels = ctx.getImageData(0,0,cols,rows).data;
  const chars = ASCII_CHARSETS[settings.charset] || ASCII_CHARSETS.detailed;
  const lines = [], colorRows = [];
  const contrast = Math.max(0.2, Math.min(2, (Number(settings.contrast)||100)/100));
  const brightness = (Number(settings.brightness)||0) * 2.55;
  for(let y=0; y<rows; y++){
    let line = ""; const colorLine=[];
    for(let x=0; x<cols; x++){
      const i=(y*cols+x)*4;
      let gray = 0.2126*pixels[i] + 0.7152*pixels[i+1] + 0.0722*pixels[i+2];
      // Composite transparent pixels onto white to avoid black transparency artifacts.
      const alpha = pixels[i+3]/255;
      gray = gray*alpha + 255*(1-alpha);
      gray = Math.max(0,Math.min(255,(gray-128)*contrast+128+brightness));
      if(settings.invert) gray=255-gray;
      const idx=Math.max(0,Math.min(chars.length-1,Math.round((gray/255)*(chars.length-1))));
      line += chars[idx];
      const r=Math.round(pixels[i]*alpha+255*(1-alpha)), g=Math.round(pixels[i+1]*alpha+255*(1-alpha)), b=Math.round(pixels[i+2]*alpha+255*(1-alpha));
      colorLine.push(`#${[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("")}`);
    }
    lines.push(line.replace(/\s+$/,"")); colorRows.push(colorLine);
  }
  return {art:lines.join("\n"),colors:colorRows};
}

let asciiRenderToken = 0;
async function refreshAsciiFromSelectedFile(){
  if(!currentImageFile) return;
  const token=++asciiRenderToken;
  const settings=readAsciiSettings();
  currentAsciiSettings=settings;
  $("asciiStatus").textContent="Converting locally…";
  try{
    const result=await imageFileToAscii(currentImageFile,settings);
    if(token!==asciiRenderToken)return;
    renderAsciiPreview(result.art,result.colors);
    $("asciiStatus").textContent=`Preview ready · ${settings.width} columns · saved as text only`;
  }catch(err){
    console.error(err);
    $("asciiStatus").textContent="Could not convert this image.";
    toast("Could not convert the selected image.","error");
  }
}

function setAsciiControls(settings={}){
  const s={...{width:72,brightness:0,contrast:100,charset:"detailed",invert:false},...settings};
  $("asciiWidth").value=s.width;
  $("asciiBrightness").value=s.brightness;
  $("asciiContrast").value=s.contrast;
  $("asciiCharset").value=s.charset;
  $("asciiInvert").checked=!!s.invert;
  $("asciiWidthValue").textContent=s.width;
  $("asciiBrightnessValue").textContent=s.brightness;
  $("asciiContrastValue").textContent=s.contrast;
  currentAsciiSettings=s;
}

function clearAsciiEditor(){
  currentImageFile=null;
  currentAsciiArt=""; currentAsciiColors=[];
  setAsciiControls();
  renderAsciiPresetOptions("balanced");
  checkPresetCustomization();
  $("promptImage").value="";
  $("asciiStatus").textContent="Choose an image to create an ASCII preview.";
  renderAsciiPreview("");
}

async function deleteLegacyImageFiles(urls=[]){
  const unique=[...new Set(urls.filter(u=>typeof u==="string" && u.startsWith("https://")))];
  await Promise.allSettled(unique.map(url=>deleteObject(ref(storage,url))));
}

function openPrompt(id=null){
  $("promptForm").reset();$("promptId").value=id||"";
  $("promptModalTitle").textContent=id?"Edit prompt":"New prompt";
  clearAsciiEditor();
  if(id){
    const p=prompts.find(x=>x.id===id);
    if(!p)return;
    p.lastUsedAt=new Date(); updateDoc(doc(db,"users",user.uid,"prompts",id),{lastUsedAt:serverTimestamp()}).catch(()=>{});
    $("promptTitle").value=p.title||"";$("promptCategory").value=p.categoryId||categories[0]?.id||"";
    if($("promptCollection")) $("promptCollection").value=p.collectionId||"";
    $("promptTags").value=(p.tags||[]).join(", ");$("promptText").value=p.text||"";
    $("negativeText").value=p.negative||"";$("promptNotes").value=p.notes||"";$("promptModel").value=p.model||"";$("promptRatio").value=p.ratio||"";
    const versions = p.versions || [];
    if($("promptVersionsBtn")) {
      $("promptVersionsBtn").classList.toggle("hidden", versions.length === 0);
      if($("versionCountBadge")) $("versionCountBadge").textContent = versions.length;
      $("promptVersionsBtn").onclick = () => openVersionModal(p);
    }
    if(p.asciiArt){
      currentAsciiArt=p.asciiArt; currentAsciiColors=p.asciiColors||[];
      setAsciiControls(p.asciiSettings||{});
      renderAsciiPreview(p.asciiArt,p.asciiColors||[]);
      syncAsciiPresetToSettings(p.asciiSettings||{});
      $("asciiStatus").textContent="Saved ASCII text · select a new image to replace it";
    } else if(p.imageUrl){
      $("imagePreview").innerHTML=`<img class="legacy-image-preview" src="${escAttr(p.imageUrl)}" alt="Legacy image preview">`;
      $("asciiStatus").textContent="Legacy image found. Select it again to convert to ASCII and stop using image storage.";
    }
  }else {
    renderAsciiPresetOptions("balanced");
    checkPresetCustomization();
    if(categories[0])$("promptCategory").value=categories[0].id;
    if($("promptCollection")) $("promptCollection").value=activeCollection||"";
    if($("promptVersionsBtn")) $("promptVersionsBtn").classList.add("hidden");
  }
  $("promptModal").classList.remove("hidden");
}

function generateWordDiff(oldStr = "", newStr = "") {
  if (oldStr === newStr) return escapeHTML(newStr);
  const oldWords = String(oldStr).split(/(\s+)/);
  const newWords = String(newStr).split(/(\s+)/);
  const result = [];
  let i = 0, j = 0;
  while (i < oldWords.length && j < newWords.length) {
    if (oldWords[i] === newWords[j]) {
      result.push(escapeHTML(newWords[j]));
      i++; j++;
    } else {
      let foundInNew = -1;
      for (let k = j; k < Math.min(j + 6, newWords.length); k++) {
        if (newWords[k] === oldWords[i]) { foundInNew = k; break; }
      }
      if (foundInNew !== -1) {
        while (j < foundInNew) {
          result.push(`<ins class="diff-add">${escapeHTML(newWords[j])}</ins>`);
          j++;
        }
      } else {
        result.push(`<del class="diff-del">${escapeHTML(oldWords[i])}</del>`);
        i++;
      }
    }
  }
  while (i < oldWords.length) {
    result.push(`<del class="diff-del">${escapeHTML(oldWords[i])}</del>`);
    i++;
  }
  while (j < newWords.length) {
    result.push(`<ins class="diff-add">${escapeHTML(newWords[j])}</ins>`);
    j++;
  }
  return result.join("");
}

function openVersionModal(p) {
  const versions = [...(p.versions || [])].reverse();
  if (versions.length === 0) return toast("No previous versions recorded for this prompt.");

  $("versionModalSubtitle").textContent = `Viewing history for "${escapeHTML(p.title || "Untitled")}" (${versions.length} past version${versions.length === 1 ? "" : "s"}).`;
  const timeline = $("versionTimeline");
  const detail = $("versionDetailContent");

  function renderVersionDetail(ver) {
    const isCurrent = ver.version === "current";
    const verTitle = isCurrent ? "Current Version" : `Version #${ver.version}`;
    const verDate = isCurrent ? "Current editor draft" : fmtDate(ver.savedAt);

    detail.innerHTML = `
      <div class="version-diff-card">
        <div class="version-diff-title">
          <div>
            <strong>${escapeHTML(verTitle)}</strong>
            <small style="display:block;color:var(--muted);margin-top:2px">${verDate}</small>
          </div>
          ${!isCurrent ? `<button type="button" class="primary-btn compact-btn" id="restoreVerBtn">↺ Restore version #${ver.version}</button>` : ""}
        </div>
        <div style="margin:10px 0">
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Title comparison</label>
          <div style="font-size:12px;font-weight:600">${generateWordDiff(ver.title || "", p.title || "")}</div>
        </div>
        <div style="margin:12px 0">
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Prompt Text Diff (Red: removed from past version · Green: added in current)</label>
          <div class="diff-box">${generateWordDiff(ver.text || "", p.text || "")}</div>
        </div>
        ${ver.negative ? `
          <div style="margin:12px 0">
            <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Negative Prompt</label>
            <div class="diff-box" style="font-size:10px">${generateWordDiff(ver.negative || "", p.negative || "")}</div>
          </div>
        ` : ""}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;font-size:11px;color:var(--muted)">
          <div><strong>Model / Tool:</strong> ${escapeHTML(ver.model || "None")}</div>
          <div><strong>Aspect Ratio:</strong> ${escapeHTML(ver.ratio || "Default")}</div>
        </div>
      </div>
    `;

    const restoreBtn = $("restoreVerBtn");
    if (restoreBtn) {
      restoreBtn.onclick = () => {
        confirmAction(
          `Restore Version #${ver.version}?`,
          `Your current draft will be archived before restoring Version #${ver.version}. Click Confirm to load.`,
          () => {
            $("promptTitle").value = ver.title || "";
            $("promptText").value = ver.text || "";
            $("negativeText").value = ver.negative || "";
            $("promptNotes").value = ver.notes || "";
            $("promptModel").value = ver.model || "";
            $("promptRatio").value = ver.ratio || "";
            if (ver.categoryId) $("promptCategory").value = ver.categoryId;
            if ($("promptCollection")) $("promptCollection").value = ver.collectionId || "";
            if (ver.asciiArt) {
              currentAsciiArt = ver.asciiArt;
              currentAsciiColors = ver.asciiColors || [];
              if (ver.asciiSettings) setAsciiControls(ver.asciiSettings);
              renderAsciiPreview(ver.asciiArt, ver.asciiColors || []);
            }
            closeModal("versionModal");
            toast(`Version #${ver.version} loaded into editor. Click "Save prompt" to persist.`);
          }
        );
      };
    }
  }

  timeline.innerHTML = versions.map((v, i) => `
    <div class="version-item ${i === 0 ? "active" : ""}" data-ver-idx="${i}">
      <div class="version-item-head">
        <span>Version #${v.version}</span>
        <small>${fmtDate(v.savedAt)}</small>
      </div>
      <small style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(v.title || "Untitled")}</small>
    </div>
  `).join("");

  timeline.querySelectorAll(".version-item").forEach(item => {
    item.onclick = () => {
      timeline.querySelectorAll(".version-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      const idx = Number(item.dataset.verIdx);
      renderVersionDetail(versions[idx]);
    };
  });

  renderVersionDetail(versions[0]);
  $("versionModal").classList.remove("hidden");
}

$("promptForm").onsubmit=async e=>{
  e.preventDefault();
  const id=$("promptId").value;
  const old=id?prompts.find(p=>p.id===id):null;
  const settings=readAsciiSettings();
  if(currentImageFile && !currentAsciiArt){
    return toast("Please wait for the ASCII preview to finish.","error");
  }
  const base={
    title:$("promptTitle").value.trim(),
    categoryId:$("promptCategory").value,
    collectionId:$("promptCollection")?.value || "",
    tags:$("promptTags").value.split(",").map(x=>x.trim()).filter(Boolean),
    text:$("promptText").value.trim(),negative:$("negativeText").value.trim(),notes:$("promptNotes").value.trim(),
    model:$("promptModel").value.trim(),ratio:$("promptRatio").value.trim(),updatedAt:serverTimestamp()
  };
  if(currentAsciiArt){
    base.asciiArt=currentAsciiArt;
    base.asciiColors=normalizeAsciiColors(currentAsciiColors);
    base.asciiSettings=settings;
  } else if(old?.asciiArt){
    base.asciiArt=old.asciiArt;
    base.asciiColors=normalizeAsciiColors(old.asciiColors||[]);
    base.asciiSettings=old.asciiSettings||settings;
  }
  // Clear legacy image URLs from the document when the prompt is converted to ASCII.
  const shouldRemoveLegacyImages=!!(currentAsciiArt && old && (old.imageUrl||old.imageThumbUrl));
  if(shouldRemoveLegacyImages){
    base.imageUrl=deleteField();
    base.imageThumbUrl=deleteField();
  }
  try{
    if(id){
      if(!old)throw new Error("Prompt not found");
      // Preserve previous version in history before saving modifications
      const hasChanged = old.title !== base.title || old.text !== base.text || old.negative !== base.negative || old.notes !== base.notes || old.model !== base.model || old.ratio !== base.ratio || old.categoryId !== base.categoryId || (old.collectionId||"") !== base.collectionId;
      if(hasChanged){
        const prevVer = {
          version: (old.versions?.length || 0) + 1,
          savedAt: old.updatedAt ? (old.updatedAt.toDate ? old.updatedAt.toDate().toISOString() : new Date(old.updatedAt).toISOString()) : new Date().toISOString(),
          title: old.title || "",
          text: old.text || "",
          negative: old.negative || "",
          notes: old.notes || "",
          model: old.model || "",
          ratio: old.ratio || "",
          categoryId: old.categoryId || "",
          collectionId: old.collectionId || "",
          tags: old.tags || [],
          asciiArt: old.asciiArt || "",
          asciiColors: old.asciiColors || [],
          asciiSettings: old.asciiSettings || null
        };
        base.versions = [...(old.versions || []).slice(-14), prevVer];
      } else if(old.versions) {
        base.versions = old.versions;
      }
      await updateDoc(doc(db,"users",user.uid,"prompts",id),base);
      const localBase={...base};
      delete localBase.imageUrl; delete localBase.imageThumbUrl;
      Object.assign(old,localBase);
      if(shouldRemoveLegacyImages){
        await deleteLegacyImageFiles([old.imageUrl,old.imageThumbUrl]);
        delete old.imageUrl; delete old.imageThumbUrl;
      }
      closeModal("promptModal");renderAll();toast("Prompt updated. ASCII text saved; no image uploaded.");
    }else{
      base.favorite=false;base.copyCount=0;base.createdAt=serverTimestamp();base.versions=[];
      const newDoc=await addDoc(collection(db,"users",user.uid,"prompts"),base);
      const localPrompt={id:newDoc.id,...base,createdAt:new Date()};
      prompts.unshift(localPrompt);
      closeModal("promptModal");renderAll();toast(currentAsciiArt?"Prompt saved with ASCII preview only.":"Prompt saved.");
    }
  }catch(err){
    console.error("PromptVault save prompt failed:",err);
    const code=err?.code ? ` (${err.code})` : "";
    const detail=err?.code==="permission-denied" ? "Firestore Rules denied the write. Publish the matching rules for prompt-save-6f510." :
      err?.code==="unauthenticated" ? "Please sign out and sign in again." :
      /nested arrays/i.test(err?.message||"") ? "ASCII color data format was invalid. Reopen the prompt and save again." :
      (err?.message||"Unknown Firebase error");
    toast(`Could not save prompt${code}: ${detail}`,"error");
  }
};

$("promptImage").onchange=async e=>{
  const file=e.target.files[0];
  if(!file)return;
  currentImageFile=file;
  currentAsciiArt="";
  $("asciiStatus").textContent="Converting image locally…";
  await refreshAsciiFromSelectedFile();
};
["asciiWidth","asciiBrightness","asciiContrast","asciiCharset","asciiInvert"].forEach(id=>{
  $(id).addEventListener("input",()=>{
    $("asciiWidthValue").textContent=$("asciiWidth").value;
    $("asciiBrightnessValue").textContent=$("asciiBrightness").value;
    $("asciiContrastValue").textContent=$("asciiContrast").value;
    checkPresetCustomization();
    if(currentImageFile)refreshAsciiFromSelectedFile();
  });
});
if ($("asciiPresetSelect")) {
  $("asciiPresetSelect").addEventListener("change", e => {
    applyAsciiPreset(e.target.value);
  });
}
if ($("saveCustomPresetBtn")) $("saveCustomPresetBtn").onclick = promptSaveCustomPreset;
if ($("clearAsciiBtn")) $("clearAsciiBtn").onclick = clearAsciiEditor;
if ($("exportAsciiTxtBtn")) $("exportAsciiTxtBtn").onclick = exportAsciiTxt;
if ($("exportAsciiHtmlBtn")) $("exportAsciiHtmlBtn").onclick = exportAsciiHtml;
if ($("exportAsciiPngBtn")) $("exportAsciiPngBtn").onclick = exportAsciiPng;

async function deletePrompt(id){
  const p=prompts.find(x=>x.id===id);if(!p)return;
  confirmAction("Delete prompt?",`“${p.title}” will be removed from your library.`,async()=>{
    try{await deleteDoc(doc(db,"users",user.uid,"prompts",id));prompts=prompts.filter(x=>x.id!==id);renderAll();toast("Prompt deleted.");}
    catch(err){toast("Could not delete prompt.","error");}
  });
}

function notePlainText(html="") { const el=document.createElement("div"); el.innerHTML=String(html); return (el.textContent||el.innerText||"").replace(/\s+/g," ").trim(); }
function sanitizeNoteHtml(html="") {
  const box=document.createElement("div");
  const looksHtml=/<[a-z][\s\S]*>/i.test(String(html));
  box.innerHTML=looksHtml?String(html):escapeHTML(String(html)).replace(/\n/g,"<br>");
  const allowed=new Set(["B","STRONG","I","EM","U","BR","P","DIV","UL","OL","LI","H1","H2","H3","BLOCKQUOTE"]);
  const walk=node=>[...node.childNodes].forEach(child=>{
    if(child.nodeType===Node.ELEMENT_NODE){
      if(!allowed.has(child.tagName)){child.replaceWith(...child.childNodes);return;}
      [...child.attributes].forEach(a=>{
        if(a.name==="style" && /^(text-align:\s*(left|center|right|justify)\s*;?)$/i.test(a.value) && ["P","DIV","H1","H2","H3","BLOCKQUOTE"].includes(child.tagName)) child.setAttribute("style",a.value.replace(/\s+/g," ").trim());
        else child.removeAttribute(a.name);
      }); walk(child);
    } else if(child.nodeType!==Node.TEXT_NODE){child.remove();}
  });
  walk(box); return box.innerHTML;
}
function renderNotes(){
  const gallery=$("notesGallery");
  gallery.innerHTML=notes.map(n=>`<article class="note-gallery-card" data-note-id="${escAttr(n.id)}"><button class="note-card-delete" data-delete-note="${escAttr(n.id)}" title="Delete note" aria-label="Delete note">×</button><button class="note-card-open" data-open-note="${escAttr(n.id)}"><span class="note-card-icon">▤</span><strong>${escapeHTML(n.title||"Untitled note")}</strong><span class="note-card-preview">${escapeHTML(notePlainText(n.body||"").slice(0,150)||"Empty note")}</span><small>${fmtDate(n.updatedAt)}</small></button></article>`).join("");
  gallery.classList.toggle("hidden",noteEditorOpen);
  $("noteEditorPanel").classList.toggle("hidden",!noteEditorOpen);
  gallery.querySelectorAll("[data-open-note]").forEach(b=>b.onclick=()=>selectNote(b.dataset.openNote));
  gallery.querySelectorAll("[data-delete-note]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteNote(b.dataset.deleteNote);});
  if(!notes.length&&!noteEditorOpen)gallery.innerHTML='<div class="empty-state"><div>▤</div><h3>No notes yet</h3><p>Create a note to start collecting your ideas.</p></div>';
}
function selectNote(id){
  const n=notes.find(x=>x.id===id);if(!n)return;
  currentNoteId=id;noteEditorOpen=true;
  $("noteTitle").value=n.title||"";$("noteBody").innerHTML=sanitizeNoteHtml(n.body||"");$("noteStatus").textContent="Saved";renderNotes();
}
async function saveNote(){
  const title=$("noteTitle").value.trim()||"Untitled note",body=sanitizeNoteHtml($("noteBody").innerHTML);
  if(!title&&!notePlainText(body))return toast("Write something before saving.","error");
  try{
    if(currentNoteId){
      await updateDoc(doc(db,"users",user.uid,"notes",currentNoteId),{title,body,updatedAt:serverTimestamp()});
      Object.assign(notes.find(n=>n.id===currentNoteId),{title,body,updatedAt:new Date()});
    }else{
      const d=await addDoc(collection(db,"users",user.uid,"notes"),{title,body,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      currentNoteId=d.id;notes.unshift({id:d.id,title,body,createdAt:new Date(),updatedAt:new Date()});
    }
    $("noteStatus").textContent="Saved just now";renderNotes();toast("Note saved.");
  }catch(err){console.error(err);toast("Could not save note.","error");}
}
async function deleteNote(id){
  const n=notes.find(x=>x.id===id);if(!n)return;
  confirmAction("Delete note?",`“${n.title||"Untitled note"}” will be permanently deleted.`,async()=>{
    try{await deleteDoc(doc(db,"users",user.uid,"notes",id));notes=notes.filter(x=>x.id!==id);if(currentNoteId===id){currentNoteId=null;noteEditorOpen=false;}renderNotes();toast("Note deleted.");}
    catch(err){toast("Could not delete note.","error");}
  });
}
$("saveNoteBtn").onclick=saveNote;
function createNewNote(){currentNoteId=null;noteEditorOpen=true;$("noteTitle").value="";$("noteBody").innerHTML="";$("noteStatus").textContent="New note";setView("notes");$("noteTitle").focus();}
$("newNoteBtn").onclick=createNewNote;$("newNoteBtnPage").onclick=createNewNote;
$("backToNotes").onclick=()=>{noteEditorOpen=false;currentNoteId=null;renderNotes();};
$("noteToPrompt").onclick=()=>{openPrompt();$("promptTitle").value=$("noteTitle").value;$("promptText").value=notePlainText($("noteBody").innerHTML);};
$("noteTitle").oninput=$("noteBody").oninput=()=>{$("noteStatus").textContent="Unsaved changes";};
qsa(".note-toolbar [data-command]").forEach(b=>b.onclick=()=>{document.execCommand(b.dataset.command,false,null);$("noteBody").focus();$("noteStatus").textContent="Unsaved changes";});
qsa(".note-toolbar [data-align]").forEach(b=>b.onclick=()=>{document.execCommand("justify"+b.dataset.align,false,null);$("noteBody").focus();$("noteStatus").textContent="Unsaved changes";});

function setView(view){
  activeView=view;
  if(view==="favorites"){activeCategory="";favoritesOnly=true;}
  else if(view==="recent"){activeCategory="";favoritesOnly=false;}
  else if(view==="prompts"){favoritesOnly=false;}
  const page=(view==="favorites"||view==="recent")?"prompts":view;
  qsa(".page-view").forEach(v=>v.classList.add("hidden"));
  $(page+"View")?.classList.remove("hidden");
  qsa(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("sidebar").classList.remove("open");$("sidebarOverlay").classList.remove("show");
  if(page==="prompts")renderLibrary();
  if(view==="notes")renderNotes();
}
qsa(".nav-item[data-view]").forEach(b=>b.onclick=()=>{if(b.dataset.view==="notes"){noteEditorOpen=false;currentNoteId=null;}setView(b.dataset.view);});
qsa("[data-view-link]").forEach(b=>b.onclick=()=>setView(b.dataset.viewLink));
$("newPromptBtn").onclick=()=>openPrompt();
$("emptyNewPrompt").onclick=()=>openPrompt();
$("addCategoryBtn").onclick=()=>{$("categoryModal").classList.remove("hidden");setTimeout(()=>$("categoryName").focus(),50);};

async function deleteCategory(id){
  const cat=categories.find(c=>c.id===id); if(!cat)return;
  confirmAction("Delete category?",`Prompts in “${cat.name}” will be moved to Uncategorized. The prompts themselves will not be deleted.`,async()=>{
    try{
      const affected=prompts.filter(p=>p.categoryId===id);
      await Promise.all(affected.map(p=>updateDoc(doc(db,"users",user.uid,"prompts",p.id),{categoryId:""})));
      await deleteDoc(doc(db,"users",user.uid,"categories",id));
      prompts.forEach(p=>{if(p.categoryId===id)p.categoryId="";});
      categories=categories.filter(c=>c.id!==id); if(activeCategory===id)activeCategory="";
      renderAll();toast("Category deleted.");
    }catch(err){console.error(err);toast("Could not delete category. Check Firestore rules.","error");}
  });
}

$("categoryForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await addDoc(collection(db,"users",user.uid,"categories"),{name:$("categoryName").value.trim(),color:$("categoryColor").value,createdAt:serverTimestamp()});
    categories.push({id:d.id,name:$("categoryName").value.trim(),color:$("categoryColor").value});
    closeModal("categoryModal");e.target.reset();renderAll();toast("Category created.");
  }catch(err){toast("Could not create category.","error");}
};

async function deleteCollection(id){
  const col=collections.find(c=>c.id===id); if(!col)return;
  confirmAction("Delete collection?",`Prompts in “${col.name}” will remain saved in your library and will simply be unassigned from this collection.`,async()=>{
    try{
      const affected=prompts.filter(p=>p.collectionId===id);
      await Promise.all(affected.map(p=>updateDoc(doc(db,"users",user.uid,"prompts",p.id),{collectionId:""})));
      await deleteDoc(doc(db,"users",user.uid,"collections",id));
      prompts.forEach(p=>{if(p.collectionId===id)p.collectionId="";});
      collections=collections.filter(c=>c.id!==id); if(activeCollection===id)activeCollection="";
      renderAll();toast("Collection deleted. Prompts were kept safe.");
    }catch(err){console.error(err);toast("Could not delete collection. Check Firestore rules.","error");}
  });
}

if($("addCollectionBtn")){
  $("addCollectionBtn").onclick=()=>{
    $("collectionForm").reset();
    $("collectionId").value="";
    $("collectionModalTitle").textContent="New collection";
    $("collectionModal").classList.remove("hidden");
    setTimeout(()=>$("collectionName").focus(),50);
  };
}

$("collectionForm").onsubmit=async e=>{
  e.preventDefault();
  const id=$("collectionId").value;
  const name=$("collectionName").value.trim();
  const desc=$("collectionDesc").value.trim();
  const color=$("collectionColor").value;
  if(!name)return toast("Collection name is required.","error");
  try{
    if(id){
      await updateDoc(doc(db,"users",user.uid,"collections",id),{name,desc,color,updatedAt:serverTimestamp()});
      const local=collections.find(c=>c.id===id);
      if(local) Object.assign(local,{name,desc,color,updatedAt:new Date()});
      toast("Collection updated.");
    }else{
      const d=await addDoc(collection(db,"users",user.uid,"collections"),{name,desc,color,createdAt:serverTimestamp()});
      collections.push({id:d.id,name,desc,color,createdAt:new Date()});
      toast("Collection created.");
    }
    closeModal("collectionModal");e.target.reset();renderAll();
  }catch(err){console.error(err);toast("Could not save collection. Check Firestore rules.","error");}
};

$("categoryFilter").onchange=e=>{activeCategory=e.target.value;renderLibrary();};
if($("collectionFilter")) $("collectionFilter").onchange=e=>{activeCollection=e.target.value;renderLibrary();};
if($("modelFilter")) $("modelFilter").onchange=e=>{activeModelFilter=e.target.value;renderLibrary();};
if($("dateFilter")) $("dateFilter").onchange=e=>{activeDateFilter=e.target.value;renderLibrary();};
$("sortFilter").onchange=renderLibrary;
$("favoritesOnly").onclick=()=>{favoritesOnly=!favoritesOnly;activeView="prompts";renderLibrary();};
if($("recentUsedOnly")) $("recentUsedOnly").onclick=()=>{recentUsedOnly=!recentUsedOnly;activeView="prompts";renderLibrary();};
if($("resetFiltersBtn")) $("resetFiltersBtn").onclick=resetAllFilters;
if($("emptyResetFilters")) $("emptyResetFilters").onclick=resetAllFilters;
if($("clearSearchBtn")) $("clearSearchBtn").onclick=()=>{ $("globalSearch").value=""; $("clearSearchBtn").classList.add("hidden"); $("globalSearch").focus(); if(activeView!=="prompts")setView("prompts"); else renderLibrary(); };
$("globalSearch").oninput=()=>{
  if($("clearSearchBtn")) $("clearSearchBtn").classList.toggle("hidden",!$("globalSearch").value.trim());
  if(activeView!=="prompts")setView("prompts");
  else renderLibrary();
};
$("gridMode").onclick=()=>{listMode=false;$("gridMode").classList.add("active");$("listMode").classList.remove("active");renderLibrary();};
$("listMode").onclick=()=>{listMode=true;$("listMode").classList.add("active");$("gridMode").classList.remove("active");renderLibrary();};

function closeModal(id){$(id).classList.add("hidden");}
qsa("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
qsa(".modal-backdrop").forEach(b=>b.onclick=()=>b.parentElement.classList.add("hidden"));

function confirmAction(title,text,fn){$("confirmTitle").textContent=title;$("confirmText").textContent=text;$("confirmModal").classList.remove("hidden");$("confirmOk").onclick=async()=>{closeModal("confirmModal");await fn();};$("confirmCancel").onclick=()=>closeModal("confirmModal");}

$("logoutBtn").onclick=$("menuLogout").onclick=$("settingsLogout").onclick=async()=>{await signOut(auth);};
$("profileBtn").onclick=()=>{$("profileMenu").classList.toggle("hidden");};
document.addEventListener("click",e=>{if(!$("profileBtn").contains(e.target)&&!$("profileMenu").contains(e.target))$("profileMenu").classList.add("hidden");});
$("menuSettings").onclick=$("settingsBtn").onclick=()=>{setView("settings");$("profileMenu").classList.add("hidden");};

function applyTheme(){
  const dark=localStorage.getItem("pv-theme")==="dark";
  document.documentElement.classList.toggle("dark",dark);$("themeBtn").textContent=dark?"☀":"☾";
}
function toggleTheme(){localStorage.setItem("pv-theme",document.documentElement.classList.contains("dark")?"light":"dark");applyTheme();}
$("themeBtn").onclick=toggleTheme;$("settingsThemeBtn").onclick=toggleTheme;applyTheme();

$("saveProfileBtn").onclick=async()=>{
  const name=$("settingsName").value.trim();if(!name)return;
  try{await updateProfile(auth.currentUser,{displayName:name});await setDoc(doc(db,"users",user.uid),{name},{merge:true});renderUser();toast("Profile updated.");}
  catch(err){toast("Could not update profile.","error");}
};

function jsonSafeRecord(record){
  const out={};
  for(const [key,value] of Object.entries(record||{})){
    if(value&&typeof value.toDate==="function")out[key]=value.toDate().toISOString();
    else if(value instanceof Date)out[key]=value.toISOString();
    else out[key]=value;
  }
  return out;
}
function exportData(){
  const data={version:3,exportedAt:new Date().toISOString(),categories:categories.map(jsonSafeRecord),collections:collections.map(jsonSafeRecord),prompts:prompts.map(jsonSafeRecord),notes:notes.map(jsonSafeRecord)};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`promptvault-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast("Backup exported.");
}
$("exportBtn").onclick=exportData;$("quickImportBtn").onclick=$("settingsImportBtn").onclick=()=>$("importFile").click();
$("importFile").onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const data=JSON.parse(await f.text());
    if(!Array.isArray(data.prompts))throw new Error("Invalid backup");
    for(const c of (data.categories||[])){const {id,...payload}=c; if(id)await setDoc(doc(db,"users",user.uid,"categories",id),{...payload,createdAt:payload.createdAt||serverTimestamp()},{merge:true});else await addDoc(collection(db,"users",user.uid,"categories"),{...payload,createdAt:serverTimestamp()});}
    for(const col of (data.collections||[])){const {id,...payload}=col; if(id)await setDoc(doc(db,"users",user.uid,"collections",id),{...payload,createdAt:payload.createdAt||serverTimestamp()},{merge:true});else await addDoc(collection(db,"users",user.uid,"collections"),{...payload,createdAt:serverTimestamp()});}
    for(const p of data.prompts){const {id,...payload}=p; if(payload.asciiColors)payload.asciiColors=normalizeAsciiColors(payload.asciiColors); const record={...payload,createdAt:payload.createdAt||serverTimestamp(),updatedAt:serverTimestamp()}; if(id)await setDoc(doc(db,"users",user.uid,"prompts",id),record,{merge:true});else await addDoc(collection(db,"users",user.uid,"prompts"),record);}
    for(const n of (data.notes||[])){const {id,...payload}=n; const record={...payload,createdAt:payload.createdAt||serverTimestamp(),updatedAt:serverTimestamp()}; if(id)await setDoc(doc(db,"users",user.uid,"notes",id),record,{merge:true});else await addDoc(collection(db,"users",user.uid,"notes"),record);}
    await loadAll();toast("Backup imported.");
  }catch(err){toast("Invalid or incompatible JSON backup.","error");}
  e.target.value="";
};

$("menuBtn").onclick=()=>{$("sidebar").classList.add("open");$("sidebarOverlay").classList.add("show");};
$("closeSidebar").onclick=()=>{$("sidebar").classList.remove("open");$("sidebarOverlay").classList.remove("show");};
$("sidebarOverlay").onclick=$("closeSidebar").onclick;

document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();$("globalSearch").focus();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="n"){e.preventDefault();openPrompt();}
  if(e.key==="Escape"){qsa(".modal:not(.hidden)").forEach(m=>m.classList.add("hidden"));$("profileMenu").classList.add("hidden");}
});

// --- PWA Installation & Service Worker Integration ---
let deferredInstallPrompt = null;
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

function updatePwaUI() {
  const installSidebar = $("installAppSidebarBtn");
  const installBtn = $("pwaInstallBtn");
  const statusText = $("pwaStatusText");
  const swStatus = $("swStatusText");

  if (isStandalone) {
    if (installSidebar) installSidebar.classList.add("hidden");
    if (installBtn) {
      installBtn.disabled = true;
      installBtn.textContent = "Installed";
    }
    if (statusText) statusText.innerHTML = '<span class="pwa-badge-installed">✓ Running in Standalone App Mode</span>';
  } else if (deferredInstallPrompt) {
    if (installSidebar) installSidebar.classList.remove("hidden");
    if (installBtn) {
      installBtn.disabled = false;
      installBtn.textContent = "Install App";
    }
    if (statusText) statusText.textContent = "App is ready to install on your computer or phone.";
  } else {
    if (installBtn) {
      installBtn.disabled = false;
      installBtn.textContent = "Install App";
    }
    if (statusText) statusText.textContent = "Use Chrome / Edge install icon or browser menu to install.";
  }

  if (swStatus) {
    if ("serviceWorker" in navigator) {
      if (navigator.serviceWorker.controller) {
        swStatus.textContent = "Active — Offline caching enabled (Shell v2).";
      } else {
        swStatus.textContent = "Service worker registered. Offline cache ready.";
      }
    } else {
      swStatus.textContent = "Service Worker is not supported in this browser.";
    }
  }
}

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updatePwaUI();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updatePwaUI();
  toast("PromptVault installed successfully! 🎉");
});

async function triggerInstallFlow() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") {
      toast("Installing PromptVault...");
    }
    deferredInstallPrompt = null;
    updatePwaUI();
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    toast("On iOS: Tap Safari Share (⎋) then 'Add to Home Screen' (+)", "ok");
  } else {
    toast("Look for the Install icon (⊕) in your browser address bar.", "ok");
  }
}

if ($("installAppSidebarBtn")) $("installAppSidebarBtn").onclick = triggerInstallFlow;
if ($("pwaInstallBtn")) $("pwaInstallBtn").onclick = triggerInstallFlow;

if ($("swUpdateBtn")) {
  $("swUpdateBtn").onclick = async () => {
    if ("serviceWorker" in navigator && window.__swRegistration) {
      try {
        await window.__swRegistration.update();
        toast("Checked for updates. You are on the latest version.");
      } catch (err) {
        toast("Could not check update. Check network connection.", "error");
      }
    } else {
      toast("Service worker is not active yet.");
    }
  };
}

window.addEventListener("pwa-update-available", () => {
  toast("New version available! Refresh to update.", "ok");
});

function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  const banner = $("offlineIndicator");
  if (banner) {
    banner.classList.toggle("hidden", isOnline);
  }
}
window.addEventListener("online", () => {
  updateOnlineStatus();
  toast("You are back online! 🟢", "ok");
});
window.addEventListener("offline", () => {
  updateOnlineStatus();
  toast("You are currently offline. Working from local cache.", "error");
});
updateOnlineStatus();

updatePwaUI();

showAuth("login");