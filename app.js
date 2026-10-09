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
let user = null, prompts = [], categories = [], notes = [], currentNoteId = null, noteEditorOpen = false;
let activeView = "dashboard", activeCategory = "", favoritesOnly = false, listMode = false;
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
    const [p,c,n]=await Promise.all([
      getDocs(query(collection(db,"users",user.uid,"prompts"),orderBy("createdAt","desc"))),
      getDocs(query(collection(db,"users",user.uid,"categories"),orderBy("name"))),
      getDocs(query(collection(db,"users",user.uid,"notes"),orderBy("updatedAt","desc")))
    ]);
    prompts=p.docs.map(d=>({id:d.id,...d.data()}));
    categories=c.docs.map(d=>({id:d.id,...d.data()}));
    notes=n.docs.map(d=>({id:d.id,...d.data()}));
    renderAll();
  }catch(err){console.error(err);toast("Could not load your workspace. Check Firestore setup.","error");}
}

function renderUser(){
  const name=user.displayName||user.email?.split("@")[0]||"User";
  $("profileName").textContent=name; $("menuName").textContent=name; $("menuEmail").textContent=user.email||"";
  $("avatar").textContent=initials(name); $("helloName").textContent=name.split(" ")[0];
  $("settingsName").value=name; $("settingsEmail").value=user.email||"";
}

function renderAll(){renderCategories();renderStats();renderDashboard();renderLibrary();renderNotes();fillCategorySelects();}
function renderCategories(){
  const nav=$("categoryNav");
  nav.innerHTML=categories.map(c=>`<div class="category-nav-wrap"><button class="category-nav" data-cat="${escAttr(c.id)}"><i class="dot ${c.color||"orange"}"></i><span>${escapeHTML(c.name)}</span><em>${prompts.filter(p=>p.categoryId===c.id).length}</em></button><button class="category-delete" data-delete-category="${escAttr(c.id)}" title="Delete category" aria-label="Delete ${escAttr(c.name)}">×</button></div>`).join("");
  nav.querySelectorAll(".category-nav").forEach(b=>b.onclick=()=>{activeCategory=b.dataset.cat;favoritesOnly=false;setView("prompts");$("categoryFilter").value=activeCategory;renderLibrary();});
  nav.querySelectorAll("[data-delete-category]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteCategory(b.dataset.deleteCategory);});
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
function fillCategorySelects(){
  const opts=categories.map(c=>`<option value="${escAttr(c.id)}">${escapeHTML(c.name)}</option>`).join("");
  $("categoryFilter").innerHTML=`<option value="">All categories</option>${opts}`;
  $("promptCategory").innerHTML=opts;
  if(activeCategory)$("categoryFilter").value=activeCategory;
}
function getFilteredPrompts(){
  let arr=[...prompts], search=$("globalSearch").value.trim().toLowerCase();
  if(activeCategory)arr=arr.filter(p=>p.categoryId===activeCategory);
  if(activeView==="favorites"||favoritesOnly)arr=arr.filter(p=>p.favorite);
  if(activeView==="recent")arr=arr.filter(p=>p.lastUsedAt).sort((a,b)=>dateValue(b.lastUsedAt)-dateValue(a.lastUsedAt));
  if(search)arr=arr.filter(p=>(`${p.title} ${p.text} ${p.negative||""} ${p.notes||""} ${(p.tags||[]).join(" ")}`).toLowerCase().includes(search));
  const sort=$("sortFilter").value;
  if(activeView!=="recent"){
    if(sort==="oldest")arr.reverse();
    if(sort==="used")arr.sort((a,b)=>(b.copyCount||0)-(a.copyCount||0));
    if(sort==="title")arr.sort((a,b)=>(a.title||"").localeCompare(b.title||""));
  }
  return arr;
}
function promptCard(p){
  const cat=categories.find(c=>c.id===p.categoryId);
  const image=p.asciiArt
    ? `<pre class="ascii-card-art" aria-label="ASCII art preview">${coloredAsciiHTML(p.asciiArt,p.asciiColors)}</pre>`
    : ((p.imageThumbUrl||p.imageUrl)
      ? `<img src="${escAttr(p.imageThumbUrl||p.imageUrl)}" alt="Legacy reference image" loading="lazy" decoding="async">`
      : `<div class="image-placeholder"><span>ASCII</span></div>`);
  return `<article class="prompt-card ${listMode?"list-card":""}" data-id="${p.id}">
    <div class="prompt-image">${image}<button class="star-btn ${p.favorite?"on":""}" data-action="favorite" title="Favorite">★</button></div>
    <div class="prompt-card-body">
      <div class="card-meta"><span class="category-pill ${cat?.color||"orange"}">${escapeHTML(cat?.name||"Uncategorized")}</span><span>${fmtDate(p.createdAt)}</span></div>
      <h3>${escapeHTML(p.title||"Untitled")}</h3>
      <p class="prompt-preview">${escapeHTML(p.text||"").slice(0,180)}${(p.text||"").length>180?"…":""}</p>
      <div class="tags">${(p.tags||[]).slice(0,4).map(t=>`<span>#${escapeHTML(t)}</span>`).join("")}</div>
      <div class="card-actions"><button class="copy-btn" data-action="copy">▣ Copy prompt</button><button class="icon-btn" data-action="edit" title="Edit">✎</button><button class="icon-btn" data-action="delete" title="Delete">⌫</button></div>
    </div>
  </article>`;
}
function renderLibrary(){
  $("favoritesOnly").classList.toggle("active",favoritesOnly||activeView==="favorites");
  const arr=getFilteredPrompts();
  $("libraryGrid").className=`prompt-grid ${listMode?"list-view":""}`;
  $("libraryGrid").innerHTML=arr.map(promptCard).join("");
  $("libraryEmpty").classList.toggle("hidden",arr.length>0);
  $("libraryTitle").textContent=activeCategory?(categories.find(c=>c.id===activeCategory)?.name||"Category"):(activeView==="favorites"||favoritesOnly?"Favorites":activeView==="recent"?"Recently Used":"All prompts");
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

function readAsciiSettings(){
  return {
    width: Number($("asciiWidth").value || 72),
    brightness: Number($("asciiBrightness").value || 0),
    contrast: Number($("asciiContrast").value || 100),
    charset: $("asciiCharset").value || "detailed",
    invert: $("asciiInvert").checked
  };
}

function coloredAsciiHTML(art, colors=[], maxCols=Infinity){
  return String(art||"").split("\n").map((line,y)=>[...line].slice(0,maxCols).map((ch,x)=>{
    const color=colors?.[y]?.[x];
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
    $("promptTags").value=(p.tags||[]).join(", ");$("promptText").value=p.text||"";
    $("negativeText").value=p.negative||"";$("promptNotes").value=p.notes||"";$("promptModel").value=p.model||"";$("promptRatio").value=p.ratio||"";
    if(p.asciiArt){
      currentAsciiArt=p.asciiArt; currentAsciiColors=p.asciiColors||[];
      setAsciiControls(p.asciiSettings||{});
      renderAsciiPreview(p.asciiArt,p.asciiColors||[]);
      $("asciiStatus").textContent="Saved ASCII text · select a new image to replace it";
    } else if(p.imageUrl){
      $("imagePreview").innerHTML=`<img class="legacy-image-preview" src="${escAttr(p.imageUrl)}" alt="Legacy image preview">`;
      $("asciiStatus").textContent="Legacy image found. Select it again to convert to ASCII and stop using image storage.";
    }
  }else if(categories[0])$("promptCategory").value=categories[0].id;
  $("promptModal").classList.remove("hidden");
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
    title:$("promptTitle").value.trim(),categoryId:$("promptCategory").value,
    tags:$("promptTags").value.split(",").map(x=>x.trim()).filter(Boolean),
    text:$("promptText").value.trim(),negative:$("negativeText").value.trim(),notes:$("promptNotes").value.trim(),
    model:$("promptModel").value.trim(),ratio:$("promptRatio").value.trim(),updatedAt:serverTimestamp()
  };
  if(currentAsciiArt){
    base.asciiArt=currentAsciiArt;
    base.asciiColors=currentAsciiColors;
    base.asciiSettings=settings;
  } else if(old?.asciiArt){
    base.asciiArt=old.asciiArt;
    base.asciiColors=old.asciiColors||[];
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
      base.favorite=false;base.copyCount=0;base.createdAt=serverTimestamp();
      const newDoc=await addDoc(collection(db,"users",user.uid,"prompts"),base);
      const localPrompt={id:newDoc.id,...base,createdAt:new Date()};
      prompts.unshift(localPrompt);
      closeModal("promptModal");renderAll();toast(currentAsciiArt?"Prompt saved with ASCII preview only.":"Prompt saved.");
    }
  }catch(err){
    console.error(err);toast("Could not save prompt. Check Firebase setup and Rules.","error");
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
    if(currentImageFile)refreshAsciiFromSelectedFile();
  });
});
$("clearAsciiBtn").onclick=clearAsciiEditor;

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

$("categoryFilter").onchange=e=>{activeCategory=e.target.value;renderLibrary();};
$("sortFilter").onchange=renderLibrary;
$("favoritesOnly").onclick=()=>{favoritesOnly=!favoritesOnly;activeView="prompts";$("favoritesOnly").classList.toggle("active",favoritesOnly);renderLibrary();};
$("globalSearch").oninput=()=>{if(activeView!=="prompts")setView("prompts");else renderLibrary();};
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
  const data={version:2,exportedAt:new Date().toISOString(),categories:categories.map(jsonSafeRecord),prompts:prompts.map(jsonSafeRecord),notes:notes.map(jsonSafeRecord)};
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
    for(const p of data.prompts){const {id,...payload}=p; const record={...payload,createdAt:payload.createdAt||serverTimestamp(),updatedAt:serverTimestamp()}; if(id)await setDoc(doc(db,"users",user.uid,"prompts",id),record,{merge:true});else await addDoc(collection(db,"users",user.uid,"prompts"),record);}
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

showAuth("login");