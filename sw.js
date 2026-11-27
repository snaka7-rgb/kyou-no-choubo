/* きょうの帳簿：ネットが無くても開けるための Service Worker
   - 同じフォルダの index.html だけを扱う（ほかのリクエストには触らない）
   - キャッシュにあればすぐ返し（cache-first）、裏で新しい版を取りに行って、中身が変わっていればキャッシュを差し替えて画面に知らせる
     （stale-while-revalidate）。記録データは localStorage にあり、ここでは一切扱わない */
var VERSION = '2.7';
var CACHE_PREFIX = 'kyou-no-choubo-';
var CACHE = CACHE_PREFIX + 'v' + VERSION;
var PAGE = new URL('index.html', self.registration.scope).href;
var ROOT = self.registration.scope;

self.addEventListener('install', function(ev){
  ev.waitUntil(
    caches.open(CACHE).then(function(c){
      return fetch(PAGE, { cache: 'no-cache' }).then(function(res){ if (res.ok) return c.put(PAGE, res); });
    }).catch(function(){}).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(ev){
  ev.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function isPage(req){
  if (req.method !== 'GET') return false;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return false;
  var path = u.origin + u.pathname;
  return path === PAGE || path === ROOT || (req.mode === 'navigate' && path.indexOf(ROOT) === 0 && /\/(index\.html)?$/.test(u.pathname));
}

/* 中身が変わったら、開いている画面へ「新しい版があります」を知らせる。
   開いたばかりの画面はまだ用意できていないことがあるので、少し待って何回か送る */
function notify(clientId){
  var tries = 0;
  function send(){
    tries++;
    return self.clients.matchAll({ type: 'window' }).then(function(list){
      var hit = false;
      list.forEach(function(c){ c.postMessage({ type: 'choubo-updated', version: VERSION }); if (!clientId || c.id === clientId) hit = true; });
      if (!hit && tries < 10) return new Promise(function(r){ setTimeout(r, 500); }).then(send);
    });
  }
  return send();
}

/* oldCopy は画面へ返す前に複製しておいたキャッシュの中身（返したあとでは読めないため） */
function revalidate(cache, oldCopy, clientId){
  return fetch(PAGE, { cache: 'no-cache' }).then(function(res){
    if (!res || !res.ok) return;
    var copy = res.clone();
    return Promise.all([res.text(), oldCopy ? oldCopy.text() : Promise.resolve(null)]).then(function(t){
      if (t[1] !== null && t[0] === t[1]) return;
      return cache.put(PAGE, copy).then(function(){ if (t[1] !== null) return notify(clientId); });
    });
  }).catch(function(){ /* ネットが無いときは何もしない */ });
}

self.addEventListener('fetch', function(ev){
  var req = ev.request;
  if (!isPage(req)) return;
  ev.respondWith(caches.open(CACHE).then(function(cache){
    return cache.match(PAGE).then(function(cached){
      var upd = revalidate(cache, cached ? cached.clone() : null, ev.resultingClientId || ev.clientId);
      ev.waitUntil(upd);
      if (cached) return cached;
      /* まだキャッシュが無い：ネットから取る（取れなければ失敗のまま） */
      return fetch(req).then(function(res){ return res; });
    });
  }));
});
