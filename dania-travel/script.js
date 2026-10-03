import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js';
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';

const firebaseConfig = {"apiKey": "AIzaSyDeUZwMQDX3fleW-rbw9TYye7kBMoPZSTQ", "authDomain": "danya-travel.firebaseapp.com", "projectId": "danya-travel", "storageBucket": "danya-travel.firebasestorage.app", "messagingSenderId": "1041209622283", "appId": "1:1041209622283:web:7f5dddfbc3cacad7916c0e"};
const OWNER_UID = "CzSE3oHdS4NEzH1AJq5pDnkecVj1";
const CLOUD_NAME = "mhnoxeq3";
const UPLOAD_PRESET = "TravelDanya";
// Адрес вашего Cloudflare Worker для подписанной загрузки (см. cloudflare-worker/worker.js).
// Пока пусто — загрузка работает по-старому (через открытый пресет). После деплоя Worker вставьте сюда его адрес.
const SIGN_URL = "";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let entries = [];
let canEdit = false;
let authReady = false;

function esc(s){
  s = (s === undefined || s === null) ? '' : String(s);
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function formatDate(iso){
  if(!iso) return '';
  const parts = iso.split('-');
  if(parts.length !== 3) return iso;
  const y = parseInt(parts[0],10), m = parseInt(parts[1],10)-1, d = parseInt(parts[2],10);
  if(isNaN(y)||isNaN(m)||isNaN(d)||!MONTHS[m]) return iso;
  return d + ' ' + MONTHS[m] + ' ' + y;
}

/* ---------- Cloudinary helpers ---------- */
function cloudinaryThumb(url, w){
  return url.replace('/upload/', '/upload/w_'+w+',c_fill,q_auto,f_auto/');
}
function cloudinaryVideoThumb(url){
  const withFrame = url.replace('/upload/', '/upload/so_0,w_400,c_fill,q_auto/');
  return withFrame.replace(/\.[a-zA-Z0-9]+(\?.*)?$/, '.jpg');
}
async function getUploadSignature(){
  const user = auth.currentUser;
  if(!user) throw new Error('нужно войти в админку');
  const idToken = await user.getIdToken();
  const res = await fetch(SIGN_URL, {method:'POST', headers:{'Authorization':'Bearer '+idToken}});
  if(!res.ok) throw new Error('подпись не получена ('+res.status+')');
  return res.json();
}
async function uploadToCloudinary(file, resourceType){
  const fd = new FormData();
  fd.append('file', file);
  if(SIGN_URL){
    const sig = await getUploadSignature();
    fd.append('api_key', sig.api_key);
    fd.append('timestamp', sig.timestamp);
    fd.append('signature', sig.signature);
    if(sig.upload_preset) fd.append('upload_preset', sig.upload_preset);
  } else {
    fd.append('upload_preset', UPLOAD_PRESET);
  }
  const res = await fetch('https://api.cloudinary.com/v1_1/'+CLOUD_NAME+'/'+resourceType+'/upload', {method:'POST', body:fd});
  const json = await res.json();
  if(!res.ok){ throw new Error((json.error && json.error.message) || 'upload failed'); }
  return {url: json.secure_url, publicId: json.public_id};
}

function parseVideoLink(url){
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/);
  if(yt) return {kind:'youtube', id:yt[1]};
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if(vm) return {kind:'vimeo', id:vm[1]};
  if(/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)) return {kind:'file', url:url};
  return {kind:'unknown', url:url};
}

/* ---------- Mini-nav + hero parallax (position only, no extra upscaling) ---------- */
const miniNav = document.getElementById('mini-nav');
const heroEl = document.getElementById('hero');
const heroBg = document.getElementById('hero-bg');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function onScroll(){
  const heroH = heroEl.offsetHeight;
  if(window.scrollY > heroH * 0.68) miniNav.classList.add('solid');
  else miniNav.classList.remove('solid');
  if(!reduceMotion){
    const y = Math.min(window.scrollY, heroH);
    heroBg.style.transform = 'translateY(' + (y * 0.28) + 'px)';
  }
}
document.addEventListener('scroll', onScroll, {passive:true});
onScroll();

/* ---------- Reveal on scroll ---------- */
let revealObserver = null;
function observeReveals(){
  if(!('IntersectionObserver' in window)){
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
    return;
  }
  if(!revealObserver){
    revealObserver = new IntersectionObserver((ents) => {
      ents.forEach(en => { if(en.isIntersecting){ en.target.classList.add('in'); revealObserver.unobserve(en.target); } });
    }, {threshold:.1, rootMargin:'0px 0px -60px 0px'});
  }
  document.querySelectorAll('.reveal:not(.in)').forEach(el => revealObserver.observe(el));
}

/* ---------- Media grid (directly visible, no separate story page) ---------- */
const GRID_MAX = 6;
const playIcon = '<span class="play-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg></span>';

function mediaThumbHtml(item, idx, entryId){
  let inner, extra = '';
  if(item.type === 'video'){
    extra = playIcon;
    inner = item.publicId
      ? '<img src="'+cloudinaryVideoThumb(item.url)+'" alt="" loading="lazy">'
      : '<div style="width:100%;height:100%;background:var(--forest-3)"></div>';
  } else {
    inner = '<img src="'+cloudinaryThumb(item.url,420)+'" alt="" loading="lazy">';
  }
  return '<button type="button" class="media-thumb" data-entry="'+esc(entryId)+'" data-idx="'+idx+'" aria-label="Открыть">'+inner+extra+'</button>';
}
function mediaGridHtml(media, entryId){
  if(!media || !media.length) return '';
  const shown = media.slice(0, GRID_MAX);
  const n = shown.length;
  const cls = n===1 ? 'n1' : (n===2 ? 'n2' : '');
  let html = '<div class="media-grid '+cls+'">';
  shown.forEach((item, idx) => {
    let thumb = mediaThumbHtml(item, idx, entryId);
    if(idx === GRID_MAX-1 && media.length > GRID_MAX){
      thumb = thumb.replace('</button>', '<span class="more-badge">+'+(media.length-GRID_MAX)+'</span></button>');
    }
    html += thumb;
  });
  html += '</div>';
  return html;
}

function entryControlsHtml(id){
  return '<div class="entry-controls">'
    + '<button type="button" class="ghost-icon" data-action="edit" data-id="'+esc(id)+'" aria-label="Редактировать"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></button>'
    + '<button type="button" class="ghost-icon" data-action="delete" data-id="'+esc(id)+'" aria-label="Удалить"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg></button>'
    + '</div>';
}

/* Shared row layout for BOTH categories: left = date/name/description, right = media grid */
function entryRowHtml(e){
  const grid = mediaGridHtml(e.media, e.id);
  return '<article class="entry-row reveal'+(grid ? '' : ' no-media')+'" data-id="'+esc(e.id)+'">'
    + '<div class="entry-text">'
    + (e.date ? '<span class="entry-date">'+esc(formatDate(e.date))+'</span>' : '')
    + '<h3>'+esc(e.name)+'</h3>'
    + (e.description ? '<p>'+esc(e.description)+'</p>' : '')
    + entryControlsHtml(e.id)
    + '</div>'
    + (grid ? '<div class="entry-media">'+grid+'</div>' : '')
    + '</article>';
}

function render(){
  const visited = entries.filter(e => e.category !== 'planned');
  const planned = entries.filter(e => e.category === 'planned');

  const vEl = document.getElementById('visited-list');
  vEl.innerHTML = visited.length
    ? visited.map(entryRowHtml).join('')
    : '<div class="ed-empty">Пока здесь пусто — первые локации появятся совсем скоро.'
      + '<div><button type="button" class="btn btn-primary" data-action="add" data-cat="visited" style="margin-top:16px; display:'+(canEdit?'inline-flex':'none')+';">Добавить первую локацию</button></div></div>';

  const pEl = document.getElementById('planned-list');
  pEl.innerHTML = planned.length
    ? planned.map(entryRowHtml).join('')
    : '<div class="ed-empty">Список ещё не начат.'
      + '<div><button type="button" class="btn btn-primary" data-action="add" data-cat="planned" style="margin-top:16px; display:'+(canEdit?'inline-flex':'none')+';">Добавить место в планы</button></div></div>';

  document.getElementById('stat-visited').textContent = visited.length;
  document.getElementById('stat-planned').textContent = planned.length;

  observeReveals();
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
}

/* ---------- Carousel ---------- */
const carousel = document.getElementById('carousel');
const carouselStage = document.getElementById('carousel-stage');
const carouselCounter = document.getElementById('carousel-counter');
let carouselMedia = [];
let carouselIdx = 0;

function renderCarouselStage(){
  const item = carouselMedia[carouselIdx];
  if(!item) return;
  if(item.type === 'video'){
    if(item.publicId){
      carouselStage.innerHTML = '<video src="'+item.url+'" controls autoplay playsinline style="max-height:88vh;max-width:100%;"></video>';
    } else {
      const parsed = parseVideoLink(item.url);
      if(parsed.kind === 'youtube'){
        carouselStage.innerHTML = '<iframe src="https://www.youtube.com/embed/'+esc(parsed.id)+'?autoplay=1" style="width:min(100%,960px);aspect-ratio:16/9;border:0;" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
      } else if(parsed.kind === 'vimeo'){
        carouselStage.innerHTML = '<iframe src="https://player.vimeo.com/video/'+esc(parsed.id)+'?autoplay=1" style="width:min(100%,960px);aspect-ratio:16/9;border:0;" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
      } else if(parsed.kind === 'file'){
        carouselStage.innerHTML = '<video src="'+esc(parsed.url)+'" controls autoplay playsinline style="max-height:88vh;max-width:100%;"></video>';
      } else {
        carouselStage.innerHTML = '<p style="color:#fff;">Не удалось встроить видео. <a href="'+esc(item.url)+'" target="_blank" rel="noopener" style="color:#DDBB78;">Открыть ссылку &rarr;</a></p>';
      }
    }
  } else {
    carouselStage.innerHTML = '<img src="'+item.url+'" alt="">';
  }
  carouselCounter.textContent = (carouselIdx+1) + ' / ' + carouselMedia.length;
}
function openCarousel(media, startIdx){
  carouselMedia = media || [];
  carouselIdx = Math.max(0, Math.min(startIdx||0, carouselMedia.length-1));
  if(!carouselMedia.length) return;
  renderCarouselStage();
  carousel.classList.add('open');
}
function closeCarousel(){ carousel.classList.remove('open'); carouselStage.innerHTML=''; }
function carouselStep(dir){
  if(!carouselMedia.length) return;
  carouselIdx = (carouselIdx + dir + carouselMedia.length) % carouselMedia.length;
  renderCarouselStage();
}
document.getElementById('carousel-close').addEventListener('click', closeCarousel);
document.getElementById('carousel-prev').addEventListener('click', () => carouselStep(-1));
document.getElementById('carousel-next').addEventListener('click', () => carouselStep(1));

/* ---------- Admin login ---------- */
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const loginMsg = document.getElementById('login-msg');

function maybeOpenLoginFromHash(){
  if(location.hash === '#admin' && !canEdit){
    loginOverlay.classList.add('open');
  }
}
window.addEventListener('hashchange', maybeOpenLoginFromHash);

document.getElementById('login-cancel').addEventListener('click', () => {
  loginOverlay.classList.remove('open');
  if(location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search);
});

loginForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  loginMsg.textContent = '';
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  setPersistence(auth, browserLocalPersistence).then(() => signInWithEmailAndPassword(auth, email, password))
    .then(() => {
      loginOverlay.classList.remove('open');
      loginForm.reset();
      if(location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search);
    })
    .catch(() => { loginMsg.textContent = 'Не удалось войти — проверь почту и пароль.'; });
});

document.getElementById('signout-btn').addEventListener('click', () => { signOut(auth); });

onAuthStateChanged(auth, (user) => {
  authReady = true;
  canEdit = !!(user && user.uid === OWNER_UID);
  document.body.classList.toggle('can-edit', canEdit);
  if(canEdit) loginOverlay.classList.remove('open');
  render();
});
maybeOpenLoginFromHash();

document.addEventListener('keydown', (ev) => {
  if(carousel.classList.contains('open')){
    if(ev.key === 'Escape') closeCarousel();
    else if(ev.key === 'ArrowLeft') carouselStep(-1);
    else if(ev.key === 'ArrowRight') carouselStep(1);
    return;
  }
  if(ev.key === 'Escape'){
    if(overlay.classList.contains('open')) overlay.classList.remove('open');
    if(loginOverlay.classList.contains('open')) loginOverlay.classList.remove('open');
  }
});

/* ---------- Modal state ---------- */
const overlay = document.getElementById('modal-overlay');
const form = document.getElementById('entry-form');
const modalTitle = document.getElementById('modal-title');
const modalMsg = document.getElementById('modal-msg');
const uploadRow = document.getElementById('upload-row');
const uploadLabel = document.getElementById('upload-label');
let pendingMedia = [];
let editingId = null;
let uploadsInFlight = 0;

function setUploading(on, label){
  uploadsInFlight += on ? 1 : -1;
  if(uploadsInFlight < 0) uploadsInFlight = 0;
  uploadRow.style.display = uploadsInFlight > 0 ? 'flex' : 'none';
  if(label) uploadLabel.textContent = label;
}
function setUploadLabel(label){ uploadLabel.textContent = label; }

function resetForm(cat){
  form.reset();
  pendingMedia = [];
  editingId = null;
  document.getElementById('media-previews').innerHTML = '';
  modalMsg.textContent = '';
  modalMsg.className = 'modal-msg';
  const radios = form.querySelectorAll('input[name=category]');
  radios.forEach(r => { r.checked = (r.value === (cat||'visited')); });
}

function renderMediaPreviews(){
  const row = document.getElementById('media-previews');
  row.innerHTML = pendingMedia.map((item, i) => {
    let body, tag;
    if(item.type === 'video'){
      tag = item.publicId ? 'видео' : 'ссылка';
      body = item.publicId
        ? '<img src="'+cloudinaryVideoThumb(item.url)+'" alt="">'
        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--sand);font-size:1.2rem;">&#9654;</div>';
    } else {
      tag = 'фото';
      body = '<img src="'+cloudinaryThumb(item.url,120)+'" alt="">';
    }
    return '<span class="media-preview">'+body+'<span class="tag">'+tag+'</span>'
         + '<button type="button" data-idx="'+i+'" aria-label="Убрать">&#10005;</button></span>';
  }).join('');
}

function openModal(mode, entry, defaultCat){
  if(mode === 'edit' && entry){
    modalTitle.textContent = 'Редактировать локацию';
    resetForm(entry.category);
    editingId = entry.id;
    document.getElementById('f-name').value = entry.name || '';
    document.getElementById('f-date').value = entry.date || '';
    document.getElementById('f-desc').value = entry.description || '';
    pendingMedia = (entry.media || []).slice();
    renderMediaPreviews();
  } else {
    modalTitle.textContent = 'Новая локация';
    resetForm(defaultCat);
  }
  overlay.classList.add('open');
  document.getElementById('f-name').focus();
}
function closeModal(){ overlay.classList.remove('open'); }
document.getElementById('modal-cancel').addEventListener('click', closeModal);
overlay.addEventListener('click', (ev) => { if(ev.target === overlay) closeModal(); });

/* ---------- Photo compression + upload ---------- */
const MAX_DIM = 1600, JPEG_Q = 0.78;

function compressImage(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read error'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode error'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const cw = Math.max(1, Math.round(img.width*scale)), ch = Math.max(1, Math.round(img.height*scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        canvas.toBlob((blob) => { blob ? resolve(blob) : reject(new Error('blob error')); }, 'image/jpeg', JPEG_Q);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function isHeicFile(file){
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
}
let heic2anyLoadPromise = null;
function loadHeic2Any(){
  if(window.heic2any) return Promise.resolve();
  if(heic2anyLoadPromise) return heic2anyLoadPromise;
  heic2anyLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.3/heic2any.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('heic2any failed to load'));
    document.head.appendChild(s);
  });
  return heic2anyLoadPromise;
}
async function heicToJpegBlob(file){
  await loadHeic2Any();
  const converter = window.heic2any && (window.heic2any.convert || window.heic2any);
  if(typeof converter !== 'function') throw new Error('heic2any unavailable');
  const res = await converter({blob:file, toType:'image/jpeg', quality:0.9});
  return Array.isArray(res) ? res[0] : res;
}

document.getElementById('f-photos').addEventListener('change', async (ev) => {
  const files = Array.from(ev.target.files || []);
  ev.target.value = '';
  if(!files.length) return;
  setUploading(true, 'Загружаю фото...');
  for(const file of files){
    const heic = isHeicFile(file);
    if(!heic && !/^image\//.test(file.type)) continue;
    try{
      let source = file;
      if(heic){
        setUploadLabel('Конвертирую HEIC...');
        try{
          source = await heicToJpegBlob(file);
        } catch(convErr){
          modalMsg.textContent = 'Не удалось обработать HEIC-фото. Попробуйте пересохранить его как JPEG и загрузить снова.';
          modalMsg.className = 'modal-msg error';
          continue;
        }
        setUploadLabel('Загружаю фото...');
      }
      const blob = await compressImage(source);
      const uploaded = await uploadToCloudinary(blob, 'image');
      pendingMedia.push({type:'photo', url:uploaded.url, publicId:uploaded.publicId});
      renderMediaPreviews();
    } catch(e){
      modalMsg.textContent = 'Не удалось загрузить одно из фото.'; modalMsg.className = 'modal-msg error';
    }
  }
  setUploading(false);
});

document.getElementById('f-video-file').addEventListener('change', async (ev) => {
  const files = Array.from(ev.target.files || []);
  ev.target.value = '';
  if(!files.length) return;
  setUploading(true, 'Загружаю видео...');
  for(const file of files){
    if(!/^video\//.test(file.type)) continue;
    try{
      const uploaded = await uploadToCloudinary(file, 'video');
      pendingMedia.push({type:'video', url:uploaded.url, publicId:uploaded.publicId});
      renderMediaPreviews();
    } catch(e){
      modalMsg.textContent = 'Не удалось загрузить видео: '+(e.message||'ошибка'); modalMsg.className = 'modal-msg error';
    }
  }
  setUploading(false);
});

document.getElementById('f-video-link-add').addEventListener('click', () => {
  const input = document.getElementById('f-video-link');
  const url = input.value.trim();
  if(!url) return;
  pendingMedia.push({type:'video', url:url});
  input.value = '';
  renderMediaPreviews();
});

document.getElementById('media-previews').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-idx]');
  if(!btn) return;
  pendingMedia.splice(parseInt(btn.getAttribute('data-idx'),10), 1);
  renderMediaPreviews();
});

/* ---------- Firestore save ---------- */
let saving = false;
async function saveEntry(entryData){
  if(saving) return false;
  saving = true;
  try{
    if(editingId){
      await updateDoc(doc(db, 'locations', editingId), entryData);
    } else {
      await addDoc(collection(db, 'locations'), {...entryData, createdAt: serverTimestamp()});
    }
    saving = false;
    return true;
  } catch(e){
    saving = false;
    toast('Не удалось сохранить: '+(e.message||'ошибка'));
    return false;
  }
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = document.getElementById('f-name').value.trim();
  if(!name){ modalMsg.textContent = 'Укажите название локации.'; modalMsg.className = 'modal-msg error'; return; }
  if(uploadsInFlight > 0){ modalMsg.textContent = 'Дождитесь окончания загрузки медиа.'; modalMsg.className = 'modal-msg error'; return; }
  const category = form.querySelector('input[name=category]:checked').value;
  const entryData = {
    category: category,
    name: name,
    date: document.getElementById('f-date').value || '',
    description: document.getElementById('f-desc').value.trim(),
    media: pendingMedia.slice()
  };
  const saveBtn = document.getElementById('modal-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Сохраняю...';
  const ok = await saveEntry(entryData);
  saveBtn.disabled = false; saveBtn.textContent = 'Сохранить';
  if(ok){ closeModal(); toast('Сохранено.'); }
});

/* ---------- Delegated clicks ---------- */
document.addEventListener('click', (ev) => {
  const thumb = ev.target.closest('.media-thumb');
  if(thumb){
    const entryId = thumb.getAttribute('data-entry');
    const idx = parseInt(thumb.getAttribute('data-idx'),10);
    const entry = entries.find(e => e.id === entryId);
    if(entry && entry.media) openCarousel(entry.media, idx);
    return;
  }
  const editEl = ev.target.closest('[data-action="edit"]');
  if(editEl){
    const found = entries.find(e => e.id === editEl.getAttribute('data-id'));
    if(found) openModal('edit', found);
    return;
  }
  const delEl = ev.target.closest('[data-action="delete"]');
  if(delEl){
    const did = delEl.getAttribute('data-id');
    const target = entries.find(e => e.id === did);
    const label = target ? target.name : 'эту локацию';
    if(window.confirm('Удалить «'+label+'»? Это действие нельзя отменить.')){
      deleteDoc(doc(db, 'locations', did)).then(() => toast('Удалено.')).catch(() => toast('Не удалось удалить.'));
    }
    return;
  }
  const addEl = ev.target.closest('[data-action="add"]');
  if(addEl){ openModal('add', null, addEl.getAttribute('data-cat') || 'visited'); return; }
});
document.getElementById('add-btn').addEventListener('click', () => openModal('add', null, 'visited'));

/* ---------- Firestore live subscription ---------- */
onSnapshot(query(collection(db, 'locations'), orderBy('createdAt', 'desc')), (snap) => {
  entries = snap.docs.map(d => ({id: d.id, ...d.data()}));
  render();
}, () => {
  document.getElementById('visited-list').innerHTML = '<div class="ed-empty">Не удалось загрузить данные. Обновите страницу.</div>';
});
