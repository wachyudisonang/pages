"use strict";
/* ================= config ================= */
var DB_NAME='grocery_v3', DB_VER=1;
var RETAIN_KEY='grocery_retain_months';                                    // localStorage key for the rotation setting
function getRetain(){ var v=parseInt(localStorage.getItem(RETAIN_KEY),10); return (v===3||v===6)?v:3; } // valid 3/6, default 3 (old 1/2 settings fall back to 3)
function setRetain(m){ localStorage.setItem(RETAIN_KEY,m); }              // persist 3/6
var THEME_KEY='grocery_theme';                                            // localStorage key for the appearance setting
function getTheme(){ var t=localStorage.getItem(THEME_KEY); return (t==='light'||t==='dark')?t:'system'; } // 'light' | 'dark' | 'system' (default)
function applyTheme(t){                                                   // reflect theme onto <html> + browser chrome color
  if(t==='light'||t==='dark'){ document.documentElement.setAttribute('data-theme',t); }
  else { document.documentElement.removeAttribute('data-theme'); }        // 'system' => let prefers-color-scheme decide
  var dark = t==='dark' || (t==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches);
  var mc=document.querySelector('meta[name="theme-color"]'); if(mc) mc.setAttribute('content', dark?'#161f2e':'#397fda'); // match status bar
}
function setTheme(t){ localStorage.setItem(THEME_KEY,t); applyTheme(t); }  // persist + apply
var CUR='Rp';                    // Rupiah — Indonesia-only app
var db=null;
var OPEN_ID=null;                // catalog id whose price-history popover is open
var CHECK_ID=null;               // catalog id whose inline price entry is open
var BEDIT_ID=null;               // basket catalog id whose price/qty editor is open
var ACTIVE='wish';               // active tab

/* in-memory caches, reloaded from IndexedDB */
var CAT=[], PRICES=[], PURCH=[];

/* ================= util ================= */
function $(id){ return document.getElementById(id); }
function esc(s){ return (s+'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function money(n){ if(n==null||isNaN(n)) return '—'; return CUR+' '+Number(n).toLocaleString('id-ID',{maximumFractionDigits:0}); }
function normName(s){ return (s||'').trim().toLowerCase().replace(/\s+/g,' '); }
function groupDigits(s){ var d=(s+'').replace(/\D/g,''); if(!d) return ''; d=d.replace(/^0+(?=\d)/,''); return d.replace(/\B(?=(\d{3})+(?!\d))/g,'.'); } // Indonesian thousand grouping (534534 -> 534.534)
function digitsToNum(s){ var d=(s+'').replace(/\D/g,''); return d?parseInt(d,10):NaN; }
function toast(m){ var t=$('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(function(){ t.classList.remove('show'); },1600); }
function todayStart(){ var d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function monthKey(ts){ var d=new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
var MONTHS=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']; // Indonesian labels shown in UI
function monthLabel(k){ var p=k.split('-'); return MONTHS[+p[1]-1]+' '+p[0]; }
function dayLabel(ts){ var d=new Date(ts); return d.getDate()+' '+MONTHS[d.getMonth()].slice(0,3); }
function ymd(ts){ var d=new Date(ts); return d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear(); }

/* ================= IndexedDB layer =================
   Kept behind a small helper set so storage can later be
   swapped (e.g. Firebase) without touching UI code. */
function openDB(){
  return new Promise(function(res,rej){
    var rq=indexedDB.open(DB_NAME,DB_VER);
    rq.onupgradeneeded=function(e){
      var d=e.target.result;
      if(!d.objectStoreNames.contains('catalog')){ var c=d.createObjectStore('catalog',{keyPath:'id',autoIncrement:true}); c.createIndex('nameKey','nameKey'); }
      if(!d.objectStoreNames.contains('prices')){ var p=d.createObjectStore('prices',{keyPath:'id',autoIncrement:true}); p.createIndex('catId','catId'); p.createIndex('ts','ts'); }
      if(!d.objectStoreNames.contains('purchases')){ var b=d.createObjectStore('purchases',{keyPath:'id',autoIncrement:true}); b.createIndex('ts','ts'); }
    };
    rq.onsuccess=function(){ db=rq.result; res(); };
    rq.onerror=function(){ rej(rq.error); };
  });
}
function st(n,m){ return db.transaction(n,m).objectStore(n); }
function add(n,o){ return new Promise(function(res,rej){ var r=st(n,'readwrite').add(o); r.onsuccess=function(){ res(r.result); }; r.onerror=function(){ rej(r.error); }; }); }
function put(n,o){ return new Promise(function(res,rej){ var r=st(n,'readwrite').put(o); r.onsuccess=function(){ res(r.result); }; r.onerror=function(){ rej(r.error); }; }); }
function del(n,id){ return new Promise(function(res,rej){ var r=st(n,'readwrite').delete(id); r.onsuccess=function(){ res(); }; r.onerror=function(){ rej(r.error); }; }); }
function getAll(n){ return new Promise(function(res,rej){ var r=st(n,'readonly').getAll(); r.onsuccess=function(){ res(r.result||[]); }; r.onerror=function(){ rej(r.error); }; }); }
function clearStore(n){ return new Promise(function(res,rej){ var r=st(n,'readwrite').clear(); r.onsuccess=function(){ res(); }; r.onerror=function(){ rej(r.error); }; }); }

function reload(){ return Promise.all([getAll('catalog'),getAll('prices'),getAll('purchases')]).then(function(a){ CAT=a[0]; PRICES=a[1]; PURCH=a[2]; }); }

/* ================= derived data ================= */
function catById(id){ for(var i=0;i<CAT.length;i++) if(CAT[i].id===id) return CAT[i]; return null; }
function pricesFor(catId){ return PRICES.filter(function(p){ return p.catId===catId; }).sort(function(a,b){ return a.ts-b.ts; }); }
function lastPrice(catId){ var h=pricesFor(catId); return h.length? h[h.length-1] : null; }
/* cheapest recorded price observation for an item (used as the price reference
   shown in the dropdown and wishlist badge). Null when there is no history. */
function lowestPrice(catId){ var h=pricesFor(catId); if(!h.length) return null; return h.reduce(function(lo,x){ return x.price<lo.price?x:lo; }, h[0]); }
function wishItems(){ return CAT.filter(function(c){ return c.state==='wish'; }).sort(function(a,b){ return a.name.localeCompare(b.name); }); }
function basketItems(){ return CAT.filter(function(c){ return c.state==='basket'; }).sort(function(a,b){ return a.name.localeCompare(b.name); }); }

/* ================= search dropdown ================= */
function buildOptions(q){
  var nk=normName(q);
  return CAT.filter(function(c){ return !nk || c.nameKey.indexOf(nk)>=0; })
    .sort(function(a,b){ if(nk){ var as=a.nameKey.indexOf(nk),bs=b.nameKey.indexOf(nk); if(as!==bs) return as-bs; } return a.name.localeCompare(b.name); })
    .slice(0,40);
}
function renderDrop(dropEl,q,allowNew,newFirst){
  var typed=q.trim();
  var newOpt = (allowNew && typed && !CAT.some(function(c){ return c.nameKey===normName(typed); }))
    ? '<div class="opt new" data-new="'+esc(typed)+'">+ Tambah baru: “'+esc(typed)+'”</div>' : '';
  var list=''; buildOptions(q).forEach(function(c){ var lp=lowestPrice(c.id);
    list+='<div class="opt" data-cat="'+c.id+'"><span class="nm">'+esc(c.name)+'</span><span class="op">'+(lp?money(lp.price):'—')+'</span><button class="optedit" data-catedit="'+c.id+'" title="Ubah nama"><svg viewBox="0 0 512 512"><path d="M441 58.9L453.1 71c9.4 9.4 9.4 24.6 0 33.9L424 134.1 377.9 88 407 58.9c9.4-9.4 24.6-9.4 33.9 0zM209.8 256.2L344 121.9 390.1 168 255.8 302.2c-2.9 2.9-6.5 5-10.4 6.1l-58.5 16.7 16.7-58.5c1.1-3.9 3.2-7.5 6.1-10.4zM373.1 25L175.8 222.2c-8.7 8.7-15 19.4-18.3 31.1l-28.6 100c-2.4 8.4-.1 17.4 6.1 23.6s15.2 8.5 23.6 6.1l100-28.6c11.8-3.3 22.5-9.6 31.1-18.3L487 138.9c28.1-28.1 28.1-73.7 0-101.8L474.9 25C446.8-3.1 401.2-3.1 373.1 25zM88 64C39.4 64 0 103.4 0 152L0 424c0 48.6 39.4 88 88 88l272 0c48.6 0 88-39.4 88-88l0-112c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 112c0 22.1-17.9 40-40 40L88 464c-22.1 0-40-17.9-40-40l0-272c0-22.1 17.9-40 40-40l112 0c13.3 0 24-10.7 24-24s-10.7-24-24-24L88 64z"/></svg></button><button class="optdel" data-catdel="'+c.id+'" title="Hapus dari daftar"><svg viewBox="0 0 448 512"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0L284.2 0c12.1 0 23.2 6.8 28.6 17.7L320 32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 7.2-14.3zM32 128l384 0 0 320c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-320zm96 64c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16z"/></svg></button></div>'; });
  var html = newFirst ? (newOpt+list) : (list+newOpt);
  if(!html) html='<div class="opt" style="color:var(--muted)">Ketik nama baru untuk menambah</div>';
  dropEl.innerHTML=html; dropEl.classList.add('on');
}

/* ================= wishlist ================= */
function addWish(name){
  var nk=normName(name), ex=CAT.filter(function(c){ return c.nameKey===nk; })[0];
  if(ex){
    if(ex.state==='wish'){ closeModal(); toast('Sudah ada di wishlist'); return Promise.resolve(); }
    // idle (previously bought) or in basket -> bring back into the wishlist
    ex.state='wish';
    return put('catalog',ex).then(function(){ closeModal(); toast('Ditambah ke wishlist: '+ex.name); return refresh(); });
  }
  return add('catalog',{name:name.trim(),nameKey:nk,category:'',state:'wish'}).then(function(){ closeModal(); toast('Ditambah: '+name.trim()); return refresh(); });
}
function removeItem(catId){
  var c=catById(catId);
  var ps=[del('catalog',catId)]
    .concat(PRICES.filter(function(p){ return p.catId===catId; }).map(function(p){ return del('prices',p.id); }));
  return Promise.all(ps).then(function(){ if(OPEN_ID===catId)OPEN_ID=null; if(CHECK_ID===catId)CHECK_ID=null; toast('Dihapus: '+(c?c.name:'item')); return refresh(); });
}
/* open the inline price field for a wishlist item before moving it to the basket */
function beginCheck(catId){ CHECK_ID=(CHECK_ID===catId?null:catId); OPEN_ID=null; renderWish(); if(CHECK_ID===catId){ var i=$('pin_'+catId); if(i){ i.focus(); i.select(); } updateSub(catId); } }
/* confirm the price and move the item into the basket */
function toBasket(catId){
  var i=$('pin_'+catId); if(!i) return;
  var price=digitsToNum(i.value);
  if(isNaN(price)||price<0){ toast('Isi harga dulu'); i.focus(); return; }
  var qty=qtyVal(catId);
  var c=catById(catId); c.state='basket'; c.checkPrice=price; c.checkQty=qty;
  put('catalog',c).then(function(){ CHECK_ID=null; toast('Masuk keranjang: '+c.name); return refresh(); });
}
/* read the quantity field for an item (defaults to 1, min 1) */
function qtyVal(catId){ var q=$('qin_'+catId); var n=q?digitsToNum(q.value):NaN; return (isNaN(n)||n<1)?1:n; }
/* live subtotal shown under the price line (price × qty) */
function updateSub(catId){
  var el=$('sub_'+catId); if(!el) return;
  var p=$('pin_'+catId); var price=p?digitsToNum(p.value):NaN;
  if(isNaN(price)){ el.textContent=''; return; }
  var qty=qtyVal(catId);
  el.textContent=(qty>1?(qty+' × '+money(price)+' = '):'')+money(price*qty);
}
/* toggle the price-history popover on a wishlist row */
function togglePop(catId){ OPEN_ID=(OPEN_ID===catId?null:catId); CHECK_ID=null; renderWish(); }

function renderWish(){
  var box=$('wishBox'); box.innerHTML='';
  var items=wishItems();
  if(!items.length){ box.innerHTML='<div class="empty"><span class="big"><svg viewBox="0 0 384 512"><path d="M192 0c-41.8 0-77.4 26.7-90.5 64L64 64C28.7 64 0 92.7 0 128L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-320c0-35.3-28.7-64-64-64l-37.5 0C269.4 26.7 233.8 0 192 0zm0 64a32 32 0 1 1 0 64 32 32 0 1 1 0-64zM72 272a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zm104-16l128 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-128 0c-8.8 0-16-7.2-16-16s7.2-16 16-16zM72 368a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zm88 0c0-8.8 7.2-16 16-16l128 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-128 0c-8.8 0-16-7.2-16-16z"/></svg></span>Wishlist masih kosong.<br>Ketuk tombol <b>+</b> di bawah untuk menambah barang.</div>'; return; }
  var wrap=document.createElement('div'); wrap.className='rows';
  items.forEach(function(c){
    var lp=lastPrice(c.id); var low=lowestPrice(c.id); var open=OPEN_ID===c.id; var checking=CHECK_ID===c.id;
    var el=document.createElement('div');
    el.setAttribute('data-item',c.id);
    el.innerHTML=
      '<div class="row">'+
        '<div class="cb" data-check="'+c.id+'" title="Tandai diambil"><svg viewBox="0 0 448 512"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg></div>'+
        '<div class="rname" data-check="'+c.id+'">'+esc(c.name)+(c.category?'<span class="tag">'+esc(c.category)+'</span>':'')+'</div>'+
        '<div class="rlast hist" data-pop="'+c.id+'">'+(low?('<b>'+money(low.price)+'</b><svg class="hicon" viewBox="0 0 512 512"><path d="M64 64c0-17.7-14.3-32-32-32S0 46.3 0 64L0 400c0 44.2 35.8 80 80 80l400 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 416c-8.8 0-16-7.2-16-16L64 64zm406.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L320 210.7l-57.4-57.4c-12.5-12.5-32.8-12.5-45.3 0l-112 112c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L240 221.3l57.4 57.4c12.5 12.5 32.8 12.5 45.3 0l128-128z"/></svg>'):'<span class="none">belum ada</span>')+'</div>'+
        '<button class="redit" data-edit="'+c.id+'" title="Ubah nama"><svg viewBox="0 0 512 512"><path d="M441 58.9L453.1 71c9.4 9.4 9.4 24.6 0 33.9L424 134.1 377.9 88 407 58.9c9.4-9.4 24.6-9.4 33.9 0zM209.8 256.2L344 121.9 390.1 168 255.8 302.2c-2.9 2.9-6.5 5-10.4 6.1l-58.5 16.7 16.7-58.5c1.1-3.9 3.2-7.5 6.1-10.4zM373.1 25L175.8 222.2c-8.7 8.7-15 19.4-18.3 31.1l-28.6 100c-2.4 8.4-.1 17.4 6.1 23.6s15.2 8.5 23.6 6.1l100-28.6c11.8-3.3 22.5-9.6 31.1-18.3L487 138.9c28.1-28.1 28.1-73.7 0-101.8L474.9 25C446.8-3.1 401.2-3.1 373.1 25zM88 64C39.4 64 0 103.4 0 152L0 424c0 48.6 39.4 88 88 88l272 0c48.6 0 88-39.4 88-88l0-112c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 112c0 22.1-17.9 40-40 40L88 464c-22.1 0-40-17.9-40-40l0-272c0-22.1 17.9-40 40-40l112 0c13.3 0 24-10.7 24-24s-10.7-24-24-24L88 64z"/></svg></button>'+
        '<button class="rdel" data-del="'+c.id+'" title="Hapus"><svg viewBox="0 0 448 512"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0L284.2 0c12.1 0 23.2 6.8 28.6 17.7L320 32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 7.2-14.3zM32 128l384 0 0 320c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-320zm96 64c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16z"/></svg></button>'+
      '</div>'+
      '<div class="priceline'+(checking?' on':'')+'">'+
        '<div class="pin"><label>Harga</label>'+
          '<input id="pin_'+c.id+'" type="text" inputmode="numeric" enterkeyhint="next" autocomplete="off" placeholder="0" value="'+(c.checkPrice!=null?groupDigits(c.checkPrice):(lp?groupDigits(lp.price):''))+'" data-price="'+c.id+'">'+
          '<span class="mul">×</span>'+
          '<input id="qin_'+c.id+'" class="qty" type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="1" value="'+(c.checkQty||1)+'" data-qty="'+c.id+'">'+
          '<button class="go" data-tobasket="'+c.id+'">Masuk keranjang</button>'+
        '</div>'+
        '<div class="hint"><span>'+(lp?('Harga terakhir '+money(lp.price)+' · '+ymd(lp.ts)):'Belum ada harga sebelumnya')+'</span><span class="sub" id="sub_'+c.id+'"></span></div>'+
      '</div>'+
      renderPop(c.id,open);
    wrap.appendChild(el);
  });
  box.appendChild(wrap);
}
/* price-history popover markup for one item */
function renderPop(catId,open){
  if(!open) return '';
  var h=pricesFor(catId);
  if(!h.length) return '<div class="pop-list on"><div class="pop-head">Riwayat harga</div><div class="ph"><span class="pd">Belum ada riwayat harga</span></div></div>';
  var prices=h.map(function(x){ return x.price; }); var min=Math.min.apply(null,prices), max=Math.max.apply(null,prices);
  var last=h[h.length-1];
  var head='<div class="pop-head">Riwayat harga <span class="pop-sum">terendah '+money(min)+' · terakhir '+money(last.price)+'</span></div>';
  var rows=h.slice().reverse().map(function(x){
    var cls=x.price<=min?'cheap':(x.price>=max&&max>min?'dear':'');
    var tag=x.price<=min&&max>min?' <span class="pbadge">termurah</span>':'';
    return '<div class="ph"><span class="pd">'+ymd(x.ts)+tag+'</span><span class="pp '+cls+'">'+money(x.price)+'</span></div>';
  }).join('');
  return '<div class="pop-list on">'+head+rows+'</div>';
}

/* ================= basket ================= */
function fromBasket(catId){ var c=catById(catId); if(!c)return; c.state='wish'; if(BEDIT_ID===catId)BEDIT_ID=null; put('catalog',c).then(function(){ toast('Kembali ke wishlist: '+c.name); return refresh(); }); }
/* toggle the inline price/qty editor for one basket row */
function toggleBedit(catId){ BEDIT_ID=(BEDIT_ID===catId?null:catId); renderBasket(); if(BEDIT_ID===catId){ var i=$('bpin_'+catId); if(i){ i.focus(); i.select(); } } }
/* persist an in-basket price/qty edit and update the line + grand total live,
   WITHOUT re-rendering (so the field being typed in keeps focus). */
function saveBasketEdit(catId){
  var c=catById(catId); if(!c) return;
  var pin=$('bpin_'+catId), qin=$('bqin_'+catId);
  var price=pin?digitsToNum(pin.value):NaN; if(isNaN(price)||price<0) price=0;
  var qn=qin?digitsToNum(qin.value):NaN; var qty=(isNaN(qn)||qn<1)?1:qn;
  c.checkPrice=price; c.checkQty=qty;
  var lineEl=$('bline_'+catId); if(lineEl) lineEl.textContent=money(price*qty);
  // recompute grand total from the in-memory basket (using the just-set values)
  var total=basketItems().reduce(function(s,x){ return s+((x.checkPrice||0)*(x.checkQty||1)); },0);
  $('basketTotal').textContent=money(total);
  put('catalog',c); // fire-and-forget persist; no refresh (keeps focus)
}
function renderBasket(){
  var box=$('basketBox'); box.innerHTML='';
  var items=basketItems();
  if(!items.length){ box.innerHTML='<div class="empty"><span class="big"><svg viewBox="0 0 576 512"><path d="M253.3 35.1c6.1-11.8 1.5-26.3-10.2-32.4s-26.3-1.5-32.4 10.2L117.6 192 32 192c-17.7 0-32 14.3-32 32s14.3 32 32 32L83.9 463.5C91 492 116.6 512 146 512L430 512c29.4 0 55-20 62.1-48.5L544 256c17.7 0 32-14.3 32-32s-14.3-32-32-32l-85.6 0L365.3 12.9C359.2 1.2 344.7-3.4 332.9 2.7s-16.3 20.6-10.2 32.4L404.3 192l-232.6 0L253.3 35.1z"/></svg></span>Keranjang kosong.<br>Centang item di wishlist saat kamu mengambilnya.</div>'; $('basketTotal').textContent='—'; $('payBtn').disabled=true; setBadge(0); return; }
  var wrap=document.createElement('div'); wrap.className='rows'; var total=0;
  items.forEach(function(c){
    var unit=c.checkPrice||0; var qty=c.checkQty||1; var line=unit*qty; total+=line;
    var editing=BEDIT_ID===c.id;
    var el=document.createElement('div');
    el.innerHTML=
      '<div class="row">'+
        '<div class="cb on" data-uncheck="'+c.id+'"><svg viewBox="0 0 448 512"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg></div>'+
        '<div class="rmeta">'+
          '<div class="rname" data-edit="'+c.id+'" title="Ketuk untuk ubah nama">'+esc(c.name)+'</div>'+
          '<div class="rqp">'+qty+' × '+money(unit)+'</div>'+
        '</div>'+
        '<div class="rlast"><b>'+money(line)+'</b></div>'+
        '<button class="redit'+(editing?' act':'')+'" data-bedit="'+c.id+'" title="Ubah harga / jumlah"><svg viewBox="0 0 512 512"><path d="M441 58.9L453.1 71c9.4 9.4 9.4 24.6 0 33.9L424 134.1 377.9 88 407 58.9c9.4-9.4 24.6-9.4 33.9 0zM209.8 256.2L344 121.9 390.1 168 255.8 302.2c-2.9 2.9-6.5 5-10.4 6.1l-58.5 16.7 16.7-58.5c1.1-3.9 3.2-7.5 6.1-10.4zM373.1 25L175.8 222.2c-8.7 8.7-15 19.4-18.3 31.1l-28.6 100c-2.4 8.4-.1 17.4 6.1 23.6s15.2 8.5 23.6 6.1l100-28.6c11.8-3.3 22.5-9.6 31.1-18.3L487 138.9c28.1-28.1 28.1-73.7 0-101.8L474.9 25C446.8-3.1 401.2-3.1 373.1 25zM88 64C39.4 64 0 103.4 0 152L0 424c0 48.6 39.4 88 88 88l272 0c48.6 0 88-39.4 88-88l0-112c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 112c0 22.1-17.9 40-40 40L88 464c-22.1 0-40-17.9-40-40l0-272c0-22.1 17.9-40 40-40l112 0c13.3 0 24-10.7 24-24s-10.7-24-24-24L88 64z"/></svg></button>'+
        '<button class="rdel" data-uncheck="'+c.id+'" title="Kembalikan ke wishlist"><svg viewBox="0 0 512 512"><path d="M125.7 160l50.3 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L48 224c-17.7 0-32-14.3-32-32L16 64c0-17.7 14.3-32 32-32s32 14.3 32 32l0 51.2L97.6 97.6c87.5-87.5 229.3-87.5 316.8 0s87.5 229.3 0 316.8s-229.3 87.5-316.8 0c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0c62.5 62.5 163.8 62.5 226.3 0s62.5-163.8 0-226.3s-163.8-62.5-226.3 0L125.7 160z"/></svg></button>'+
      '</div>'+
      '<div class="bedit'+(editing?' on':'')+'">'+
        '<div class="pin"><label>Harga</label>'+
          '<input id="bpin_'+c.id+'" type="text" inputmode="numeric" enterkeyhint="next" autocomplete="off" placeholder="0" value="'+(unit?groupDigits(unit):'')+'" data-bprice="'+c.id+'">'+
          '<span class="mul">×</span>'+
          '<input id="bqin_'+c.id+'" class="qty" type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="1" value="'+qty+'" data-bqty="'+c.id+'">'+
          '<span class="bline" id="bline_'+c.id+'">'+money(line)+'</span>'+
        '</div>'+
      '</div>';
    wrap.appendChild(el);
  });
  box.appendChild(wrap);
  $('basketTotal').textContent=money(total);
  $('payBtn').disabled=false;
  setBadge(items.length);
}
function setBadge(n){ var b=$('basketBadge'); b.textContent=n; b.classList.toggle('on',n>0); }

/* mark everything in the basket as paid: write a purchase + price observation, then clear the basket flag */
function payAll(){
  var items=basketItems(); if(!items.length) return;
  var now=Date.now(), ops=[];
  items.forEach(function(c){
    var unit=c.checkPrice||0; var qty=c.checkQty||1; var line=unit*qty;
    ops.push(add('purchases',{catId:c.id,name:c.name,price:line,unit:unit,qty:qty,ts:now}));
    ops.push(add('prices',{catId:c.id,price:unit,ts:now}));  // history tracks UNIT price
    c.state='idle'; delete c.checkPrice; delete c.checkQty; ops.push(put('catalog',c));  // paid: leaves wishlist, history/search still keep it
  });
  Promise.all(ops).then(function(){ toast('✓ '+items.length+' item ditandai dibayar'); ACTIVE='history'; applyTab(); return refresh(); });
}

/* ================= history ================= */
function renderHistory(){
  var box=$('histBox'); box.innerHTML='';
  if(!PURCH.length){ box.innerHTML='<div class="empty"><span class="big"><svg viewBox="0 0 512 512"><path d="M75 75L41 41C25.9 25.9 0 36.6 0 57.9L0 168c0 13.3 10.7 24 24 24l110.1 0c21.4 0 32.1-25.9 17-41l-30.8-30.8C155 85.5 203 64 256 64c106 0 192 86 192 192s-86 192-192 192c-40.8 0-78.6-12.7-109.7-34.4c-14.5-10.1-34.4-6.6-44.6 7.9s-6.6 34.4 7.9 44.6C151.2 495 201.7 512 256 512c141.4 0 256-114.6 256-256S397.4 0 256 0C185.3 0 121.3 28.7 75 75z"/></svg></span>Belum ada pembelian.</div>'; return; }
  var byMonth={}; PURCH.forEach(function(it){ var k=monthKey(it.ts); (byMonth[k]=byMonth[k]||[]).push(it); });
  Object.keys(byMonth).sort().reverse().forEach(function(k){
    var arr=byMonth[k].sort(function(a,b){ return b.ts-a.ts; });
    var tot=arr.reduce(function(s,x){ return s+(x.price||0); },0);
    var m=document.createElement('div'); m.className='month';
    var rows=arr.map(function(it){ var qn=' <span class="hd">'+(it.qty||1)+' × '+money(it.unit!=null?it.unit:(it.price/(it.qty||1)))+'</span>'; return '<div class="hrow"><div class="hn">'+esc(it.name)+'<span class="hd">'+dayLabel(it.ts)+'</span>'+qn+'</div><div class="hp">'+money(it.price)+'</div><button class="rdel" data-hdel="'+it.id+'" title="Hapus pembelian ini"><svg viewBox="0 0 448 512"><path d="M135.2 17.7C140.6 6.8 151.7 0 163.8 0L284.2 0c12.1 0 23.2 6.8 28.6 17.7L320 32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 7.2-14.3zM32 128l384 0 0 320c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-320zm96 64c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16z"/></svg></button></div>'; }).join('');
    m.innerHTML='<h3><span>'+monthLabel(k)+' <span style="color:var(--muted);font-weight:600;font-size:12px">('+arr.length+')</span></span><span class="mtot">'+money(tot)+'</span></h3>'+rows;
    box.appendChild(m);
  });
}
function renderLook(catId){
  var out=$('lookResult'); var c=catById(catId);
  if(!c){ out.innerHTML=''; return; }
  var h=pricesFor(catId);
  if(!h.length){ out.innerHTML='<div class="lookresult"><div class="empty" style="padding:14px">Belum ada riwayat harga untuk “'+esc(c.name)+'”.</div></div>'; return; }
  var prices=h.map(function(x){ return x.price; }); var min=Math.min.apply(null,prices), max=Math.max.apply(null,prices);
  var avg=prices.reduce(function(a,b){ return a+b; },0)/prices.length; var latest=h[h.length-1];
  var span=(max-min)||1;
  var bars=h.slice().reverse().map(function(x){ var w=Math.round(((x.price-min)/span)*100);
    return '<div class="sparow"><span style="color:var(--muted);width:52px">'+dayLabel(x.ts)+'</span><div class="barwrap"><div class="bar" style="width:'+Math.max(w,4)+'%"></div></div><span style="width:100px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums">'+money(x.price)+'</span></div>'; }).join('');
  out.innerHTML='<div class="lookresult">'+
    '<div style="font-size:13px;color:var(--muted)">'+esc(c.name)+' — harga terakhir</div>'+
    '<div style="font-size:24px;font-weight:900;font-variant-numeric:tabular-nums">'+money(latest.price)+'</div>'+
    '<div style="display:flex;justify-content:space-between;font-size:13px;margin:8px 0"><span>Min <b>'+money(min)+'</b></span><span>Rata <b>'+money(Math.round(avg))+'</b></span><span>Maks <b>'+money(max)+'</b></span></div>'+
    '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">Riwayat harga ('+h.length+')</div>'+bars+'</div>';
}

/* ================= purge / export / import ================= */
/* rotation: delete purchases (and their price observations) older than RETAIN_MONTHS */
/* Align every purchase's frozen name to its catalog item's CURRENT name.
   Self-heals any history row left stale by an earlier rename (including renames
   done before this behaviour existed). Keyed by catId; a purchase whose catId no
   longer resolves to a catalog item is left untouched (its name is all we have). */
function syncHistoryNames(){
  var ops=[];
  PURCH.forEach(function(p){
    if(p.catId==null) return;
    var c=catById(p.catId); if(!c) return;
    if(p.name!==c.name){ p.name=c.name; ops.push(put('purchases',p)); }
  });
  return ops.length?Promise.all(ops):Promise.resolve(0);
}
function purgeOld(){
  var cutoff=new Date(); cutoff.setMonth(cutoff.getMonth()-getRetain()); var c=cutoff.getTime();
  var oldP=PURCH.filter(function(x){ return x.ts<c; });
  var oldPr=PRICES.filter(function(x){ return x.ts<c; });
  if(!oldP.length && !oldPr.length) return Promise.resolve(0);
  return Promise.all(
    oldP.map(function(x){ return del('purchases',x.id); })
    .concat(oldPr.map(function(x){ return del('prices',x.id); }))
  ).then(function(){ return oldP.length; });
}
function exportData(){
  var payload={app:'grocery',version:4,exported:new Date().toISOString(),catalog:CAT,prices:PRICES,purchases:PURCH};
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='belanja-cadangan-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a); a.click(); a.remove(); toast('Cadangan diunduh');
}
function importData(file){
  var fr=new FileReader();
  fr.onload=function(){
    try{
      var d=JSON.parse(fr.result);
      var cats=d.catalog||[], prs=d.prices||[], pus=d.purchases||[], idmap={}, chain=Promise.resolve();
      cats.forEach(function(c){ chain=chain.then(function(){ return add('catalog',{name:c.name,nameKey:c.nameKey||normName(c.name),category:c.category||'',state:c.state==='basket'?'basket':'wish',checkPrice:c.checkPrice,checkQty:c.checkQty}).then(function(nid){ idmap[c.id]=nid; }); }); });
      chain=chain.then(function(){ var ps=[];
        prs.forEach(function(p){ ps.push(add('prices',{catId:idmap[p.catId]!=null?idmap[p.catId]:p.catId,price:p.price,ts:p.ts})); });
        pus.forEach(function(b){ ps.push(add('purchases',{catId:idmap[b.catId]!=null?idmap[b.catId]:b.catId,name:b.name,price:b.price,unit:b.unit!=null?b.unit:b.price,qty:b.qty||1,ts:b.ts||Date.now()})); });
        return Promise.all(ps);
      });
      chain.then(function(){ toast('Cadangan dipulihkan'); return refresh(); });
    }catch(e){ toast('Berkas tidak bisa dibaca'); }
  };
  fr.readAsText(file);
}
function clearAll(){
  var n=CAT.length, np=PURCH.length;
  confirmSheet('Hapus semua data?', n+' item dan '+np+' pembelian akan dihapus PERMANEN. Tindakan ini tidak bisa dibatalkan. Disarankan cadangkan dulu.', 'Ya, hapus semua', function(){
    Promise.all([clearStore('catalog'),clearStore('prices'),clearStore('purchases')]).then(function(){
      OPEN_ID=null; CHECK_ID=null; toast('Semua data dihapus'); ACTIVE='wish'; applyTab(); return refresh();
    }).catch(function(){ toast('Gagal menghapus'); });
  });
}

/* ================= render + tabs ================= */
function refresh(){ return reload().then(function(){ renderWish(); renderBasket(); renderHistory(); var lc=$('hsearch')._catId; if(lc)renderLook(lc); refreshOpenDrops(); updateStat(); }); }
/* Re-render any dropdown currently open, so a rename/delete made from it shows
   immediately (refresh() otherwise only repaints the tab lists, not the drops). */
function refreshOpenDrops(){
  var wd=$('wdrop'); if(wd && wd.classList.contains('on')) renderDrop(wd,$('wsearch').value,true,true);
  var hd=$('hdrop'); if(hd && hd.classList.contains('on')) renderDrop(hd,$('hsearch').value,false);
}
function updateStat(){ $('dataStat').textContent='Item: '+CAT.length+' · Catatan harga: '+PRICES.length+' · Pembelian: '+PURCH.length; }

var TITLES={wish:['Daftar Belanja','Catat dulu, belanja lebih hemat'],basket:['Keranjang','Siap dibayar di kasir'],history:['Riwayat','Belanja &amp; harga sebelumnya'],more:['Lainnya','Pengaturan &amp; data']};
function applyTab(){
  ['wish','basket','history','more'].forEach(function(t){ $('tab-'+t).classList.toggle('on',t===ACTIVE); });
  document.querySelectorAll('nav.tabs .nav').forEach(function(b){ b.classList.toggle('on',b.getAttribute('data-tab')===ACTIVE); });
  var meta=TITLES[ACTIVE]; $('topTitle').textContent=meta[0]; $('topSub').innerHTML=meta[1];
}

/* ================= modal ================= */
function openModal(){ $('modalBg').classList.add('on'); var w=$('wsearch'); w.value=''; renderDrop($('wdrop'),'',true,true); setTimeout(function(){ w.focus(); },60); }
function closeModal(){ $('modalBg').classList.remove('on'); $('wdrop').classList.remove('on'); }

/* in-app confirmation (replaces native confirm, which some webviews block) */
var _confirmCb=null;
function confirmSheet(title,msg,yesLabel,onYes){
  $('confirmTitle').textContent=title;
  $('confirmMsg').textContent=msg;
  $('confirmMsg').style.display='';
  $('confirmInput').style.display='none';
  $('confirmYes').textContent=yesLabel||'Hapus';
  $('confirmYes').className='btn danger'; $('confirmYes').style.flex='1';
  _confirmCb=onYes;
  $('confirmBg').classList.add('on');
}
/* text-input variant of the sheet — used for renaming an item.
   onOk receives the trimmed value; it is only called when the value is non-empty. */
function promptSheet(title,initial,okLabel,onOk){
  $('confirmTitle').textContent=title;
  $('confirmMsg').style.display='none';
  var inp=$('confirmInput'); inp.style.display='';
  inp.value=initial||'';
  $('confirmYes').textContent=okLabel||'Simpan';
  $('confirmYes').className='btn primary'; $('confirmYes').style.flex='1';
  _confirmCb=function(){ var v=(inp.value||'').trim(); if(!v) return false; return onOk(v); };
  $('confirmBg').classList.add('on');
  setTimeout(function(){ inp.focus(); inp.select(); },30);
}
function closeConfirm(){ $('confirmBg').classList.remove('on'); _confirmCb=null; var inp=$('confirmInput'); if(inp){ inp.style.display='none'; inp.value=''; } $('confirmMsg').style.display=''; }

/* rename a catalog item in place — keeps its id, so price history (keyed by catId)
   survives. The live name updates everywhere it is read from the catalog: wishlist,
   basket, and the search/lookup dropdown. Matching purchase (history) rows are also
   rewritten so past entries show the corrected name too. */
function renameItem(catId){
  var c=catById(catId); if(!c) return;
  promptSheet('Ubah nama barang', c.name, 'Simpan', function(name){
    var nk=normName(name);
    var dup=CAT.filter(function(x){ return x.id!==catId && x.nameKey===nk; })[0];
    if(dup){ toast('Nama “'+name+'” sudah ada di daftar'); return false; }
    var nm=name.trim();
    var oldName=c.name;
    c.name=nm; c.nameKey=nk;
    var ops=[put('catalog',c)];
    // Rewrite the frozen name on every purchase of this item so History updates too.
    // Match by catId (type-tolerant) OR by the previous name, so legacy/imported
    // rows whose catId doesn't line up are still caught.
    PURCH.forEach(function(p){
      var sameId=(p.catId!=null && String(p.catId)===String(catId));
      var sameName=(p.name===oldName);
      if((sameId||sameName) && p.name!==nm){ p.name=nm; ops.push(put('purchases',p)); }
    });
    Promise.all(ops).then(function(){ toast('Nama diubah: '+nm); return refresh(); });
  });
}

/* ================= bind ================= */
function bind(){
  /* keep the sticky section titles docked just below the sticky header:
     measure the real header height (varies with safe-area) into --head-h */
  var hdr=document.querySelector('header.top');
  function measureHead(){ if(hdr) document.documentElement.style.setProperty('--head-h', hdr.offsetHeight+'px'); }
  measureHead();
  window.addEventListener('resize',measureHead);
  if(window.visualViewport) window.visualViewport.addEventListener('resize',measureHead);

  /* keyboard-safe sheets: track the ACTUAL visible viewport height into --vvh.
     In an installed PWA (standalone) `dvh` is unreliable on some Android WebViews,
     so the add/rename bottom sheet is sized against visualViewport.height instead —
     when the keyboard opens, this shrinks immediately and the sheet rises above it. */
  function measureVVH(){
    var vv=window.visualViewport;
    var h=vv?vv.height:window.innerHeight;
    document.documentElement.style.setProperty('--vvh', h+'px');
  }
  measureVVH();
  window.addEventListener('resize',measureVVH);
  if(window.visualViewport){ window.visualViewport.addEventListener('resize',measureVVH); window.visualViewport.addEventListener('scroll',measureVVH); }

  /* bottom nav */
  document.querySelectorAll('nav.tabs .nav').forEach(function(b){ b.onclick=function(){ ACTIVE=b.getAttribute('data-tab'); applyTab(); }; });

  /* swipe left/right on the content area to switch tabs (in nav order).
     Per the user's convention: a left→right swipe (finger moves rightward) goes
     FORWARD to the next tab (wish → basket → history → more); right→left goes back.
     Guards: ignore when a sheet is open, when the gesture is mostly vertical (a
     scroll), when it is too short, or when it starts on a horizontally-scrollable
     element — so taps and vertical scrolls are never hijacked. */
  var TAB_ORDER=['wish','basket','history','more'];
  var swMain=document.querySelector('main'), tsx=0, tsy=0, tst=0, swActive=false;
  function anySheetOpen(){ return document.querySelector('.modal-bg.on')!==null; }
  if(swMain){
    swMain.addEventListener('touchstart',function(e){
      if(e.touches.length!==1||anySheetOpen()){ swActive=false; return; }
      var t=e.touches[0]; tsx=t.clientX; tsy=t.clientY; tst=Date.now(); swActive=true;
    },{passive:true});
    swMain.addEventListener('touchend',function(e){
      if(!swActive||anySheetOpen()) return; swActive=false;
      var t=e.changedTouches[0], dx=t.clientX-tsx, dy=t.clientY-tsy, dt=Date.now()-tst;
      /* decisive horizontal: far enough, mostly sideways, and reasonably quick */
      if(Math.abs(dx)<60 || Math.abs(dx)<Math.abs(dy)*1.8 || dt>600) return;
      var i=TAB_ORDER.indexOf(ACTIVE); if(i<0) return;
      var ni = dx>0 ? i+1 : i-1;          /* left→right = next, right→left = prev */
      if(ni<0 || ni>=TAB_ORDER.length) return;   /* no wrap at the ends */
      ACTIVE=TAB_ORDER[ni]; applyTab();
      try{ window.scrollTo(0,0); }catch(_){ }
    },{passive:true});
  }

  /* FAB + modal */
  $('fab').onclick=openModal;
  $('modalX').onclick=closeModal;
  $('modalBg').addEventListener('click',function(e){ if(e.target===$('modalBg')) closeModal(); });
  var w=$('wsearch');
  function wd(){ renderDrop($('wdrop'),w.value,true,true); }
  w.addEventListener('input',wd);
  // keep the field + the "Tambah" option directly below it above the on-screen keyboard
  // (CSS 100dvh handles modern Chrome; this is a fallback for WebViews that ignore dvh)
  w.addEventListener('focus',function(){ setTimeout(function(){ try{ w.scrollIntoView({block:'start',behavior:'smooth'}); }catch(e){ try{ w.scrollIntoView(); }catch(_){} } },300); });
  w.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); var t=w.value.trim(); if(t) addWish(t); } });
  $('wdrop').addEventListener('click',function(e){
    var eb=e.target.closest('[data-catedit]');
    if(eb){ e.stopPropagation(); renameItem(+eb.getAttribute('data-catedit')); return; }
    var db2=e.target.closest('[data-catdel]');
    if(db2){ e.stopPropagation(); var did=+db2.getAttribute('data-catdel'); var dc=catById(did); if(!dc)return;
      confirmSheet('Hapus “'+dc.name+'” dari daftar?', 'Item ini beserta riwayat harganya dihapus permanen. Berguna kalau namanya salah ketik. Tidak bisa dibatalkan.', 'Ya, hapus', function(){
        removeItem(did).then(function(){ renderDrop($('wdrop'),$('wsearch').value,true,true); }); // keep modal open, refresh list
      });
      return;
    }
    var o=e.target.closest('.opt'); if(!o)return;
    if(o.getAttribute('data-new')!=null) addWish(o.getAttribute('data-new'));
    else if(o.getAttribute('data-cat')!=null){ var c=catById(+o.getAttribute('data-cat')); if(c) addWish(c.name); }
  });

  /* wishlist interactions (event delegation) */
  $('wishBox').addEventListener('click',function(e){ var b;
    if((b=e.target.closest('[data-tobasket]'))) toBasket(+b.getAttribute('data-tobasket'));
    else if((b=e.target.closest('[data-edit]'))) renameItem(+b.getAttribute('data-edit'));
    else if((b=e.target.closest('[data-check]'))) beginCheck(+b.getAttribute('data-check'));
    else if((b=e.target.closest('[data-pop]'))) togglePop(+b.getAttribute('data-pop'));
    else if((b=e.target.closest('[data-del]'))) removeItem(+b.getAttribute('data-del'));
  });
  $('wishBox').addEventListener('keydown',function(e){
    if(e.key!=='Enter') return;
    var p=e.target.closest('[data-price]'); if(p){ e.preventDefault(); var q=$('qin_'+p.getAttribute('data-price')); if(q){ q.focus(); q.select(); } return; }
    var qf=e.target.closest('[data-qty]'); if(qf){ e.preventDefault(); toBasket(+qf.getAttribute('data-qty')); }
  });
  /* live thousand-separator formatting in the price field (534534 -> 534.534) + qty digits-only, both refresh the subtotal */
  $('wishBox').addEventListener('input',function(e){
    var p=e.target.closest('[data-price]');
    if(p){ var f=groupDigits(p.value); if(f!==p.value){ p.value=f; try{ p.setSelectionRange(f.length,f.length); }catch(_){} } updateSub(+p.getAttribute('data-price')); return; }
    var q=e.target.closest('[data-qty]');
    if(q){ var d=q.value.replace(/\D/g,''); if(d!==q.value){ q.value=d; } updateSub(+q.getAttribute('data-qty')); }
  });

  /* basket interactions */
  $('basketBox').addEventListener('click',function(e){ var b;
    if((b=e.target.closest('[data-bedit]'))) toggleBedit(+b.getAttribute('data-bedit'));
    else if((b=e.target.closest('[data-edit]'))) renameItem(+b.getAttribute('data-edit'));
    else if((b=e.target.closest('[data-uncheck]'))) fromBasket(+b.getAttribute('data-uncheck'));
  });
  /* edit price/qty directly in the basket: persist to the catalog item's
     checkPrice/checkQty and refresh the line + grand total live. */
  $('basketBox').addEventListener('input',function(e){
    var p=e.target.closest('[data-bprice]');
    if(p){ var f=groupDigits(p.value); if(f!==p.value){ p.value=f; try{ p.setSelectionRange(f.length,f.length); }catch(_){} } saveBasketEdit(+p.getAttribute('data-bprice')); return; }
    var q=e.target.closest('[data-bqty]');
    if(q){ var d=q.value.replace(/\D/g,''); if(d!==q.value){ q.value=d; } saveBasketEdit(+q.getAttribute('data-bqty')); }
  });
  $('basketBox').addEventListener('keydown',function(e){
    if(e.key!=='Enter') return;
    var p=e.target.closest('[data-bprice]'); if(p){ e.preventDefault(); var q=$('bqin_'+p.getAttribute('data-bprice')); if(q){ q.focus(); q.select(); } return; }
    var qf=e.target.closest('[data-bqty]'); if(qf){ e.preventDefault(); e.target.blur(); }
  });
  $('payBtn').onclick=payAll;

  /* history search */
  var hs=$('hsearch'); hs._catId=null;
  function hd(){ renderDrop($('hdrop'),hs.value,false); }
  hs.addEventListener('input',hd); hs.addEventListener('focus',hd);
  $('hdrop').addEventListener('click',function(e){ var eb=e.target.closest('[data-catedit]'); if(eb){ e.stopPropagation(); renameItem(+eb.getAttribute('data-catedit')); return; } var o=e.target.closest('.opt[data-cat]'); if(!o)return; var cid=+o.getAttribute('data-cat'); var c=catById(cid); hs.value=c?c.name:''; hs._catId=cid; $('hdrop').classList.remove('on'); renderLook(cid); });

  /* settings */
  $('exportBtn').onclick=exportData;
  $('importBtn').onclick=function(){ $('importFile').click(); };
  $('importFile').addEventListener('change',function(e){ if(e.target.files[0]) importData(e.target.files[0]); e.target.value=''; });
  $('clearBtn').onclick=clearAll;

  /* delete a single purchase from history (and its matching price observation) */
  $('histBox').addEventListener('click',function(e){
    var b=e.target.closest('[data-hdel]'); if(!b)return;
    var pid=+b.getAttribute('data-hdel'); var it=PURCH.filter(function(x){ return x.id===pid; })[0]; if(!it)return;
    confirmSheet('Hapus pembelian ini?', '“'+it.name+'” ('+money(it.price)+') akan dihapus dari riwayat, termasuk catatan harganya. Tindakan ini tidak bisa dibatalkan.', 'Ya, hapus', function(){
      // a purchase writes one matching price row (same catId + same ts); remove it too so the last-price hint updates
      var pr=PRICES.filter(function(x){ return x.catId===it.catId && x.ts===it.ts; });
      var ops=[del('purchases',pid)].concat(pr.map(function(x){ return del('prices',x.id); }));
      Promise.all(ops).then(function(){ toast('Pembelian dihapus'); return refresh(); }).catch(function(){ toast('Gagal menghapus'); });
    });
  });

  /* history retention selector (1/2/3 months) */
  var seg=$('retainSeg');
  function paintRetain(){ var cur=getRetain(); seg.querySelectorAll('button').forEach(function(b){ b.classList.toggle('on',+b.getAttribute('data-m')===cur); }); }
  paintRetain();
  seg.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b)return; var m=+b.getAttribute('data-m'); if(m===getRetain())return; setRetain(m); paintRetain(); purgeOld().then(function(n){ toast(n>0?('Riwayat disetel '+m+' bulan · '+n+' pembelian lama dihapus'):('Riwayat disetel '+m+' bulan')); return refresh(); }); });

  /* appearance (theme) selector: Terang / Gelap / Sistem */
  var tseg=$('themeSeg');
  function paintTheme(){ var cur=getTheme(); tseg.querySelectorAll('button').forEach(function(b){ b.classList.toggle('on',b.getAttribute('data-theme')===cur); }); }
  paintTheme();
  tseg.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b)return; var t=b.getAttribute('data-theme'); if(t===getTheme())return; setTheme(t); paintTheme(); toast(t==='light'?'Tema terang':t==='dark'?'Tema gelap':'Tema mengikuti sistem'); });
  // when on "system", follow live OS light/dark changes (updates the chrome color)
  if(window.matchMedia){ var mq=window.matchMedia('(prefers-color-scheme:dark)'); var onMq=function(){ if(getTheme()==='system') applyTheme('system'); }; if(mq.addEventListener) mq.addEventListener('change',onMq); else if(mq.addListener) mq.addListener(onMq); }

  /* confirm sheet */
  $('confirmYes').onclick=function(){ var cb=_confirmCb; var keep=false; if(cb){ keep=(cb()===false); } if(!keep) closeConfirm(); };
  $('confirmNo').onclick=closeConfirm;
  $('confirmInput').addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); $('confirmYes').click(); } });
  $('confirmBg').addEventListener('click',function(e){ if(e.target===$('confirmBg')) closeConfirm(); });

  /* close dropdowns when tapping outside */
  document.addEventListener('click',function(e){
    if(!e.target.closest('.searchbox')){ $('hdrop').classList.remove('on'); }
    // collapse an open inline panel (price entry / price history) when tapping outside its item
    if(OPEN_ID!=null || CHECK_ID!=null){
      var openId = CHECK_ID!=null?CHECK_ID:OPEN_ID;
      var inItem = e.target.closest('[data-item="'+openId+'"]');
      if(!inItem){ OPEN_ID=null; CHECK_ID=null; renderWish(); }
    }
  });
}

/* ================= init ================= */
(function init(){
  openDB()
    .then(reload)
    .then(purgeOld)
    .then(reload)
    .then(syncHistoryNames)
    .then(reload)
    .then(function(){ applyTheme(getTheme()); bind(); applyTab(); renderWish(); renderBasket(); renderHistory(); updateStat(); })
    .catch(function(err){ document.querySelector('main').innerHTML='<div class="empty">Gagal membuka penyimpanan.<br>'+esc(err&&err.message||err)+'</div>'; });
})();
