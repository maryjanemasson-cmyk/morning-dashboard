// friend-mode.js — sandbox shim for sharing the wardrobe + outfit gallery.
//
// Activated by ?friend=1 in the URL. Replaces firebase.database() with a
// localStorage-backed version, so all reads come from a snapshot of the
// owner's data (friend-snapshot.json, fetched once and cached) plus any
// edits the visitor has made on this device. All writes stay local — they
// never reach the real Firebase, so the visitor cannot corrupt the owner's
// data no matter what they do.
//
// Pages that include this script:
//   - wardrobe.html
//   - outfit-gallery.html
// Include order matters: this MUST run BEFORE the page's firebase.initializeApp call.
(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has('friend')) return; // not in sandbox mode

  const STORAGE_KEY = 'morningDashboardFriendData_v1';
  const SNAPSHOT_URL = 'friend-snapshot.json';

  let data = null;
  let loadPromise = null;
  const listeners = {}; // path string -> [callback]

  function clonePath(parts, target) {
    // Ensure each intermediate node is an object so nested writes work.
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] === undefined || cur[p] === null || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
        cur[p] = {};
      }
      cur = cur[p];
    }
    return cur;
  }

  function getByPath(path) {
    const parts = String(path).split('/').filter(Boolean);
    let cur = data;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[p];
    }
    return cur === undefined ? null : cur;
  }

  function setByPath(path, value) {
    const parts = String(path).split('/').filter(Boolean);
    if (!parts.length) { data = value; return; }
    const parent = clonePath(parts, data);
    const last = parts[parts.length - 1];
    if (value === null || value === undefined) {
      delete parent[last];
    } else {
      parent[last] = value;
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[friend-mode] localStorage write failed', e);
    }
  }

  function notify(path) {
    // Trigger any listener whose subscribed path is this exact path or any ancestor.
    const parts = String(path).split('/').filter(Boolean);
    for (let i = parts.length; i >= 0; i--) {
      const subPath = parts.slice(0, i).join('/');
      const callbacks = listeners[subPath];
      if (!callbacks || !callbacks.length) continue;
      const val = subPath ? getByPath(subPath) : data;
      callbacks.forEach(cb => {
        try { cb({ val: () => val, key: subPath.split('/').pop() || null }); }
        catch (e) { console.warn('[friend-mode] listener error', e); }
      });
    }
  }

  function ensureLoaded() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try { data = JSON.parse(stored); return; } catch {}
      }
      const resp = await fetch(SNAPSHOT_URL + '?v=' + Date.now());
      data = await resp.json();
      persist();
    })();
    return loadPromise;
  }

  function makeRef(path) {
    path = String(path || '').replace(/^\/+|\/+$/g, '');
    return {
      key: path.split('/').pop() || null,
      on(eventType, callback) {
        if (eventType !== 'value') return;
        ensureLoaded().then(() => {
          callback({ val: () => getByPath(path), key: path.split('/').pop() || null });
          if (!listeners[path]) listeners[path] = [];
          listeners[path].push(callback);
        });
      },
      off(eventType, callback) {
        if (!listeners[path]) return;
        if (callback) listeners[path] = listeners[path].filter(c => c !== callback);
        else listeners[path] = [];
      },
      once(eventType) {
        return ensureLoaded().then(() => ({ val: () => getByPath(path), key: path.split('/').pop() || null }));
      },
      set(value) {
        return ensureLoaded().then(() => { setByPath(path, value); persist(); notify(path); });
      },
      update(updates) {
        return ensureLoaded().then(() => {
          Object.entries(updates).forEach(([k, v]) => setByPath(path + '/' + k, v));
          persist(); notify(path);
        });
      },
      remove() {
        return ensureLoaded().then(() => { setByPath(path, null); persist(); notify(path); });
      },
      push(value) {
        const key = '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const childPath = path + '/' + key;
        const childRef = makeRef(childPath);
        if (value !== undefined) childRef.set(value);
        return childRef;
      },
      child(childPath) { return makeRef(path + '/' + childPath); },
    };
  }

  function installShim() {
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      setTimeout(installShim, 30);
      return;
    }
    // Replace database() so all `db.ref(...)` returns our shim.
    const shimDB = { ref(path) { return makeRef(path || ''); } };
    firebase.database = function () { return shimDB; };
    // Some pages call initializeApp explicitly; make it a no-op-safe.
    const origInit = firebase.initializeApp;
    firebase.initializeApp = function () {
      try { return origInit.apply(this, arguments); }
      catch (e) { /* already initialized — fine */ }
    };
  }
  installShim();

  // Keep nav links inside the same origin in sandbox mode.
  function rewriteLinks() {
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href || /^https?:|^mailto:|^#|^javascript:/i.test(href)) return;
      // Only annotate links that go to .html pages within the site
      if (!href.endsWith('.html') && !href.includes('.html?')) return;
      if (href.includes('friend=')) return;
      const sep = href.includes('?') ? '&' : '?';
      a.setAttribute('href', href + sep + 'friend=1');
    });
  }

  function addBanner() {
    const banner = document.createElement('div');
    banner.id = 'friend-mode-banner';
    banner.innerHTML = `
      <span>👋 <strong>Sandbox mode</strong> — your changes stay on this iPad. Nothing syncs back to Mary Jane.</span>
      <button id="friend-reset-btn">Reset to original</button>
    `;
    banner.style.cssText = 'position:sticky;top:0;left:0;right:0;background:#c9b99a;color:#fff;text-align:center;padding:0.5rem 1rem;font-size:0.82rem;z-index:99999;font-family:Inter,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;gap:1rem;flex-wrap:wrap;';
    const resetBtn = banner.querySelector('#friend-reset-btn');
    resetBtn.style.cssText = 'background:#fff;color:#6b5d4d;border:none;border-radius:14px;padding:0.25rem 0.8rem;font-size:0.75rem;cursor:pointer;font-family:inherit;';
    resetBtn.onclick = () => {
      if (!confirm('Reset back to the original wardrobe? You\'ll lose any changes you\'ve made on this iPad.')) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    };
    document.body.insertBefore(banner, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { rewriteLinks(); addBanner(); });
  } else {
    rewriteLinks(); addBanner();
  }
})();
