import {
  auth, db, storage, setPersistence, browserLocalPersistence, browserSessionPersistence
} from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  collection, doc, addDoc, setDoc, getDocs, getDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const qsa = s => [...document.querySelectorAll(s)];
let user = null, prompts = [], categories = [], notes = [], currentNoteId = null;
let activeView = "dashboard", activeCategory = "", favoritesOnly = false, listMode = false;

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
  nav.innerHTML=categories.map(c=>`<button class="category-nav" data-cat="${escAttr(c.id)}"><i class="dot ${c.color||"orange"}"></i><span>${escapeHTML(c.name)}</span><em>${prompts.filter(p=>p.categoryId===c.id).length}</em></button>`).join("");
  nav.querySelectorAll(".category-nav").forEach(b=>b.onclick=()=>{activeCategory=b.dataset.cat;activeView="prompts";setView("prompts");});
}
function renderStats(){
  $("statPrompts").textContent=prompts.length;
  $("statCategories").textContent=categories.length;
  $("statFavorites").textContent=prompts.filter(p=>p.favorite).length;
  $("statCopied").textContent=prompts.reduce((a,p)=>a+(p.copyCount||0),0);
}
function renderDashboard(){
  const recent=prompts.slice(0,8); $("recentGrid").innerHTML=recent.map(promptCard).join("");
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
  if(favoritesOnly)arr=arr.filter(p=>p.favorite);
  if(search)arr=arr.filter(p=>(`${p.title} ${p.text} ${p.negative||""} ${p.notes||""} ${(p.tags||[]).join(" ")}`).toLowerCase().includes(search));
  const sort=$("sortFilter").value;
  if(sort==="oldest")arr.reverse();
  if(sort==="used")arr.sort((a,b)=>(b.copyCount||0)-(a.copyCount||0));
  if(sort==="title")arr.sort((a,b)=>(a.title||"").localeCompare(b.title||""));
  return arr;
}
function promptCard(p){
  const cat=categories.find(c=>c.id===p.categoryId);
  const image=(p.imageThumbUrl||p.imageUrl)?`<img src="${escAttr(p.imageThumbUrl||p.imageUrl)}" alt="" loading="lazy" decoding="async">`:`<div class="image-placeholder"><span>✦</span></div>`;
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
  const arr=getFilteredPrompts();
  $("libraryGrid").className=`prompt-grid ${listMode?"list-view":""}`;
  $("libraryGrid").innerHTML=arr.map(promptCard).join("");
  $("libraryEmpty").classList.toggle("hidden",arr.length>0);
  $("libraryTitle").textContent=activeCategory?(categories.find(c=>c.id===activeCategory)?.name||"Category"):(favoritesOnly?"Favorites":"All prompts");
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
  await updateDoc(doc(db,"users",user.uid,"prompts",id),{favorite:p.favorite});
  renderAll();toast(p.favorite?"Added to favorites":"Removed from favorites");
}
async function copyPrompt(id){
  const p=prompts.find(x=>x.id===id);if(!p)return;
  try{
    await navigator.clipboard.writeText(p.text||"");
    p.copyCount=(p.copyCount||0)+1;
    p.lastUsedAt=new Date();
    await updateDoc(doc(db,"users",user.uid,"prompts",id),{copyCount:p.copyCount,lastUsedAt:serverTimestamp()});
    renderStats();toast("Prompt copied to clipboard.");
  }catch{toast("Clipboard permission was blocked.","error");}
}


// Image-first pipeline: compress large uploads in the browser before Firebase Storage.
// This keeps Firebase storage/network usage low and makes thumbnails load much faster.
async function compressImage(file, maxSide=1280, quality=0.76){
  if(!file) return null;
  const bitmap = await createImageBitmap(file, {imageOrientation:"from-image"}).catch(()=>null);
  let width, height, drawSource;
  if(bitmap){
    width=bitmap.width; height=bitmap.height; drawSource=bitmap;
  }else{
    const img=await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file), im=new Image();
      im.onload=()=>{URL.revokeObjectURL(url);resolve(im)};
      im.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Image could not be read."))};
      im.src=url;
    });
    width=img.naturalWidth; height=img.naturalHeight; drawSource=img;
  }
  const scale=Math.min(1,maxSide/Math.max(width,height));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(width*scale));
  canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext("2d",{alpha:false});
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
  ctx.drawImage(drawSource,0,0,canvas.width,canvas.height);
  if(bitmap) bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));
  if(!blob) throw new Error("WebP compression failed.");
  return new File([blob],`${Date.now()}-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}.webp`,{type:"image/webp"});
}

async function makeImagePreview(file){
  if(!file)return;
  try{
    const small=await compressImage(file,900,0.72);
    const url=URL.createObjectURL(small);
    $("imagePreview").innerHTML=`<img src="${url}" alt="Selected image">`;
  }catch{
    const r=new FileReader();
    r.onload=()=>$("imagePreview").innerHTML=`<img src="${r.result}" alt="Selected image">`;
    r.readAsDataURL(file);
  }
}

async function uploadPromptImage(file,promptId){
  const full=await compressImage(file,1600,0.78);
  const thumb=await compressImage(file,640,0.70);
  const stamp=Date.now();
  const fullRef=ref(storage,`users/${user.uid}/prompts/${promptId}/${stamp}-full.webp`);
  const thumbRef=ref(storage,`users/${user.uid}/prompts/${promptId}/${stamp}-thumb.webp`);
  await Promise.all([
    uploadBytes(fullRef,full,{contentType:"image/webp",cacheControl:"public,max-age=31536000,immutable"}),
    uploadBytes(thumbRef,thumb,{contentType:"image/webp",cacheControl:"public,max-age=31536000,immutable"})
  ]);
  const [imageUrl,imageThumbUrl]=await Promise.all([getDownloadURL(fullRef),getDownloadURL(thumbRef)]);
  return {imageUrl,imageThumbUrl};
}

function openPrompt(id=null){
  $("promptForm").reset();$("promptId").value=id||"";
  $("promptModalTitle").textContent=id?"Edit prompt":"New prompt";
  $("imagePreview").innerHTML="<span>▧</span><small>Reference image</small>";
  if(id){
    const p=prompts.find(x=>x.id===id);
    if(!p)return;
    $("promptTitle").value=p.title||"";$("promptCategory").value=p.categoryId||categories[0]?.id||"";
    $("promptTags").value=(p.tags||[]).join(", ");$("promptText").value=p.text||"";
    $("negativeText").value=p.negative||"";$("promptNotes").value=p.notes||"";$("promptModel").value=p.model||"";$("promptRatio").value=p.ratio||"";
    if(p.imageUrl)$("imagePreview").innerHTML=`<img src="${escAttr(p.imageUrl)}" alt="">`;
  }else if(categories[0])$("promptCategory").value=categories[0].id;
  $("promptModal").classList.remove("hidden");
}
$("promptForm").onsubmit=async e=>{
  e.preventDefault();
  const id=$("promptId").value;
  const file=$("promptImage").files[0];
  const base={
    title:$("promptTitle").value.trim(),categoryId:$("promptCategory").value,tags:$("promptTags").value.split(",").map(x=>x.trim()).filter(Boolean),
    text:$("promptText").value.trim(),negative:$("negativeText").value.trim(),notes:$("promptNotes").value.trim(),
    model:$("promptModel").value.trim(),ratio:$("promptRatio").value.trim(),updatedAt:serverTimestamp()
  };
  const localImageUrl=file?URL.createObjectURL(file):null;
  try{
    if(id){
      const old=prompts.find(p=>p.id===id);
      if(!old)throw new Error("Prompt not found");
      if(file){
        base.imageUrl=localImageUrl;
        base.imageThumbUrl=localImageUrl;
      }else if(old.imageUrl){
        base.imageUrl=old.imageUrl;
        base.imageThumbUrl=old.imageThumbUrl||old.imageUrl;
      }
      // Save text/metadata immediately; image upload continues in background.
      await updateDoc(doc(db,"users",user.uid,"prompts",id),{...base,...(file?{imageUrl:localImageUrl,imageThumbUrl:localImageUrl}:{})});
      Object.assign(old,base);
      closeModal("promptModal"); renderAll(); toast(file?"Prompt saved — uploading image…":"Prompt updated.");
      if(file){
        (async()=>{
          try{
            const uploaded=await uploadPromptImage(file,id);
            await updateDoc(doc(db,"users",user.uid,"prompts",id),uploaded);
            Object.assign(old,uploaded); renderAll(); toast("Image uploaded and optimized.");
          }catch(err){console.error(err);toast("Prompt saved, but image upload failed. Try editing the prompt and uploading again.","error");}
          finally{if(localImageUrl)URL.revokeObjectURL(localImageUrl);}
        })();
      }
    }else{
      base.favorite=false;base.copyCount=0;base.createdAt=serverTimestamp();
      if(file){base.imageUrl=localImageUrl;base.imageThumbUrl=localImageUrl;}
      const newDoc=await addDoc(collection(db,"users",user.uid,"prompts"),base);
      const localPrompt={id:newDoc.id,...base,createdAt:new Date()};
      prompts.unshift(localPrompt);
      closeModal("promptModal"); renderAll(); toast(file?"Prompt saved — uploading image…":"Prompt saved.");
      if(file){
        (async()=>{
          try{
            const uploaded=await uploadPromptImage(file,newDoc.id);
            await updateDoc(newDoc,uploaded);
            Object.assign(localPrompt,uploaded); renderAll(); toast("Image uploaded and optimized.");
          }catch(err){console.error(err);toast("Prompt saved, but image upload failed. Try editing the prompt and uploading again.","error");}
          finally{if(localImageUrl)URL.revokeObjectURL(localImageUrl);}
        })();
      }
    }
  }catch(err){
    if(localImageUrl)URL.revokeObjectURL(localImageUrl);
    console.error(err);toast("Could not save prompt. Check Firebase setup.","error");
  }
};

$("promptImage").onchange=e=>{
  const f=e.target.files[0];
  if(f) makeImagePreview(f);
};

async function deletePrompt(id){
  const p=prompts.find(x=>x.id===id);if(!p)return;
  confirmAction("Delete prompt?",`“${p.title}” will be removed from your library.`,async()=>{
    try{await deleteDoc(doc(db,"users",user.uid,"prompts",id));prompts=prompts.filter(x=>x.id!==id);renderAll();toast("Prompt deleted.");}
    catch(err){toast("Could not delete prompt.","error");}
  });
}

function renderNotes(){
  $("notesList").innerHTML=notes.map(n=>`<button class="note-item ${n.id===currentNoteId?"active":""}" data-id="${n.id}"><strong>${escapeHTML(n.title||"Untitled")}</strong><span>${escapeHTML(n.body||"").slice(0,60)}</span><small>${fmtDate(n.updatedAt)}</small></button>`).join("");
  $("notesList").querySelectorAll(".note-item").forEach(b=>b.onclick=()=>selectNote(b.dataset.id));
  if(currentNoteId&&!notes.find(n=>n.id===currentNoteId))currentNoteId=null;
  if(!currentNoteId&&notes[0])selectNote(notes[0].id);
  if(!notes.length){$("noteTitle").value="";$("noteBody").value="";$("noteStatus").textContent="No notes yet";}
}
function selectNote(id){
  const n=notes.find(x=>x.id===id);if(!n)return;currentNoteId=id;$("noteTitle").value=n.title||"";$("noteBody").value=n.body||"";$("noteStatus").textContent="Saved";renderNotesListOnly();
}
function renderNotesListOnly(){
  $("notesList").querySelectorAll(".note-item").forEach(b=>b.classList.toggle("active",b.dataset.id===currentNoteId));
}
async function saveNote(){
  const title=$("noteTitle").value.trim()||"Untitled note",body=$("noteBody").value;
  if(!title&& !body)return;
  try{
    if(currentNoteId){
      await updateDoc(doc(db,"users",user.uid,"notes",currentNoteId),{title,body,updatedAt:serverTimestamp()});
      Object.assign(notes.find(n=>n.id===currentNoteId),{title,body,updatedAt:new Date()});
    }else{
      const d=await addDoc(collection(db,"users",user.uid,"notes"),{title,body,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      currentNoteId=d.id;notes.unshift({id:d.id,title,body,createdAt:new Date(),updatedAt:new Date()});
    }
    $("noteStatus").textContent="Saved just now";renderNotes();
  }catch(err){toast("Could not save note.","error");}
}
$("saveNoteBtn").onclick=saveNote;
$("newNoteBtn").onclick=()=>{activeView="notes";setView("notes");currentNoteId=null;$("noteTitle").value="";$("noteBody").value="";$("noteStatus").textContent="New note";};
$("noteToPrompt").onclick=()=>{openPrompt();$("promptTitle").value=$("noteTitle").value;$("promptText").value=$("noteBody").value;};
$("noteTitle").oninput=$("noteBody").oninput=()=>{$("noteStatus").textContent="Unsaved changes";};

function setView(view){
  activeView=view;
  qsa(".page-view").forEach(v=>v.classList.add("hidden"));
  $(view+"View")?.classList.remove("hidden");
  qsa(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("sidebar").classList.remove("open");$("sidebarOverlay").classList.remove("show");
  if(view==="prompts")renderLibrary();
  if(view==="notes")renderNotes();
}
qsa(".nav-item[data-view]").forEach(b=>b.onclick=()=>setView(b.dataset.view));
qsa("[data-view-link]").forEach(b=>b.onclick=()=>setView(b.dataset.viewLink));
$("newPromptBtn").onclick=()=>openPrompt();
$("emptyNewPrompt").onclick=()=>openPrompt();
$("addCategoryBtn").onclick=()=>{$("categoryModal").classList.remove("hidden");setTimeout(()=>$("categoryName").focus(),50);};

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
$("favoritesOnly").onclick=()=>{favoritesOnly=!favoritesOnly;$("favoritesOnly").classList.toggle("active",favoritesOnly);renderLibrary();};
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

function exportData(){
  const data={version:1,exportedAt:new Date().toISOString(),categories:categories.map(({id,...x})=>x),prompts:prompts.map(({id,...x})=>x),notes:notes.map(({id,...x})=>x)};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`promptvault-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast("Backup exported.");
}
$("exportBtn").onclick=exportData;$("quickImportBtn").onclick=$("settingsImportBtn").onclick=()=>$("importFile").click();
$("importFile").onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const data=JSON.parse(await f.text());
    if(!Array.isArray(data.prompts))throw new Error("Invalid backup");
    for(const c of (data.categories||[]))await addDoc(collection(db,"users",user.uid,"categories"),{...c,createdAt:serverTimestamp()});
    for(const p of data.prompts)await addDoc(collection(db,"users",user.uid,"prompts"),{...p,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    for(const n of (data.notes||[]))await addDoc(collection(db,"users",user.uid,"notes"),{...n,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
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