// ==========================================================================
// MEMOVIA — Demenz-Trainings-App
// ==========================================================================

// =========== STORAGE-POLYFILL ===========
// Falls window.storage nicht existiert (z.B. im normalen Browser ohne native
// Brücke), nutzen wir localStorage als Fallback. So funktioniert die App
// überall — iOS-App, Android-WebView, Browser.
if (typeof window.storage === 'undefined' || !window.storage) {
  console.log('[Memovia] window.storage nicht da — nutze localStorage-Polyfill');
  window.storage = {
    get: async function(key) {
      const v = localStorage.getItem('memora_' + key);
      if (v === null) throw new Error('Key not found: ' + key);
      return { key: key, value: v, shared: false };
    },
    set: async function(key, value) {
      localStorage.setItem('memora_' + key, value);
      return { key: key, value: value, shared: false };
    },
    delete: async function(key) {
      localStorage.removeItem('memora_' + key);
      return { key: key, deleted: true, shared: false };
    },
    list: async function(prefix) {
      const p = 'memora_' + (prefix || '');
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(p)) keys.push(k.substring(7));
      }
      return { keys: keys, prefix: prefix || '', shared: false };
    }
  };
}

// =========== AUTHENTICATION / ACCOUNTS ===========
// Lokale Account-Verwaltung mit Hashing. Speichert mehrere Accounts auf dem
// Gerät, jeder mit eigenem Datenbereich. Daten bleiben lokal — keine Cloud.
//
// Storage-Struktur:
//   memora-accounts     → Liste aller Accounts (E-Mail, Hash, Name, ID)
//   memora-current-user → aktueller eingeloggter Account
//   memora-state-{userId} → Spielstand pro Account

let currentUser = null;  // { id, email, name }

// Storage-Key für den State des aktuellen Users
function getStateKey() {
  if (!currentUser) return 'memora-state-guest';
  return `memora-state-${currentUser.id}`;
}

// Einfaches Passwort-Hashing. Nutzt crypto.subtle wo verfügbar, sonst
// einen reinen JS-Fallback. Wichtig: muss in WKWebView (iOS) zuverlässig
// funktionieren, auch ohne sicheren Kontext (https/secure origin).
async function hashPassword(password) {
  const salted = password + '_memovia_salt_2026';
  // Versuch 1: crypto.subtle (modern, sicher)
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      const data = new TextEncoder().encode(salted);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch(e) {
    // fall through to simple hash
  }
  // Fallback: einfacher JS-Hash (FNV-1a 32-bit, doppelt für mehr Bits)
  // Nicht so sicher wie SHA-256, reicht aber für unsere lokale Account-Trennung
  let h1 = 0x811c9dc5, h2 = 0x84222325;
  for (let i = 0; i < salted.length; i++) {
    h1 ^= salted.charCodeAt(i);
    h1 = (h1 * 0x01000193) >>> 0;
    h2 ^= salted.charCodeAt(i) * 7;
    h2 = (h2 * 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

async function authLoadAccounts() {
  try {
    const r = await window.storage.get('memora-accounts');
    if (r && r.value) return JSON.parse(r.value);
  } catch(e) {}
  return [];
}
async function authSaveAccounts(accounts) {
  await window.storage.set('memora-accounts', JSON.stringify(accounts));
}

async function authRegister(email, password, name) {
  // 1. Grundformat prüfen
  const emailPattern = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
  if (!emailPattern.test(email)) {
    throw new Error('Bitte eine gültige E-Mail-Adresse eingeben (z.B. name@email.de).');
  }
  // 2. Domain-Endung prüfen — bekannte gültige TLDs
  const lowerEmail = email.toLowerCase();
  const tld = lowerEmail.split('.').pop();
  const validTlds = ['de','com','org','net','at','ch','eu','io','app','dev','info','biz','me','co','uk','us','ca','fr','it','es','nl','be','dk','se','no','fi','pl','cz','jp','cn','au','nz','br','mx','ar','edu','gov','mil','ai','xyz','online','site','shop','blog','tech','cloud','digital','life','live','news','today','tv','email','mail','academy','school','university','health','company','agency','studio','design'];
  if (!validTlds.includes(tld)) {
    throw new Error('Die Domain-Endung „.' + tld + '" wird nicht erkannt. Bitte echte E-Mail-Adresse verwenden.');
  }
  // 3. Häufige Tippfehler bei großen Anbietern abfangen
  const typoMap = {
    'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmai.com': 'gmail.com',
    'gmial.de': 'gmail.com', 'gmial.com.de': 'gmail.com',
    'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yaoo.com': 'yahoo.com',
    'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotnail.com': 'hotmail.com',
    'gmx.dee': 'gmx.de', 'gmx.ed': 'gmx.de',
    'web.dee': 'web.de', 'webb.de': 'web.de',
    't-online.dee': 't-online.de', 'tonline.de': 't-online.de',
    'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
    'icloud.de': 'icloud.com', 'iclud.com': 'icloud.com',
  };
  const domain = lowerEmail.split('@')[1];
  if (typoMap[domain]) {
    throw new Error('Meinten Sie „' + lowerEmail.split('@')[0] + '@' + typoMap[domain] + '"? Bitte E-Mail korrigieren.');
  }
  // 4. Lokal-Teil mindestens 2 Zeichen
  const local = lowerEmail.split('@')[0];
  if (local.length < 2) {
    throw new Error('Der Teil vor dem @ ist zu kurz.');
  }
  // 5. Passwort
  if (password.length < 6) {
    throw new Error('Das Passwort muss mindestens 6 Zeichen lang sein.');
  }
  // 6. Account-Check
  const accounts = await authLoadAccounts();
  if (accounts.some(a => a.email.toLowerCase() === lowerEmail)) {
    throw new Error('Diese E-Mail ist bereits registriert.');
  }
  const hash = await hashPassword(password);
  const id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const account = { id, email, name: name || email.split('@')[0], hash, createdAt: Date.now() };
  accounts.push(account);
  await authSaveAccounts(accounts);
  return account;
}

async function authLogin(email, password) {
  const accounts = await authLoadAccounts();
  const account = accounts.find(a => a.email.toLowerCase() === email.toLowerCase());
  if (!account) throw new Error('Diese E-Mail ist nicht registriert.');
  const hash = await hashPassword(password);
  if (account.hash !== hash) throw new Error('Falsches Passwort.');
  return account;
}

async function authSetCurrentUser(account) {
  currentUser = { id: account.id, email: account.email, name: account.name };
  await window.storage.set('memora-current-user', JSON.stringify(currentUser));
}

async function authGetCurrentUser() {
  try {
    const r = await window.storage.get('memora-current-user');
    if (r && r.value) return JSON.parse(r.value);
  } catch(e) {}
  return null;
}

async function authLogout() {
  try { await window.storage.delete('memora-current-user'); } catch(e) {}
  currentUser = null;
  location.reload();  // sauberer Neustart
}

// Notfall: alle Daten löschen falls etwas korrupt ist
async function authResetEverything() {
  if (!confirm('Wirklich alle Daten zurücksetzen? Alle Accounts und Spielstände werden gelöscht.')) return;
  try {
    // Alle memora_-Keys löschen
    if (typeof localStorage !== 'undefined') {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('memora_')) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
    }
    // Auch über die storage-Bridge
    const list = await window.storage.list('');
    if (list && list.keys) {
      for (const k of list.keys) {
        try { await window.storage.delete(k); } catch(e) {}
      }
    }
  } catch(e) {
    console.error('Reset error:', e);
  }
  alert('Daten wurden zurückgesetzt. Die App startet neu.');
  location.reload();
}

// Notfall: ohne Anmeldung ins App
async function authSkipLogin() {
  currentUser = { id: 'guest', email: 'gast@memovia.local', name: 'Gast' };
  try { await window.storage.set('memora-current-user', JSON.stringify(currentUser)); } catch(e) {}
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = '';
  try {
    await initApp();
  } catch(e) {
    console.error('initApp Fehler:', e);
    alert('Hinweis: ' + (e.message || 'Beim Laden ist ein Fehler aufgetreten.'));
  }
}

// UI-Handler
let authMode = 'login';  // 'login' oder 'register'

function authToggleMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  document.getElementById('authTitle').textContent = authMode === 'login' ? 'Anmelden' : 'Konto erstellen';
  document.getElementById('authSubtitle').textContent = authMode === 'login'
    ? 'Geben Sie Ihre Zugangsdaten ein.'
    : 'Erstellen Sie ein neues Konto.';
  document.getElementById('authNameField').style.display = authMode === 'register' ? '' : 'none';
  document.getElementById('authSubmit').textContent = authMode === 'login' ? 'Anmelden' : 'Konto erstellen';
  document.getElementById('authToggleMode').innerHTML = authMode === 'login'
    ? 'Noch kein Konto? <strong>Jetzt registrieren</strong>'
    : 'Schon ein Konto? <strong>Anmelden</strong>';
  document.getElementById('authError').textContent = '';
}

async function authSubmit() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value.trim();
  const errEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmit');
  errEl.textContent = '';

  if (!email || !password) {
    errEl.textContent = 'Bitte E-Mail und Passwort eingeben.';
    return;
  }

  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Bitte warten…';
  submitBtn.disabled = true;

  let account = null;
  try {
    if (authMode === 'register') {
      account = await authRegister(email, password, name);
    } else {
      account = await authLogin(email, password);
    }
    await authSetCurrentUser(account);
  } catch(e) {
    console.error('[Memovia] Auth-Fehler:', e);
    errEl.textContent = (e && e.message) ? e.message : 'Ein Fehler ist aufgetreten. Bitte erneut versuchen.';
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
    return;
  }

  // Auth erfolgreich — App-View einblenden
  // Wichtig: das passiert AUSSERHALB des try-Blocks oben, damit ein Fehler in
  // initApp nicht den Login-Bildschirm wieder einblendet.
  try {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = '';
    await initApp();
  } catch(e) {
    console.error('[Memovia] initApp-Fehler:', e);
    // Auch wenn initApp einen Fehler wirft, bleibt der User eingeloggt und sieht die App
    alert('Hinweis: ' + (e.message || 'Beim Laden der App ist ein Fehler aufgetreten. Bitte App neu starten.'));
  }
}

// =========== STATE ===========
let people = [
  { name: 'Anna', relation: 'Tochter', initial: 'A', note: 'Annas Lieblingsblume sind Tulpen' },
  { name: 'Tobias', relation: 'Enkel', initial: 'T', note: '' },
  { name: 'Marie', relation: 'Ehefrau', initial: 'M', note: 'Heirat 1962 in München' },
  { name: 'Herbert', relation: 'Bruder', initial: 'H', note: '' },
];
let activeTypes = null; // persistiert welche Aufgabentypen aktiv sind
let dementiaStage = 3; // 1-10, beeinflusst wie oft Personen-Aufgaben kommen

// minStage = ab welchem Stadium darf der Typ aktiv ausgewählt werden
// (auch wenn aktiviert, wird er bei niedrigerem Stadium übersprungen — zu einfach)
const TASK_TYPES = [
  { id: 'recognize',   name: 'Wer ist das?',     desc: 'Personen wiedererkennen',  defaultActive: true,  minStage: 4 },
  { id: 'whatIsIt',    name: 'Was ist das?',     desc: 'Bilder benennen',           defaultActive: true,  minStage: 6 },
  { id: 'whatFood',    name: 'Welches Essen?',   desc: 'Mahlzeiten erkennen',       defaultActive: true,  minStage: 6 },
  { id: 'whereIsThis', name: 'Wo ist das?',      desc: 'Wahrzeichen & Orte',        defaultActive: true,  minStage: 6 },
  { id: 'category',    name: 'Was passt nicht?', desc: 'Kategorien & Logik',        defaultActive: true,  minStage: 1 },
  { id: 'proverb',     name: 'Sprichwörter',     desc: 'Sätze ergänzen',            defaultActive: true,  minStage: 1 },
  { id: 'numbers',     name: 'Zahlenreihen',     desc: 'Muster erkennen',           defaultActive: true,  minStage: 1 },
  { id: 'orientation', name: 'Orientierung',     desc: 'Zeit, Ort, Datum',          defaultActive: true,  minStage: 6 },
  { id: 'math',        name: 'Kopfrechnen',      desc: 'Plus, Minus, Mal',          defaultActive: true,  minStage: 1 },
  { id: 'opposites',   name: 'Gegenteile',       desc: 'Antonyme finden',           defaultActive: true,  minStage: 1 },
  { id: 'synonyms',    name: 'Synonyme',         desc: 'Gleiche Bedeutung',         defaultActive: true,  minStage: 1 },
  { id: 'wordfind',    name: 'Wortfindung',      desc: 'Wörter mit Buchstaben',     defaultActive: true,  minStage: 1 },
  { id: 'animalKids',  name: 'Tierkinder',       desc: 'Wie heißt das Junge?',      defaultActive: true,  minStage: 4 },
  { id: 'professions', name: 'Berufe',           desc: 'Wer arbeitet mit was?',     defaultActive: true,  minStage: 1 },
  { id: 'homonyms',    name: 'Doppeldeutige Wörter', desc: 'Welches Wort hat zwei Bedeutungen?', defaultActive: true, minStage: 1 },
  { id: 'semantic',    name: 'Wortreihen',       desc: 'Welches Wort passt nicht?', defaultActive: true,  minStage: 1 },
  { id: 'lueckentext', name: 'Lückentexte',      desc: 'Sätze sinnvoll vervollständigen', defaultActive: true, minStage: 1 },
  { id: 'allgemein',   name: 'Allgemeinwissen',  desc: 'Hauptstädte, Marken, Quiz', defaultActive: true,  minStage: 1 },
  { id: 'analogien',   name: 'Analogien',        desc: 'A verhält sich zu B wie C zu …', defaultActive: true, minStage: 1 },
  { id: 'komposita',   name: 'Wörter zusammensetzen', desc: 'Welches Wort ergibt sich?', defaultActive: true, minStage: 1 },
  { id: 'reihenfolge', name: 'Reihenfolge',      desc: 'Größer/kleiner sortieren',  defaultActive: true,  minStage: 1 },
  { id: 'rhymes',      name: 'Reimwörter',       desc: 'Welches reimt sich?',       defaultActive: true,  minStage: 6 },
  { id: 'wordpair',    name: 'Wortpaare',        desc: 'Was gehört zusammen?',      defaultActive: true,  minStage: 4 },
  { id: 'memory',      name: 'Memory',           desc: 'Symbol merken',             defaultActive: true,  minStage: 1 },
];

let skill = {};
let repeatQueue = [];
let sessionStats = { total: 0, correct: 0 };
let currentTask = null;
let currentTaskMeta = null;
let answered = false;
let progressIndex = 0;

// Personen-Tracking
let personStats = {};
let lastRecognizeAt = -999;

// KI-Pool
let aiPool = { proverb: [], opposites: [], whatIsIt: [], whatFood: [], whereIsThis: [] };
let aiGenerating = false;

// === ANTI-WIEDERHOLUNG: Rotation-System ===
// Jedes Item wird nach Verwendung gemerkt. Es kann nicht erneut gezeigt werden,
// solange noch ungesehene Items verfügbar sind. Erst wenn fast der ganze Pool durch
// ist, werden die ältesten Items wieder freigegeben (sanfter Reset).
let recentItems = {
  whatIsIt: [],
  whatFood: [],
  whereIsThis: [],
  category: [],
  proverb: [],
  opposites: [],
  rhymes: [],
  wordpair: [],
  numbers: [],
  math: [],
  recognize: [],
  orientation: [],
  memory: [],
  synonyms: [],
  wordfind: [],
  animalKids: [],
  professions: [],
  homonyms: [],
  semantic: [],
  lueckentext: [],
  allgemein: [],
  analogien: [],
  komposita: [],
  reihenfolge: [],
};

// Pending-Tracking: Generator-Aufrufe sammeln Tracking-Infos hier,
// nextTask committed sie erst NACH erfolgreicher Aufgabe-Verifizierung.
// Sonst wird ein Item als "gesehen" markiert obwohl es nie gezeigt wurde.
let pendingTracking = [];

function rememberRecent(typeId, key, poolSize) {
  // Wird im Generator aufgerufen — geht in pending, wird erst beim Commit aktiv
  pendingTracking.push({ typeId, key, poolSize });
}

function commitPendingTracking() {
  for (const { typeId, key, poolSize } of pendingTracking) {
    if (!recentItems[typeId]) recentItems[typeId] = [];
    const existing = recentItems[typeId].indexOf(key);
    if (existing >= 0) recentItems[typeId].splice(existing, 1);
    recentItems[typeId].push(key);
    // Sanfter Reset: wenn fast der ganze Pool gesehen wurde, ältere 50% rauswerfen
    if (poolSize && recentItems[typeId].length >= Math.max(3, poolSize - 1)) {
      const keep = Math.floor(poolSize / 2);
      recentItems[typeId] = recentItems[typeId].slice(-keep);
    }
  }
  pendingTracking = [];
}

function discardPendingTracking() {
  pendingTracking = [];
}
function isRecent(typeId, key) {
  // Sowohl committed als auch pending Items berücksichtigen
  if (recentItems[typeId] && recentItems[typeId].includes(key)) return true;
  if (pendingTracking.some(p => p.typeId === typeId && p.key === key)) return true;
  return false;
}
// Hilfsfunktion: filtert Pool zu noch ungesehenen Items.
// Wenn alle gesehen: gibt vollen Pool zurück (Reset wird im rememberRecent gemacht)
function freshFromPool(typeId, pool, keyFn) {
  keyFn = keyFn || (it => it);
  const fresh = pool.filter(it => !isRecent(typeId, keyFn(it)));
  return fresh.length > 0 ? fresh : pool;
}

// =========== BILDER (OFFLINE - Emoji-SVGs, immer verfügbar) ===========
// Externe Bilder funktionieren in vielen Umgebungen nicht (CORS, Blockierungen).
// Stattdessen: schöne SVG-Bilder mit Emojis als zentralem Icon — laden sofort.
const wikiCache = {};
const wikiInflight = {};

async function fetchWikiImage(keyword) {
  // Sofort: Offline-Bild aus Emoji-Map erzeugen
  if (wikiCache[keyword]) return wikiCache[keyword];
  const url = getOfflineImage(keyword);
  wikiCache[keyword] = url;
  return url;
}

async function precacheCommonImages(progressCallback) {
  // Bilder sind im Code, kein Pre-Cache nötig
  if (progressCallback) progressCallback(1, 1, true);
}

async function loadPersistentImageCache() {
  // Nichts zu tun — Bilder sind im Code
}

function imgUrl(keyword) {
  return '__WIKI__:' + keyword;
}


// =========== HELPERS ===========
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Pick aus Array, das nicht in "recent" ist. Falls alle recent → ältesten nehmen.
function pickFresh(typeId, items, keyFn) {
  keyFn = keyFn || (it => JSON.stringify(it));
  const fresh = items.filter(it => !isRecent(typeId, keyFn(it)));
  if (fresh.length > 0) return pickRandom(fresh);
  return pickRandom(items); // alle waren recent — nimm Zufall
}

// =========== PERSISTENCE ===========
async function loadState() {
  try {
    const r = await window.storage.get(getStateKey());
    if (r && r.value) {
      const s = JSON.parse(r.value);
      if (s.skill) skill = s.skill;
      if (s.repeatQueue) repeatQueue = s.repeatQueue;
      if (s.sessionStats) sessionStats = s.sessionStats;
      if (s.people) people = s.people;
      if (s.aiPool) aiPool = { ...aiPool, ...s.aiPool };
      if (s.personStats) personStats = s.personStats;
      if (typeof s.lastRecognizeAt === 'number') lastRecognizeAt = s.lastRecognizeAt;
      if (s.recentItems) recentItems = { ...recentItems, ...s.recentItems };
      if (s.activeTypes) activeTypes = s.activeTypes;
      if (typeof s.dementiaStage === 'number') dementiaStage = s.dementiaStage;
      if (s.failedImages && Array.isArray(s.failedImages)) {
        for (const kw of s.failedImages) imageStatus[kw] = 'failed';
      }
    }
  } catch(e) {}
  TASK_TYPES.forEach(t => {
    if (!skill[t.id]) skill[t.id] = { level: 2, correct: 0, wrong: 0, history: [] };
  });
  if (!activeTypes) activeTypes = {};

  // === MIGRATION beim Update auf v4 ===
  // Bei diesem Update aktivieren wir GARANTIERT alle Aufgabentypen und löschen
  // die Aufgaben-Caches, damit alle neuen Fragen (Hauptstädte, Automarken etc.)
  // sofort erscheinen. Das läuft nur einmal pro Gerät.
  const POOL_VERSION = 'v4-alle-typen-aktiv';
  let needsSave = false;
  if (!recentItems._poolVersion || recentItems._poolVersion !== POOL_VERSION) {
    // Alle Aufgabentypen einschalten — egal ob defaultActive true oder false
    TASK_TYPES.forEach(t => { activeTypes[t.id] = true; });
    // Alle Aufgaben-Caches leeren, damit erweiterte Pools wieder voll verfügbar sind
    Object.keys(recentItems).forEach(k => {
      if (k !== '_poolVersion') recentItems[k] = [];
    });
    recentItems._poolVersion = POOL_VERSION;
    needsSave = true;
  }
  // Sicherheitsnetz: jeder Typ aus TASK_TYPES muss in activeTypes existieren
  TASK_TYPES.forEach(t => {
    if (activeTypes[t.id] === undefined) {
      activeTypes[t.id] = true;
      needsSave = true;
    }
  });
  if (needsSave) saveState();
}
async function saveState() {
  try {
    const failedImages = Object.entries(imageStatus).filter(([,v]) => v === 'failed').map(([k]) => k);
    await window.storage.set(getStateKey(), JSON.stringify({
      skill, repeatQueue, sessionStats, people, aiPool, personStats, lastRecognizeAt, recentItems, activeTypes, dementiaStage, failedImages
    }));
  } catch(e) {}
}

// ===========================================================================
// AUFGABEN-POOLS (groß, für tausende Kombinationen)
// ===========================================================================

// Item-Pools für "Was passt nicht?" — nach Kategorien
const POOL_CATEGORIES = {
  obst: { label: 'Obst', items: [
    'Apfel','Birne','Kirsche','Banane','Erdbeere','Orange','Zitrone','Pflaume',
    'Weintraube','Ananas','Wassermelone','Pfirsich','Aprikose','Mango','Kiwi','Himbeere',
  ]},
  gemuese: { label: 'Gemüse', items: [
    'Karotte','Tomate','Gurke','Kartoffel','Zwiebel','Salat','Paprika','Brokkoli',
    'Spinat','Blumenkohl','Aubergine','Zucchini','Rettich','Sellerie',
  ]},
  tiere: { label: 'Tiere', items: [
    'Hund','Katze','Pferd','Kuh','Schaf','Schwein','Hase','Vogel',
    'Fisch','Maus','Esel','Ente','Huhn','Ziege','Eichhörnchen','Reh',
  ]},
  werkzeuge: { label: 'Werkzeuge', items: [
    'Hammer','Säge','Schraubenzieher','Zange','Bohrer','Schaufel',
    'Pinsel','Maßband','Schraubenschlüssel','Feile','Beil',
  ]},
  instrumente: { label: 'Musikinstrumente', items: [
    'Klavier','Geige','Trompete','Gitarre','Querflöte','Schlagzeug',
    'Violoncello','Akkordeon','Harfe','Saxophon','Klarinette','Mandoline',
  ]},
  blumen: { label: 'Blumen', items: [
    'Rose','Tulpe','Sonnenblume','Margerite','Nelke','Veilchen',
    'Lilie','Orchidee','Gänseblümchen','Hyazinthe','Narzisse','Geranie',
  ]},
  fahrzeuge: { label: 'Fahrzeuge', items: [
    'Auto','Fahrrad','Bus','Motorrad','Zug','Flugzeug',
    'Schiff','Traktor','Lastwagen','Hubschrauber','Straßenbahn',
  ]},
  moebel: { label: 'Möbel', items: [
    'Tisch','Stuhl','Sofa','Bett','Schrank','Regal','Sessel','Kommode','Hocker',
  ]},
  kueche: { label: 'Küche', items: [
    'Tasse','Teller','Gabel','Messer','Löffel','Topf','Bratpfanne','Trinkglas','Sieb','Schüssel',
  ]},
  kleidung: { label: 'Kleidung', items: [
    'Hose','Hemd','Mantel','Schuh','Hut','Schal','Pullover','Rock','Socke','Handschuh','Gürtel',
  ]},
  koerper: { label: 'Körperteile', items: [
    'Arm','Bein','Auge','Nase','Ohr','Mund','Hand','Fuß','Knie','Finger','Schulter',
  ]},
  natur: { label: 'Natur', items: [
    'Berg','Meer','Wald','See','Fluss','Insel','Wüste','Wiese','Felsen','Höhle',
  ]},
};

// "Was ist das?" — Pool von eindeutigen Begriffen für Bild-Aufgaben
const POOL_WHAT_IS_IT = [
  // Obst
  { word: 'Apfel',         keyword: 'Apfel',         distractKeys: ['Birne','Pflaume','Orange'] },
  { word: 'Banane',        keyword: 'Banane',        distractKeys: ['Apfel','Mango','Zitrone'] },
  { word: 'Erdbeere',      keyword: 'Erdbeere',      distractKeys: ['Himbeere','Kirsche','Tomate'] },
  { word: 'Orange',        keyword: 'Orange Frucht', distractKeys: ['Apfel','Pfirsich','Mandarine'] },
  { word: 'Zitrone',       keyword: 'Zitrone',       distractKeys: ['Orange','Limette','Apfel'] },
  { word: 'Wassermelone',  keyword: 'Wassermelone',  distractKeys: ['Kürbis','Apfel','Honigmelone'] },
  { word: 'Ananas',        keyword: 'Ananas',        distractKeys: ['Kokosnuss','Mango','Papaya'] },
  { word: 'Birne',         keyword: 'Birne (Frucht)',distractKeys: ['Apfel','Pflaume','Quitte'] },
  { word: 'Kirsche',       keyword: 'Kirschen',      distractKeys: ['Pflaume','Erdbeere','Heidelbeere'] },
  { word: 'Pflaume',       keyword: 'Pflaume',       distractKeys: ['Birne','Kirsche','Aprikose'] },
  { word: 'Weintraube',    keyword: 'Weintraube',    distractKeys: ['Heidelbeere','Pflaume','Kirsche'] },
  { word: 'Himbeere',      keyword: 'Himbeere',      distractKeys: ['Erdbeere','Brombeere','Heidelbeere'] },
  { word: 'Heidelbeere',   keyword: 'Heidelbeere',   distractKeys: ['Brombeere','Himbeere','Johannisbeere'] },
  { word: 'Mango',         keyword: 'Mango',         distractKeys: ['Papaya','Pfirsich','Aprikose'] },
  { word: 'Kiwi',          keyword: 'Kiwifrucht',    distractKeys: ['Limette','Stachelbeere','Mango'] },
  // Gemüse
  { word: 'Karotte',       keyword: 'Möhre',         distractKeys: ['Pastinake','Rettich','Sellerie'] },
  { word: 'Tomate',        keyword: 'Tomate',        distractKeys: ['Apfel','Paprika','Kirsche'] },
  { word: 'Kartoffel',     keyword: 'Kartoffel',     distractKeys: ['Zwiebel','Steckrübe','Süßkartoffel'] },
  { word: 'Gurke',         keyword: 'Gurke',         distractKeys: ['Zucchini','Aubergine','Paprika'] },
  { word: 'Zwiebel',       keyword: 'Zwiebel',       distractKeys: ['Knoblauch','Schalotte','Lauch'] },
  { word: 'Brokkoli',      keyword: 'Brokkoli',      distractKeys: ['Blumenkohl','Spinat','Kohlrabi'] },
  { word: 'Blumenkohl',    keyword: 'Blumenkohl',    distractKeys: ['Brokkoli','Romanesco','Weißkohl'] },
  { word: 'Paprika',       keyword: 'Paprika',       distractKeys: ['Tomate','Aubergine','Zucchini'] },
  { word: 'Aubergine',     keyword: 'Aubergine',     distractKeys: ['Zucchini','Gurke','Paprika'] },
  { word: 'Zucchini',      keyword: 'Zucchini',      distractKeys: ['Gurke','Aubergine','Kürbis'] },
  { word: 'Kürbis',        keyword: 'Kürbis',        distractKeys: ['Wassermelone','Honigmelone','Zucchini'] },
  { word: 'Knoblauch',     keyword: 'Knoblauch',     distractKeys: ['Zwiebel','Schalotte','Schnittlauch'] },
  { word: 'Spinat',        keyword: 'Echter Spinat', distractKeys: ['Salat','Mangold','Rucola'] },
  { word: 'Pilz',          keyword: 'Champignon',    distractKeys: ['Pfifferling','Steinpilz','Trüffel'] },
  // Tiere
  { word: 'Hund',          keyword: 'Haushund',      distractKeys: ['Katze','Wolf','Fuchs'] },
  { word: 'Katze',         keyword: 'Hauskatze',     distractKeys: ['Hund','Hase','Eichhörnchen'] },
  { word: 'Pferd',         keyword: 'Pferd',         distractKeys: ['Esel','Kuh','Pony'] },
  { word: 'Kuh',           keyword: 'Hausrind',      distractKeys: ['Pferd','Schaf','Ziege'] },
  { word: 'Schaf',         keyword: 'Hausschaf',     distractKeys: ['Ziege','Kuh','Lama'] },
  { word: 'Hase',          keyword: 'Kaninchen',     distractKeys: ['Eichhörnchen','Maus','Hamster'] },
  { word: 'Eichhörnchen',  keyword: 'Eurasisches Eichhörnchen', distractKeys: ['Maus','Hase','Marder'] },
  { word: 'Ente',          keyword: 'Hausente',      distractKeys: ['Gans','Schwan','Huhn'] },
  { word: 'Huhn',          keyword: 'Haushuhn',      distractKeys: ['Ente','Gans','Truthahn'] },
  { word: 'Schwein',       keyword: 'Hausschwein',   distractKeys: ['Wildschwein','Schaf','Kuh'] },
  { word: 'Ziege',         keyword: 'Hausziege',     distractKeys: ['Schaf','Kuh','Reh'] },
  { word: 'Esel',          keyword: 'Hausesel',      distractKeys: ['Pferd','Maultier','Pony'] },
  { word: 'Maus',          keyword: 'Hausmaus',      distractKeys: ['Ratte','Hamster','Eichhörnchen'] },
  { word: 'Reh',           keyword: 'Reh',           distractKeys: ['Hirsch','Gämse','Ziege'] },
  { word: 'Hirsch',        keyword: 'Rothirsch',     distractKeys: ['Reh','Elch','Rentier'] },
  { word: 'Fuchs',         keyword: 'Rotfuchs',      distractKeys: ['Wolf','Hund','Marder'] },
  { word: 'Bär',           keyword: 'Braunbär',      distractKeys: ['Eisbär','Wolf','Wildschwein'] },
  { word: 'Wolf',          keyword: 'Wolf',          distractKeys: ['Hund','Fuchs','Hyäne'] },
  { word: 'Elefant',       keyword: 'Elefanten',     distractKeys: ['Nashorn','Mammut','Nilpferd'] },
  { word: 'Löwe',          keyword: 'Löwe',          distractKeys: ['Tiger','Leopard','Gepard'] },
  { word: 'Tiger',         keyword: 'Tiger',         distractKeys: ['Löwe','Leopard','Jaguar'] },
  { word: 'Affe',          keyword: 'Schimpanse',    distractKeys: ['Gorilla','Orang-Utan','Pavian'] },
  { word: 'Schmetterling', keyword: 'Schmetterlinge',distractKeys: ['Motte','Libelle','Biene'] },
  { word: 'Biene',         keyword: 'Westliche Honigbiene', distractKeys: ['Wespe','Hummel','Fliege'] },
  // Fahrzeuge
  { word: 'Fahrrad',       keyword: 'Fahrrad',       distractKeys: ['Motorrad','Roller','Auto'] },
  { word: 'Motorrad',      keyword: 'Motorrad',      distractKeys: ['Fahrrad','Roller','Auto'] },
  { word: 'Bus',           keyword: 'Omnibus',       distractKeys: ['Lastwagen','Auto','Wohnmobil'] },
  { word: 'Zug',           keyword: 'Eisenbahn',     distractKeys: ['Straßenbahn','Bus','U-Bahn'] },
  { word: 'Flugzeug',      keyword: 'Verkehrsflugzeug', distractKeys: ['Hubschrauber','Rakete','Vogel'] },
  { word: 'Schiff',        keyword: 'Schiff',        distractKeys: ['Boot','Yacht','Fähre'] },
  { word: 'Traktor',       keyword: 'Traktor',       distractKeys: ['Lastwagen','Bagger','Auto'] },
  { word: 'Hubschrauber',  keyword: 'Hubschrauber',  distractKeys: ['Flugzeug','Drohne','Rakete'] },
  { word: 'Lastwagen',     keyword: 'Lastkraftwagen',distractKeys: ['Bus','Auto','Traktor'] },
  // Musik
  { word: 'Klavier',       keyword: 'Klavier',       distractKeys: ['Cembalo','Akkordeon','Orgel'] },
  { word: 'Geige',         keyword: 'Violine',       distractKeys: ['Cello','Bratsche','Mandoline'] },
  { word: 'Gitarre',       keyword: 'Gitarre',       distractKeys: ['Mandoline','Banjo','Ukulele'] },
  { word: 'Trompete',      keyword: 'Trompete',      distractKeys: ['Posaune','Horn','Tuba'] },
  { word: 'Schlagzeug',    keyword: 'Schlagzeug',    distractKeys: ['Pauke','Trommel','Becken'] },
  { word: 'Akkordeon',     keyword: 'Akkordeon',     distractKeys: ['Klavier','Harmonika','Bandoneon'] },
  { word: 'Saxophon',      keyword: 'Saxophon',      distractKeys: ['Klarinette','Trompete','Posaune'] },
  // Blumen
  { word: 'Rose',          keyword: 'Rose',          distractKeys: ['Pfingstrose','Nelke','Tulpe'] },
  { word: 'Tulpe',         keyword: 'Tulpe',         distractKeys: ['Narzisse','Hyazinthe','Krokus'] },
  { word: 'Sonnenblume',   keyword: 'Sonnenblume',   distractKeys: ['Margerite','Gerbera','Ringelblume'] },
  { word: 'Margerite',     keyword: 'Margerite',     distractKeys: ['Gänseblümchen','Sonnenblume','Aster'] },
  { word: 'Nelke',         keyword: 'Nelke',         distractKeys: ['Rose','Tulpe','Aster'] },
  { word: 'Lavendel',      keyword: 'Echter Lavendel', distractKeys: ['Salbei','Rosmarin','Thymian'] },
  // Alltag / Haushalt
  { word: 'Brille',        keyword: 'Brille',        distractKeys: ['Sonnenbrille','Lupe','Maske'] },
  { word: 'Uhr',           keyword: 'Armbanduhr',    distractKeys: ['Wanduhr','Wecker','Stoppuhr'] },
  { word: 'Buch',          keyword: 'Buch',          distractKeys: ['Heft','Zeitung','Notizblock'] },
  { word: 'Schlüssel',     keyword: 'Schlüssel',     distractKeys: ['Schloss','Anhänger','Werkzeug'] },
  { word: 'Schirm',        keyword: 'Regenschirm',   distractKeys: ['Sonnenschirm','Stock','Mantel'] },
  { word: 'Hut',           keyword: 'Hut',           distractKeys: ['Mütze','Helm','Kappe'] },
  { word: 'Stuhl',         keyword: 'Stuhl',         distractKeys: ['Hocker','Sessel','Bank'] },
  { word: 'Tisch',         keyword: 'Tisch',         distractKeys: ['Schreibtisch','Bank','Regal'] },
  { word: 'Lampe',         keyword: 'Lampe',         distractKeys: ['Kerze','Laterne','Taschenlampe'] },
  { word: 'Telefon',       keyword: 'Telefon',       distractKeys: ['Funkgerät','Radio','Wecker'] },
  { word: 'Bett',          keyword: 'Bett',          distractKeys: ['Sofa','Sessel','Liege'] },
  { word: 'Sofa',          keyword: 'Sofa',          distractKeys: ['Sessel','Bett','Bank'] },
  { word: 'Tasse',         keyword: 'Tasse',         distractKeys: ['Becher','Glas','Krug'] },
  { word: 'Teller',        keyword: 'Teller',        distractKeys: ['Schüssel','Schale','Tablett'] },
  { word: 'Gabel',         keyword: 'Gabel',         distractKeys: ['Löffel','Messer','Spieß'] },
  { word: 'Messer',        keyword: 'Küchenmesser',  distractKeys: ['Gabel','Schere','Klinge'] },
  { word: 'Löffel',        keyword: 'Löffel',        distractKeys: ['Gabel','Kelle','Schöpflöffel'] },
  { word: 'Topf',          keyword: 'Kochtopf',      distractKeys: ['Pfanne','Eimer','Kessel'] },
  { word: 'Pfanne',        keyword: 'Bratpfanne',    distractKeys: ['Topf','Wok','Auflaufform'] },
  // Werkzeuge
  { word: 'Hammer',        keyword: 'Hammer',        distractKeys: ['Beil','Vorschlaghammer','Klopfer'] },
  { word: 'Säge',          keyword: 'Säge',          distractKeys: ['Beil','Schere','Messer'] },
  { word: 'Schraubenzieher', keyword: 'Schraubendreher', distractKeys: ['Schraubenschlüssel','Stechbeitel','Hammer'] },
  { word: 'Zange',         keyword: 'Zange',         distractKeys: ['Schraubenschlüssel','Greifer','Klammer'] },
  { word: 'Bohrer',        keyword: 'Bohrmaschine',  distractKeys: ['Säge','Schleifer','Hammer'] },
  // Natur / Umgebung
  { word: 'Baum',          keyword: 'Baum',          distractKeys: ['Strauch','Busch','Pflanze'] },
  { word: 'Wald',          keyword: 'Wald',          distractKeys: ['Park','Garten','Wiese'] },
  { word: 'Berg',          keyword: 'Berg',          distractKeys: ['Hügel','Felsen','Vulkan'] },
  { word: 'Meer',          keyword: 'Meer',          distractKeys: ['See','Fluss','Teich'] },
  { word: 'Fluss',         keyword: 'Fluss',         distractKeys: ['Bach','See','Kanal'] },
  { word: 'Sonne',         keyword: 'Sonne',         distractKeys: ['Mond','Stern','Planet'] },
  { word: 'Mond',          keyword: 'Erdmond',       distractKeys: ['Sonne','Stern','Planet'] },
  { word: 'Wolke',         keyword: 'Wolke',         distractKeys: ['Nebel','Rauch','Dampf'] },
  { word: 'Schnee',        keyword: 'Schnee',        distractKeys: ['Eis','Hagel','Frost'] },
  { word: 'Regen',         keyword: 'Regen',         distractKeys: ['Schnee','Hagel','Nebel'] },
  // Kleidung
  { word: 'Hose',          keyword: 'Hose',          distractKeys: ['Rock','Shorts','Leggings'] },
  { word: 'Hemd',          keyword: 'Hemd',          distractKeys: ['T-Shirt','Bluse','Pullover'] },
  { word: 'Mantel',        keyword: 'Mantel',        distractKeys: ['Jacke','Anorak','Cape'] },
  { word: 'Schuh',         keyword: 'Schuh',         distractKeys: ['Stiefel','Sandale','Hausschuh'] },
  { word: 'Pullover',      keyword: 'Pullover',      distractKeys: ['Strickjacke','T-Shirt','Hemd'] },
];

// "Welches Essen?" — Pool deutscher/europäischer Gerichte
const POOL_WHAT_FOOD = [
  { word: 'Pizza',           keyword: 'Pizza',           distractKeys: ['Flammkuchen','Quiche','Pfannkuchen'] },
  { word: 'Spaghetti',       keyword: 'Spaghetti',       distractKeys: ['Makkaroni','Reis','Nudelsuppe'] },
  { word: 'Kartoffelbrei',   keyword: 'Kartoffelpüree',  distractKeys: ['Reis','Polenta','Grießbrei'] },
  { word: 'Brot',            keyword: 'Brot',            distractKeys: ['Brötchen','Brezel','Kuchen'] },
  { word: 'Brezel',          keyword: 'Brezel',          distractKeys: ['Brötchen','Croissant','Bagel'] },
  { word: 'Bratwurst',       keyword: 'Bratwurst',       distractKeys: ['Frikadelle','Würstchen','Leberkäse'] },
  { word: 'Schnitzel',       keyword: 'Wiener Schnitzel',distractKeys: ['Frikadelle','Steak','Kotelett'] },
  { word: 'Sauerkraut',      keyword: 'Sauerkraut',      distractKeys: ['Spinat','Salat','Spitzkohl'] },
  { word: 'Knödel',          keyword: 'Kloß',            distractKeys: ['Kartoffelbrei','Brötchen','Frikadelle'] },
  { word: 'Suppe',           keyword: 'Suppe',           distractKeys: ['Eintopf','Sauce','Pudding'] },
  { word: 'Salat',           keyword: 'Salat',           distractKeys: ['Spinat','Sauerkraut','Kohl'] },
  { word: 'Kuchen',          keyword: 'Kuchen',          distractKeys: ['Brot','Torte','Plätzchen'] },
  { word: 'Apfelstrudel',    keyword: 'Apfelstrudel',    distractKeys: ['Pfannkuchen','Kuchen','Krapfen'] },
  { word: 'Eis',             keyword: 'Speiseeis',       distractKeys: ['Pudding','Sahne','Joghurt'] },
  { word: 'Spiegelei',       keyword: 'Spiegelei',       distractKeys: ['Rührei','Omelette','Pfannkuchen'] },
  { word: 'Käse',            keyword: 'Käse',            distractKeys: ['Butter','Quark','Joghurt'] },
  { word: 'Pfannkuchen',     keyword: 'Pfannkuchen',     distractKeys: ['Crêpe','Waffel','Omelette'] },
  { word: 'Fischstäbchen',   keyword: 'Fischstäbchen',   distractKeys: ['Pommes','Hähnchen-Nuggets','Würstchen'] },
  { word: 'Pommes',          keyword: 'Pommes frites',   distractKeys: ['Kartoffelchips','Bratkartoffeln','Reis'] },
  { word: 'Reis',            keyword: 'Reis',            distractKeys: ['Nudeln','Couscous','Bulgur'] },
  { word: 'Müsli',           keyword: 'Müsli',           distractKeys: ['Cornflakes','Haferflocken','Brei'] },
  { word: 'Frikadelle',      keyword: 'Frikadelle',      distractKeys: ['Bouletten','Bratwurst','Hackbraten'] },
  { word: 'Currywurst',      keyword: 'Currywurst',      distractKeys: ['Bratwurst','Bockwurst','Wiener'] },
  { word: 'Leberkäse',       keyword: 'Leberkäse',       distractKeys: ['Schinken','Wurst','Hackbraten'] },
  { word: 'Sauerbraten',     keyword: 'Sauerbraten',     distractKeys: ['Rouladen','Gulasch','Schmorbraten'] },
  { word: 'Rouladen',        keyword: 'Roulade (Speise)', distractKeys: ['Sauerbraten','Schnitzel','Braten'] },
  { word: 'Gulasch',         keyword: 'Gulasch',         distractKeys: ['Eintopf','Ragout','Sauerbraten'] },
  { word: 'Linsensuppe',     keyword: 'Linsensuppe',     distractKeys: ['Erbsensuppe','Bohnensuppe','Gemüsesuppe'] },
  { word: 'Erbsensuppe',     keyword: 'Erbsensuppe',     distractKeys: ['Linsensuppe','Bohnensuppe','Kartoffelsuppe'] },
  { word: 'Kartoffelsuppe',  keyword: 'Kartoffelsuppe',  distractKeys: ['Linsensuppe','Tomatensuppe','Gemüsebrühe'] },
  { word: 'Eintopf',         keyword: 'Eintopf',         distractKeys: ['Suppe','Curry','Ragout'] },
  { word: 'Maultaschen',     keyword: 'Maultasche',      distractKeys: ['Ravioli','Tortellini','Gnocchi'] },
  { word: 'Spätzle',         keyword: 'Spätzle',         distractKeys: ['Nudeln','Knöpfle','Schupfnudeln'] },
  { word: 'Bratkartoffeln',  keyword: 'Bratkartoffeln',  distractKeys: ['Pommes','Salzkartoffeln','Rösti'] },
  { word: 'Rösti',           keyword: 'Rösti',           distractKeys: ['Reibekuchen','Bratkartoffeln','Pommes'] },
  { word: 'Reibekuchen',     keyword: 'Kartoffelpuffer', distractKeys: ['Pfannkuchen','Rösti','Bratkartoffel'] },
  { word: 'Hähnchen',        keyword: 'Brathähnchen',    distractKeys: ['Pute','Ente','Gans'] },
  { word: 'Lachs',           keyword: 'Atlantischer Lachs', distractKeys: ['Forelle','Thunfisch','Hering'] },
  { word: 'Forelle',         keyword: 'Forelle',         distractKeys: ['Lachs','Karpfen','Hering'] },
  { word: 'Hering',          keyword: 'Hering',          distractKeys: ['Sardine','Makrele','Forelle'] },
  { word: 'Schwarzwälder Kirschtorte', keyword: 'Schwarzwälder Kirschtorte', distractKeys: ['Sachertorte','Käsekuchen','Donauwelle'] },
  { word: 'Käsekuchen',      keyword: 'Käsekuchen',      distractKeys: ['Apfelkuchen','Sahnetorte','Marmorkuchen'] },
  { word: 'Apfelkuchen',     keyword: 'Apfelkuchen',     distractKeys: ['Apfelstrudel','Käsekuchen','Quarkkuchen'] },
  { word: 'Marmorkuchen',    keyword: 'Marmorkuchen',    distractKeys: ['Käsekuchen','Sandkuchen','Rührkuchen'] },
  { word: 'Donut',           keyword: 'Donut',           distractKeys: ['Bagel','Berliner','Krapfen'] },
  { word: 'Berliner',        keyword: 'Berliner Pfannkuchen', distractKeys: ['Krapfen','Donut','Brötchen'] },
  { word: 'Croissant',       keyword: 'Croissant',       distractKeys: ['Brezel','Brötchen','Hörnchen'] },
  { word: 'Brötchen',        keyword: 'Brötchen',        distractKeys: ['Bagel','Croissant','Brezel'] },
  { word: 'Toast',           keyword: 'Toastbrot',       distractKeys: ['Brot','Brötchen','Knäckebrot'] },
  { word: 'Joghurt',         keyword: 'Joghurt',         distractKeys: ['Quark','Pudding','Sahne'] },
  { word: 'Quark',           keyword: 'Quark (Milchprodukt)', distractKeys: ['Joghurt','Frischkäse','Sahne'] },
  { word: 'Schokolade',      keyword: 'Schokolade',      distractKeys: ['Praline','Gummibärchen','Kakao'] },
  { word: 'Honig',           keyword: 'Honig',           distractKeys: ['Marmelade','Sirup','Karamell'] },
  { word: 'Marmelade',       keyword: 'Konfitüre',       distractKeys: ['Honig','Gelee','Sirup'] },
  { word: 'Wurstbrot',       keyword: 'Stulle',          distractKeys: ['Käsebrot','Marmeladenbrot','Toast'] },
  { word: 'Hamburger',       keyword: 'Hamburger (Speise)', distractKeys: ['Cheeseburger','Sandwich','Hotdog'] },
  { word: 'Hotdog',          keyword: 'Hot Dog',         distractKeys: ['Bratwurst','Hamburger','Sandwich'] },
];

// "Wo ist das?" — Bekannte Wahrzeichen (50+ stück)
const POOL_WHERE_IS_THIS = [
  // Deutschland
  { word: 'Brandenburger Tor',  keyword: 'Brandenburger Tor',  distractKeys: ['Reichstagsgebäude','Siegessäule','Kölner Dom'] },
  { word: 'Kölner Dom',         keyword: 'Kölner Dom',         distractKeys: ['Frauenkirche München','Ulmer Münster','Bremer Dom'] },
  { word: 'Berliner Fernsehturm', keyword: 'Berliner Fernsehturm', distractKeys: ['Olympiaturm München','Stuttgarter Fernsehturm','Funkturm Berlin'] },
  { word: 'Reichstagsgebäude',  keyword: 'Reichstagsgebäude',  distractKeys: ['Schloss Bellevue','Bundeskanzleramt','Brandenburger Tor'] },
  { word: 'Hamburger Hafen',    keyword: 'Hamburger Hafen',    distractKeys: ['Bremerhaven','Kieler Hafen','Rotterdam'] },
  { word: 'Heidelberger Schloss', keyword: 'Heidelberger Schloss', distractKeys: ['Schloss Hohenzollern','Wartburg','Marksburg'] },
  { word: 'Frauenkirche München', keyword: 'Frauenkirche (München)', distractKeys: ['Kölner Dom','Stephansdom Wien','Bremer Dom'] },
  { word: 'Olympiastadion München', keyword: 'Olympiastadion München', distractKeys: ['Allianz Arena','Berliner Olympiastadion','Westfalenstadion'] },
  { word: 'Schloss Neuschwanstein', keyword: 'Schloss Neuschwanstein', distractKeys: ['Schloss Versailles','Schloss Hohenzollern','Wartburg'] },
  { word: 'Schloss Sanssouci',  keyword: 'Schloss Sanssouci',  distractKeys: ['Schloss Charlottenburg','Schloss Bellevue','Schloss Versailles'] },
  { word: 'Wartburg',           keyword: 'Wartburg',           distractKeys: ['Marksburg','Heidelberger Schloss','Burg Eltz'] },
  { word: 'Burg Eltz',          keyword: 'Burg Eltz',          distractKeys: ['Wartburg','Marksburg','Hohenzollern'] },
  { word: 'Loreley',            keyword: 'Loreley',            distractKeys: ['Drachenfels','Fränkische Schweiz','Mosel'] },
  { word: 'Zugspitze',          keyword: 'Zugspitze',          distractKeys: ['Brocken','Watzmann','Feldberg'] },
  { word: 'Holstentor Lübeck',  keyword: 'Holstentor',         distractKeys: ['Brandenburger Tor','Siegestor','Sendlinger Tor'] },
  { word: 'Marienplatz München',keyword: 'Marienplatz',        distractKeys: ['Alter Markt Salzburg','Stephansplatz Wien','Römer Frankfurt'] },
  { word: 'Bremer Stadtmusikanten', keyword: 'Bremer Stadtmusikanten', distractKeys: ['Roland (Bremen)','Manneken Pis','Märchenfigur'] },
  // Frankreich
  { word: 'Eiffelturm',         keyword: 'Eiffelturm',         distractKeys: ['Tour Montparnasse','Berliner Fernsehturm','Empire State Building'] },
  { word: 'Triumphbogen',       keyword: 'Arc de Triomphe',    distractKeys: ['Brandenburger Tor','Tor von Konstantin','Wellington-Bogen'] },
  { word: 'Notre-Dame',         keyword: 'Notre-Dame de Paris',distractKeys: ['Sacré-Cœur','Kölner Dom','Mailänder Dom'] },
  { word: 'Sacré-Cœur',         keyword: 'Sacré-Cœur de Montmartre', distractKeys: ['Notre-Dame de Paris','Kölner Dom','Petersdom'] },
  { word: 'Schloss Versailles', keyword: 'Schloss Versailles', distractKeys: ['Schloss Sanssouci','Schloss Schönbrunn','Schloss Neuschwanstein'] },
  // Italien
  { word: 'Kolosseum',          keyword: 'Kolosseum',          distractKeys: ['Pantheon (Rom)','Akropolis','Petersdom'] },
  { word: 'Schiefer Turm von Pisa', keyword: 'Schiefer Turm von Pisa', distractKeys: ['Big Ben','Eiffelturm','Olympiaturm'] },
  { word: 'Petersdom',          keyword: 'Petersdom',          distractKeys: ['Kölner Dom','Mailänder Dom','Hagia Sophia'] },
  { word: 'Markusplatz Venedig',keyword: 'Markusplatz',        distractKeys: ['Piazza Navona','Spanische Treppe','Trevi-Brunnen'] },
  { word: 'Trevi-Brunnen',      keyword: 'Trevi-Brunnen',      distractKeys: ['Spanische Treppe','Markusplatz','Brunnen Wittelsbacher'] },
  { word: 'Pantheon Rom',       keyword: 'Pantheon (Rom)',     distractKeys: ['Kolosseum','Petersdom','Akropolis'] },
  // UK
  { word: 'Big Ben',            keyword: 'Elizabeth Tower',    distractKeys: ['Eiffelturm','Berliner Fernsehturm','Glockenturm Pisa'] },
  { word: 'Tower Bridge',       keyword: 'Tower Bridge',       distractKeys: ['London Bridge','Golden Gate','Brooklyn Bridge'] },
  { word: 'Buckingham Palace',  keyword: 'Buckingham Palace',  distractKeys: ['Schloss Versailles','Schloss Schönbrunn','Schloss Bellevue'] },
  { word: 'Stonehenge',         keyword: 'Stonehenge',         distractKeys: ['Externsteine','Avebury','Carnac'] },
  // USA
  { word: 'Freiheitsstatue',    keyword: 'Freiheitsstatue',    distractKeys: ['Christusstatue','Bavaria-Statue','Brandenburger Tor'] },
  { word: 'Empire State Building', keyword: 'Empire State Building', distractKeys: ['Chrysler Building','Eiffelturm','Berliner Fernsehturm'] },
  { word: 'Golden Gate Bridge', keyword: 'Golden Gate Bridge', distractKeys: ['Brooklyn Bridge','Tower Bridge','Bay Bridge'] },
  { word: 'Mount Rushmore',     keyword: 'Mount Rushmore',     distractKeys: ['Stonehenge','Crazy Horse Memorial','Zugspitze'] },
  // Sonstige Welt
  { word: 'Akropolis',          keyword: 'Akropolis (Athen)',  distractKeys: ['Kolosseum','Pantheon','Forum Romanum'] },
  { word: 'Pyramiden von Gizeh',keyword: 'Pyramiden von Gizeh',distractKeys: ['Sphinx von Gizeh','Pyramide','Tempel von Karnak'] },
  { word: 'Sphinx von Gizeh',   keyword: 'Sphinx von Gizeh',   distractKeys: ['Pyramiden von Gizeh','Tempel von Luxor','Akropolis'] },
  { word: 'Chinesische Mauer',  keyword: 'Chinesische Mauer',  distractKeys: ['Hadrianswall','Limes','Verbotene Stadt'] },
  { word: 'Taj Mahal',          keyword: 'Taj Mahal',          distractKeys: ['Hagia Sophia','Petersdom','Süleymaniye'] },
  { word: 'Hagia Sophia',       keyword: 'Hagia Sophia',       distractKeys: ['Blaue Moschee','Petersdom','Kölner Dom'] },
  { word: 'Christusstatue Rio', keyword: 'Cristo Redentor',    distractKeys: ['Freiheitsstatue','Bavaria-Statue','Sphinx'] },
  { word: 'Sydney Opera House', keyword: 'Sydney Opera House', distractKeys: ['Hamburger Elbphilharmonie','Wiener Staatsoper','Mailänder Scala'] },
  { word: 'Machu Picchu',       keyword: 'Machu Picchu',       distractKeys: ['Tikal','Stonehenge','Petra (Stadt)'] },
  // Österreich/Schweiz
  { word: 'Schloss Schönbrunn', keyword: 'Schloss Schönbrunn', distractKeys: ['Schloss Versailles','Schloss Sanssouci','Schloss Charlottenburg'] },
  { word: 'Stephansdom Wien',   keyword: 'Stephansdom (Wien)', distractKeys: ['Kölner Dom','Frauenkirche München','Bremer Dom'] },
  { word: 'Matterhorn',         keyword: 'Matterhorn',         distractKeys: ['Mont Blanc','Eiger','Zugspitze'] },
];

// "Sprichwörter" — großer Pool
const POOL_PROVERBS = [
  { prompt: 'Morgenstund hat … im Mund.', correct: 'Gold', distract: ['Silber','Tee','Brot'], hint: 'Ein Edelmetall, gelb wie die Sonne.' },
  { prompt: 'Wer A sagt, muss auch … sagen.', correct: 'B', distract: ['C','Ja','Nein'], hint: 'Der nächste Buchstabe im Alphabet.' },
  { prompt: 'Lügen haben kurze …', correct: 'Beine', distract: ['Arme','Haare','Hände'], hint: 'Damit läuft man.' },
  { prompt: 'Reden ist Silber, … ist Gold.', correct: 'Schweigen', distract: ['Singen','Hören','Lachen'], hint: 'Wenn man nichts sagt.' },
  { prompt: 'Wer im Glashaus sitzt, soll nicht mit … werfen.', correct: 'Steinen', distract: ['Worten','Bällen','Blumen'], hint: 'Hart und schwer.' },
  { prompt: 'Aller guten Dinge sind …', correct: 'drei', distract: ['zwei','vier','fünf'], hint: 'Eine kleine Zahl.' },
  { prompt: 'Übung macht den …', correct: 'Meister', distract: ['Schüler','Lehrer','Helden'], hint: 'Jemand der etwas richtig gut kann.' },
  { prompt: 'Ende gut, alles …', correct: 'gut', distract: ['fertig','vorbei','schön'], hint: 'Das gleiche Wort wie zu Beginn des Spruchs.' },
  { prompt: 'Der Apfel fällt nicht weit vom …', correct: 'Stamm', distract: ['Baum','Weg','Haus'], hint: 'Der dicke Teil eines Baumes.' },
  { prompt: 'Wer zuletzt lacht, lacht am …', correct: 'besten', distract: ['lautesten','längsten','schönsten'], hint: 'Steigerung von „gut".' },
  { prompt: 'Kleinvieh macht auch …', correct: 'Mist', distract: ['Krach','Spaß','Geld'], hint: 'Das, was man im Stall ausmistet.' },
  { prompt: 'Lieber den Spatz in der Hand als die … auf dem Dach.', correct: 'Taube', distract: ['Krähe','Möwe','Eule'], hint: 'Ein graues Friedensvogel-Symbol.' },
  { prompt: 'Hunde, die bellen, … nicht.', correct: 'beißen', distract: ['fressen','laufen','springen'], hint: 'Was ein Hund mit den Zähnen tut.' },
  { prompt: 'Was du heute kannst besorgen, das verschiebe nicht auf …', correct: 'morgen', distract: ['später','Sonntag','übermorgen'], hint: 'Der Tag nach heute.' },
  { prompt: 'Ohne Fleiß kein …', correct: 'Preis', distract: ['Lob','Glück','Sieg'], hint: 'Reimt sich auf „Fleiß".' },
  { prompt: 'Eine Hand wäscht die …', correct: 'andere', distract: ['Wand','Sache','dritte'], hint: 'Das Gegenstück zur ersten.' },
  { prompt: 'Wo gehobelt wird, fallen …', correct: 'Späne', distract: ['Bretter','Steine','Tropfen'], hint: 'Kleine Holzstückchen.' },
  { prompt: 'Viele Köche verderben den …', correct: 'Brei', distract: ['Suppe','Topf','Geschmack'], hint: 'Ein zähflüssiges Essen aus Getreide.' },
  { prompt: 'Probieren geht über …', correct: 'studieren', distract: ['warten','reden','lesen'], hint: 'Was man an der Universität tut.' },
  { prompt: 'Eile mit …', correct: 'Weile', distract: ['Würde','Sorge','Eile'], hint: 'Eine kleine Pause.' },
  { prompt: 'In der Kürze liegt die …', correct: 'Würze', distract: ['Wahrheit','Stärke','Macht'], hint: 'Reimt sich auf „Kürze".' },
  { prompt: 'Wer rastet, der …', correct: 'rostet', distract: ['lastet','tastet','passt'], hint: 'Was passiert mit altem Eisen.' },
  { prompt: 'Steter Tropfen höhlt den …', correct: 'Stein', distract: ['Berg','Sand','Holz'], hint: 'Sehr hartes Material.' },
  { prompt: 'Aller Anfang ist …', correct: 'schwer', distract: ['leicht','schön','klein'], hint: 'Das Gegenteil von leicht.' },
  { prompt: 'Wer anderen eine Grube gräbt, fällt selbst …', correct: 'hinein', distract: ['hinaus','heraus','weg'], hint: 'Hinunter in das Loch.' },
  { prompt: 'Der frühe Vogel fängt den …', correct: 'Wurm', distract: ['Fisch','Käfer','Tag'], hint: 'Lebt im Erdboden.' },
  { prompt: 'Kleider machen …', correct: 'Leute', distract: ['Männer','Frauen','Kinder'], hint: 'Allgemeiner Begriff für Menschen.' },
  { prompt: 'Ein Unglück kommt selten …', correct: 'allein', distract: ['nachts','heute','spät'], hint: 'Ohne Begleitung.' },
  { prompt: 'Hunger ist der beste …', correct: 'Koch', distract: ['Freund','Lehrer','Helfer'], hint: 'Bereitet das Essen zu.' },
  { prompt: 'Wer den Schaden hat, braucht für den Spott nicht zu …', correct: 'sorgen', distract: ['lachen','weinen','denken'], hint: 'Sich kümmern um etwas.' },
  { prompt: 'Der Krug geht so lange zum Brunnen, bis er …', correct: 'bricht', distract: ['voll ist','platzt','rostet'], hint: 'Was Glas und Keramik tun.' },
  { prompt: 'Es ist noch kein Meister vom Himmel …', correct: 'gefallen', distract: ['gestiegen','geflogen','gekommen'], hint: 'Etwas das nach unten fällt.' },
  { prompt: 'Wer im Sommer säet, wird im Winter …', correct: 'ernten', distract: ['frieren','schlafen','warten'], hint: 'Die Früchte einsammeln.' },
  { prompt: 'Wie man in den Wald hineinruft, so schallt es …', correct: 'heraus', distract: ['hinein','hinab','herein'], hint: 'Das Gegenteil von „hinein".' },
  { prompt: 'Hochmut kommt vor dem …', correct: 'Fall', distract: ['Sieg','Lohn','Glück'], hint: 'Wenn man hinunterfällt.' },
  { prompt: 'Stille Wasser sind …', correct: 'tief', distract: ['kalt','klar','blau'], hint: 'Das Gegenteil von flach.' },
  { prompt: 'Geteiltes Leid ist halbes …', correct: 'Leid', distract: ['Glück','Lachen','Lasten'], hint: 'Das gleiche Wort vom Anfang.' },
  { prompt: 'Geteilte Freude ist doppelte …', correct: 'Freude', distract: ['Liebe','Lachen','Leid'], hint: 'Das gleiche Wort vom Anfang.' },
  { prompt: 'Es ist nicht alles Gold, was …', correct: 'glänzt', distract: ['leuchtet','funkelt','strahlt'], hint: 'Wenn etwas im Licht spiegelt.' },
  { prompt: 'Wer zu spät kommt, den bestraft das …', correct: 'Leben', distract: ['Schicksal','Glück','Wetter'], hint: 'Das was wir alle haben.' },
  { prompt: 'Zeit ist …', correct: 'Geld', distract: ['Macht','Liebe','Glück'], hint: 'Womit man Dinge kauft.' },
  { prompt: 'Ein gutes Gewissen ist ein sanftes …', correct: 'Ruhekissen', distract: ['Bett','Tuch','Sofa'], hint: 'Worauf man den Kopf legt.' },
  { prompt: 'Nichts ist umsonst, alles hat seinen …', correct: 'Preis', distract: ['Wert','Lohn','Sinn'], hint: 'Was etwas kostet.' },
  { prompt: 'Was lange währt, wird endlich …', correct: 'gut', distract: ['fertig','vorbei','besser'], hint: 'Das Gegenteil von schlecht.' },
  { prompt: 'Wer lacht, der …', correct: 'lebt', distract: ['weint','schweigt','schläft'], hint: 'Reimt sich auf „lacht" nicht, aber bedeutet vital sein.' },
  { prompt: 'Wer einmal lügt, dem glaubt man …', correct: 'nicht', distract: ['immer','manchmal','heute'], hint: 'Verneinung.' },
  { prompt: 'Vier Augen sehen mehr als …', correct: 'zwei', distract: ['drei','sechs','keine'], hint: 'Zahl, kleiner als vier.' },
  { prompt: 'Wer den Pfennig nicht ehrt, ist des Talers nicht …', correct: 'wert', distract: ['froh','sicher','klug'], hint: 'Reimt sich auf „ehrt".' },
  { prompt: 'Müßiggang ist aller Laster …', correct: 'Anfang', distract: ['Ende','Mitte','Wurzel'], hint: 'Wo etwas beginnt.' },
  { prompt: 'Wer sich in Gefahr begibt, kommt darin …', correct: 'um', distract: ['davon','heraus','frei'], hint: 'Zwei Buchstaben, bedeutet sterben.' },
  { prompt: 'Lieber den Spatz in der Hand als die Taube auf dem …', correct: 'Dach', distract: ['Boden','Baum','Ast'], hint: 'Wo der Schornstein ist.' },
  { prompt: 'Mit Speck fängt man …', correct: 'Mäuse', distract: ['Vögel','Hasen','Katzen'], hint: 'Kleine Nager.' },
  { prompt: 'Liebe geht durch den …', correct: 'Magen', distract: ['Kopf','Mund','Hals'], hint: 'Wo das Essen verdaut wird.' },
  { prompt: 'Aus den Augen, aus dem …', correct: 'Sinn', distract: ['Herz','Kopf','Blick'], hint: 'Wo Gedanken entstehen.' },
  { prompt: 'Wer wagt, …', correct: 'gewinnt', distract: ['verliert','wartet','denkt'], hint: 'Den Sieg holen.' },
  { prompt: 'Trau, schau, …', correct: 'wem', distract: ['was','wo','wer'], hint: 'Frage nach einer Person im Dativ.' },
  { prompt: 'Alle guten Dinge sind …', correct: 'drei', distract: ['zwei','vier','fünf'], hint: 'Mehr als zwei, weniger als vier.' },
  { prompt: 'Klein, aber …', correct: 'fein', distract: ['groß','laut','schnell'], hint: 'Reimt sich auf „klein".' },
  { prompt: 'Reden ist Silber, Schweigen ist …', correct: 'Gold', distract: ['Bronze','Eisen','Kupfer'], hint: 'Wertvolles gelbes Metall.' },
  { prompt: 'Andere Länder, andere …', correct: 'Sitten', distract: ['Sprachen','Menschen','Häuser'], hint: 'Bräuche und Gewohnheiten.' },
  { prompt: 'Geld stinkt …', correct: 'nicht', distract: ['immer','sehr','manchmal'], hint: 'Verneinung.' },
  { prompt: 'Geteiltes Leid ist halbes …', correct: 'Leid', distract: ['Glück','Lachen','Schmerz'], hint: 'Das gleiche Wort vom Anfang.' },
  { prompt: 'Geteilte Freude ist doppelte …', correct: 'Freude', distract: ['Liebe','Lachen','Trauer'], hint: 'Das gleiche Wort vom Anfang.' },
  { prompt: 'Pünktlichkeit ist die Höflichkeit der …', correct: 'Könige', distract: ['Bauern','Diener','Herren'], hint: 'Adelige Herrscher.' },
  { prompt: 'Spare in der Zeit, dann hast du in der …', correct: 'Not', distract: ['Freude','Ruhe','Zeit'], hint: 'Schwere Lage.' },
  { prompt: 'Wer nicht hören will, muss …', correct: 'fühlen', distract: ['sehen','schmecken','riechen'], hint: 'Mit der Haut wahrnehmen.' },
  { prompt: 'Die Hoffnung stirbt …', correct: 'zuletzt', distract: ['früh','schnell','langsam'], hint: 'Das Gegenteil von zuerst.' },
  { prompt: 'Aus einer Mücke einen … machen.', correct: 'Elefanten', distract: ['Berg','Wal','Bären'], hint: 'Größtes Landtier.' },
  { prompt: 'Da liegt der Hund …', correct: 'begraben', distract: ['versteckt','vergraben','geschlafen'], hint: 'Unter der Erde verborgen.' },
  { prompt: 'Den Nagel auf den … treffen.', correct: 'Kopf', distract: ['Punkt','Boden','Tisch'], hint: 'Oberster Körperteil.' },
  { prompt: 'Lachen ist die beste …', correct: 'Medizin', distract: ['Therapie','Heilung','Salbe'], hint: 'Heilmittel.' },
  { prompt: 'Da haben wir den …', correct: 'Salat', distract: ['Eintopf','Brei','Brot'], hint: 'Etwas Grünes zum Anrichten.' },
  { prompt: 'Es führen viele Wege nach …', correct: 'Rom', distract: ['Paris','Berlin','Wien'], hint: 'Italienische Hauptstadt.' },
  { prompt: 'Die Zeit heilt alle …', correct: 'Wunden', distract: ['Sorgen','Probleme','Krankheiten'], hint: 'Verletzungen.' },
  { prompt: 'Klappern gehört zum …', correct: 'Handwerk', distract: ['Beruf','Singen','Schreiben'], hint: 'Tätigkeit mit den Händen.' },
  { prompt: 'Erst die Arbeit, dann das …', correct: 'Vergnügen', distract: ['Essen','Spielen','Schlafen'], hint: 'Spaß.' },
  { prompt: 'Wenn die Katze aus dem Haus ist, tanzen die …', correct: 'Mäuse', distract: ['Ratten','Hunde','Vögel'], hint: 'Kleine Nager mit langem Schwanz.' },
  { prompt: 'Eine Krähe hackt der anderen kein … aus.', correct: 'Auge', distract: ['Ohr','Bein','Herz'], hint: 'Damit sieht man.' },
  { prompt: 'Ein gebranntes Kind scheut das …', correct: 'Feuer', distract: ['Wasser','Licht','Gas'], hint: 'Was brennt und wärmt.' },
  { prompt: 'Lügen haben kurze …', correct: 'Beine', distract: ['Arme','Wege','Wurzeln'], hint: 'Damit läuft man.' },
  { prompt: 'Hunger ist der beste …', correct: 'Koch', distract: ['Freund','Lehrer','Helfer'], hint: 'Bereitet das Essen zu.' },
  { prompt: 'Der frühe Vogel fängt den …', correct: 'Wurm', distract: ['Käfer','Fisch','Tag'], hint: 'Lebt im Erdboden.' },
  { prompt: 'Wer den Schaden hat, braucht für den Spott nicht zu …', correct: 'sorgen', distract: ['lachen','weinen','denken'], hint: 'Sich kümmern.' },
  { prompt: 'Der Krug geht so lange zum Brunnen, bis er …', correct: 'bricht', distract: ['voll ist','platzt','rostet'], hint: 'Was Glas tut wenn es fällt.' },
  { prompt: 'Es ist noch kein Meister vom Himmel …', correct: 'gefallen', distract: ['gestiegen','geflogen','gekommen'], hint: 'Was nach unten passiert.' },
  { prompt: 'Wer im Sommer säet, wird im Winter …', correct: 'ernten', distract: ['frieren','schlafen','warten'], hint: 'Die Früchte einsammeln.' },
  { prompt: 'Wie man in den Wald hineinruft, so schallt es …', correct: 'heraus', distract: ['hinein','hinab','herein'], hint: 'Das Gegenteil von „hinein".' },
  { prompt: 'Hochmut kommt vor dem …', correct: 'Fall', distract: ['Sieg','Lohn','Glück'], hint: 'Wenn man hinunterfällt.' },
  { prompt: 'Es ist nicht alles Gold, was …', correct: 'glänzt', distract: ['leuchtet','funkelt','strahlt'], hint: 'Wenn etwas im Licht spiegelt.' },
  { prompt: 'Wer zu spät kommt, den bestraft das …', correct: 'Leben', distract: ['Schicksal','Glück','Wetter'], hint: 'Das was wir alle haben.' },
  { prompt: 'Zeit ist …', correct: 'Geld', distract: ['Macht','Liebe','Glück'], hint: 'Womit man Dinge kauft.' },
  { prompt: 'Ein gutes Gewissen ist ein sanftes …', correct: 'Ruhekissen', distract: ['Bett','Tuch','Sofa'], hint: 'Worauf man den Kopf legt.' },
  { prompt: 'Probieren geht über …', correct: 'studieren', distract: ['warten','reden','lesen'], hint: 'Was man an der Universität tut.' },
  { prompt: 'Eile mit …', correct: 'Weile', distract: ['Würde','Sorge','Eile'], hint: 'Eine kleine Pause.' },
  { prompt: 'In der Kürze liegt die …', correct: 'Würze', distract: ['Wahrheit','Stärke','Macht'], hint: 'Reimt sich auf „Kürze".' },
  { prompt: 'Wer rastet, der …', correct: 'rostet', distract: ['lastet','tastet','passt'], hint: 'Was passiert mit altem Eisen.' },
  { prompt: 'Steter Tropfen höhlt den …', correct: 'Stein', distract: ['Berg','Sand','Holz'], hint: 'Sehr hartes Material.' },
  { prompt: 'Aller Anfang ist …', correct: 'schwer', distract: ['leicht','schön','klein'], hint: 'Das Gegenteil von leicht.' },
];

// "Gegenteile" — großer Pool
const POOL_OPPOSITES = [
  ['groß', 'klein', ['breit','schmal','rund'], 'Was ein Kind ist und ein Erwachsener nicht mehr.'],
  ['heiß', 'kalt', ['warm','lauwarm','feucht'], 'So fühlt sich Eis an.'],
  ['schnell', 'langsam', ['eilig','still','ruhig'], 'So bewegt sich eine Schnecke.'],
  ['hell', 'dunkel', ['grau','bunt','klar'], 'So ist es nachts.'],
  ['Tag', 'Nacht', ['Abend','Morgen','Mittag'], 'Wenn der Mond am Himmel steht.'],
  ['Anfang', 'Ende', ['Mitte','Pause','Stopp'], 'Wenn etwas vorbei ist.'],
  ['traurig', 'fröhlich', ['müde','wütend','still'], 'Dann lacht man.'],
  ['arm', 'reich', ['mittellos','satt','genug'], 'Wer viel Geld hat.'],
  ['leicht', 'schwer', ['weich','hart','dünn'], 'So ist ein voller Koffer.'],
  ['offen', 'geschlossen', ['halb','frei','dicht'], 'So ist eine Tür, die zu ist.'],
  ['jung', 'alt', ['neu','reif','klein'], 'Was ein Großvater ist.'],
  ['nass', 'trocken', ['feucht','matt','rau'], 'So ist die Wäsche, wenn sie aus der Maschine kommt — bzw. das Gegenteil davon.'],
  ['hart', 'weich', ['dick','glatt','spitz'], 'So ist ein Kissen.'],
  ['voll', 'leer', ['dick','satt','knapp'], 'So ist eine Flasche, aus der nichts mehr herauskommt.'],
  ['schön', 'hässlich', ['nett','grau','still'], 'Wenn etwas nicht gut aussieht.'],
  ['richtig', 'falsch', ['gut','wahr','recht'], 'Wenn man sich vertan hat.'],
  ['oben', 'unten', ['vorne','seitlich','außen'], 'Da, wo der Boden ist.'],
  ['vorne', 'hinten', ['rechts','seitlich','oben'], 'Wo der Rücken hinzeigt.'],
  ['laut', 'leise', ['still','sanft','dunkel'], 'So spricht man in der Bibliothek.'],
  ['früh', 'spät', ['pünktlich','rechtzeitig','knapp'], 'Wenn der Zug schon weg ist.'],
  ['sauber', 'schmutzig', ['fleckig','staubig','matt'], 'Was Hände nach Gartenarbeit sind.'],
  ['stark', 'schwach', ['dünn','klein','müde'], 'Wenn man kaum etwas heben kann.'],
  ['breit', 'schmal', ['eng','dünn','klein'], 'Eng wie eine Gasse.'],
  ['hoch', 'niedrig', ['klein','flach','tief'], 'Ein Hocker zum Beispiel.'],
  ['offen', 'geschlossen', ['zu','dicht','fest'], 'Wenn die Tür nicht aufgeht.'],
  ['weich', 'hart', ['steif','grob','spitz'], 'Wie ein Stein.'],
  ['süß', 'sauer', ['salzig','bitter','scharf'], 'Wie eine Zitrone schmeckt.'],
  ['glücklich', 'traurig', ['müde','still','schwach'], 'Wenn man weint.'],
  ['mutig', 'feige', ['ängstlich','schwach','still'], 'Wer sich nichts traut.'],
  ['fleißig', 'faul', ['müde','langsam','schwach'], 'Wer den ganzen Tag nichts tut.'],
  ['ehrlich', 'verlogen', ['falsch','gemein','still'], 'Wer immer schwindelt.'],
  ['fröhlich', 'mürrisch', ['wütend','leise','müde'], 'Schlecht gelaunt und brummig.'],
  ['eng', 'weit', ['breit','offen','locker'], 'Eine große Hose passt so.'],
  ['scharf', 'stumpf', ['glatt','dick','weich'], 'Ein altes Messer ist so.'],
  ['hell', 'dunkel', ['schwarz','grau','trüb'], 'In der Nacht ohne Licht.'],
  ['gerade', 'krumm', ['schief','rund','geknickt'], 'Wie ein Korkenzieher.'],
  ['neu', 'gebraucht', ['alt','kaputt','vergangen'], 'Was schon jemand benutzt hat.'],
  ['lang', 'kurz', ['knapp','dünn','klein'], 'Ein Mini-Rock zum Beispiel.'],
  ['schnell', 'langsam', ['gemütlich','leise','sanft'], 'Wie eine Schnecke.'],
  ['früh aufstehen', 'lange schlafen', ['ausruhen','dösen','schlummern'], 'Bis spät im Bett bleiben.'],
  ['Hitze', 'Kälte', ['Wärme','Glut','Sonne'], 'Wenn man zittert.'],
  ['Sieg', 'Niederlage', ['Erfolg','Glück','Gewinn'], 'Verloren haben.'],
  ['hart', 'sanft', ['rau','kalt','grob'], 'Zärtlich und vorsichtig.'],
  ['steigen', 'fallen', ['heben','springen','klettern'], 'Nach unten sinken.'],
  ['Hektik', 'Ruhe', ['Eile','Stress','Lärm'], 'Wenn nichts Anstrengendes los ist.'],
  ['Liebe', 'Hass', ['Freude','Lust','Sorge'], 'Sehr starke Abneigung.'],
  ['Tag', 'Nacht', ['Morgen','Mittag','Abend'], 'Wenn der Mond am Himmel steht.'],
  ['Sommer', 'Winter', ['Herbst','Frühling','August'], 'Kalte Jahreszeit mit Schnee.'],
  ['vorne', 'hinten', ['oben','seitlich','rechts'], 'Das Gegenteil von vorne.'],
  ['oben', 'unten', ['links','rechts','schräg'], 'Wo der Boden ist.'],
  ['rechts', 'links', ['oben','unten','vorne'], 'Wo das Herz schlägt.'],
  ['ja', 'nein', ['vielleicht','egal','jederzeit'], 'Verneinende Antwort.'],
  ['kommen', 'gehen', ['stehen','warten','sehen'], 'Sich entfernen.'],
  ['einschalten', 'ausschalten', ['anmachen','starten','aktivieren'], 'Strom wegnehmen.'],
  ['Anfang', 'Ende', ['Mitte','Start','Beginn'], 'Wo etwas aufhört.'],
  ['Tag', 'Mitternacht', ['Vormittag','Mittag','Nachmittag'], 'Wenn der Wecker auf 0 Uhr steht.'],
  ['leben', 'sterben', ['atmen','wachen','wachsen'], 'Das Ende des Lebens.'],
  ['Frau', 'Mann', ['Kind','Junge','Mädchen'], 'Erwachsene männliche Person.'],
  ['Eltern', 'Kinder', ['Großeltern','Onkel','Tante'], 'Söhne und Töchter.'],
  ['glauben', 'zweifeln', ['hoffen','wissen','denken'], 'Nicht sicher sein.'],
  ['gewinnen', 'verlieren', ['spielen','versuchen','denken'], 'Eine Niederlage haben.'],
  ['lachen', 'weinen', ['kichern','grinsen','schmunzeln'], 'Tränen weinen.'],
  ['nass', 'trocken', ['feucht','klebrig','klamm'], 'Ohne Wasser.'],
  ['voll', 'leer', ['halb','dick','satt'], 'Wenn nichts mehr drin ist.'],
  ['stehen', 'liegen', ['sitzen','knien','springen'], 'Auf dem Rücken oder Bauch sein.'],
  ['drinnen', 'draußen', ['oben','unten','seitlich'], 'Im Freien.'],
  ['kaufen', 'verkaufen', ['tauschen','suchen','schenken'], 'Etwas für Geld weggeben.'],
  ['groß', 'winzig', ['klein','niedrig','schmal'], 'Sehr sehr klein.'],
  ['anfangen', 'aufhören', ['beginnen','starten','antreten'], 'Etwas beenden.'],
  ['suchen', 'finden', ['rufen','schauen','rennen'], 'Etwas Verlorenes wieder haben.'],
  ['fragen', 'antworten', ['rufen','schweigen','schreien'], 'Auf eine Frage reagieren.'],
  ['richtig', 'falsch', ['klar','sicher','ganz'], 'Nicht korrekt.'],
  ['möglich', 'unmöglich', ['einfach','denkbar','machbar'], 'Geht nicht.'],
  ['frisch', 'verdorben', ['neu','jung','klar'], 'Nicht mehr essbar.'],
  ['gesund', 'krank', ['stark','jung','frisch'], 'Wenn man im Bett bleiben muss.'],
  ['arm', 'reich', ['mittel','sparsam','knapp'], 'Wer sehr viel Geld hat.'],
  ['glatt', 'rau', ['eben','plan','schief'], 'Eine Baumrinde fühlt sich so an.'],
  ['leicht', 'schwer', ['flach','klein','dünn'], 'Wenn man kaum heben kann.'],
  ['weit', 'eng', ['klein','flach','kurz'], 'Eine Hose, die zwickt.'],
  ['oben', 'tief unten', ['unter','mittig','seitlich'], 'Ganz weit nach unten.'],
  ['Frieden', 'Krieg', ['Streit','Lärm','Sorge'], 'Bewaffneter Konflikt.'],
  ['Tag', 'Nacht', ['Morgen','Mittag','Abend'], 'Wenn der Mond am Himmel steht.'],
  ['hier', 'dort', ['überall','nirgends','daneben'], 'An jenem Ort drüben.'],
  ['kommen', 'gehen', ['warten','rennen','sehen'], 'Sich entfernen.'],
  ['hinein', 'hinaus', ['drüben','seitlich','unten'], 'Nach außen.'],
  ['frei', 'gefangen', ['leicht','offen','beweglich'], 'Eingesperrt.'],
  ['ruhig', 'unruhig', ['still','sanft','leise'], 'Nervös und aufgeregt.'],
  ['hart arbeiten', 'faulenzen', ['lernen','kämpfen','planen'], 'Auf dem Sofa nichts tun.'],
  ['Wahrheit', 'Lüge', ['Frage','Antwort','Witz'], 'Etwas Falsches behaupten.'],
  ['Sieg', 'Niederlage', ['Kampf','Versuch','Spiel'], 'Verloren haben.'],
  ['steigen', 'sinken', ['fliegen','rollen','springen'], 'Nach unten gehen.'],
  ['gewinnen', 'verlieren', ['versuchen','warten','denken'], 'Eine Niederlage erleiden.'],
  ['flach', 'hügelig', ['glatt','eben','offen'], 'Mit kleinen Erhebungen.'],
  ['stehen', 'sitzen', ['liegen','knien','hocken'], 'Auf dem Stuhl ruhen.'],
  ['anfangen', 'beenden', ['starten','beginnen','aufmachen'], 'Schluss machen.'],
  ['öffnen', 'verschließen', ['aufmachen','heben','ziehen'], 'Mit Schloss zumachen.'],
  ['ehrlich', 'unehrlich', ['offen','wahr','klar'], 'Lügt und betrügt.'],
];

// "Reime"
const POOL_RHYMES = [
  ['Haus', 'Maus', ['Tisch','Lampe','Buch'], 'Ein kleines Tier mit langem Schwanz.', 'Haus'],
  ['Sonne', 'Wonne', ['Mond','Stern','Wolke'], 'Ein altes Wort für Freude.', 'Sonne'],
  ['Katze', 'Tatze', ['Hund','Maus','Vogel'], 'Was eine Katze als Pfote hat.', 'Hauskatze'],
  ['Baum', 'Traum', ['Wald','Blatt','Ast'], 'Was man nachts erlebt.', 'Baum'],
  ['Hand', 'Sand', ['Fuß','Arm','Bein'], 'Davon liegt viel am Strand.', 'Hand'],
  ['Zeit', 'Leid', ['Stunde','Uhr','Tag'], 'Anderes Wort für Schmerz.', 'Armbanduhr'],
  ['Bär', 'Meer', ['Wald','Berg','Höhle'], 'Salzwasser.', 'Braunbär'],
  ['Wein', 'Bein', ['Trauben','Glas','Flasche'], 'Damit läuft man.', 'Rotwein'],
  ['Tag', 'Schlag', ['Nacht','Sonne','Licht'], 'Ein Hieb mit der Hand.', 'Sonne'],
  ['Tier', 'Bier', ['Hund','Katze','Vogel'], 'Alkoholisches Getränk aus Gerste.', 'Hund'],
  ['Mund', 'Hund', ['Lippe','Zahn','Zunge'], 'Vierbeiner mit Bell.', 'Hauskatze'],
  ['Tor', 'Ohr', ['Tür','Eingang','Pforte'], 'Damit hört man.', 'Brandenburger Tor'],
  ['Nase', 'Vase', ['Gesicht','Auge','Mund'], 'Behälter für Blumen.', 'Rose'],
  ['Buch', 'Tuch', ['Heft','Roman','Brief'], 'Stoffstück zum Trocknen.', 'Buch'],
  ['Stern', 'Kern', ['Mond','Sonne','Himmel'], 'Mitte einer Frucht.', 'Apfel'],
  ['Eis', 'Reis', ['Schnee','Frost','Kälte'], 'Korn als Beilage.', 'Eis'],
  ['Brot', 'Not', ['Brötchen','Mehl','Teig'], 'Schlimme Lage.', 'Brot'],
  ['Flasche', 'Tasche', ['Glas','Krug','Becher'], 'Trägt man unterm Arm.', 'Flasche'],
  ['Wand', 'Land', ['Decke','Boden','Mauer'], 'Großes Gebiet mit Grenzen.', 'Wiese'],
  ['Licht', 'Gedicht', ['Lampe','Strahl','Schein'], 'Gereimter Text.', 'Lampe'],
  ['Stein', 'klein', ['Fels','Sand','Erde'], 'Das Gegenteil von groß.', 'Felsen'],
  ['Hut', 'gut', ['Mütze','Cap','Kappe'], 'Das Gegenteil von schlecht.', 'Hut'],
  ['Glas', 'Gras', ['Becher','Tasse','Krug'], 'Wächst auf der Wiese.', 'Glas'],
  ['Mond', 'Hund', ['Stern','Sonne','Nacht'], 'Bellt im Garten.', 'Mond'],
  ['Wurm', 'Turm', ['Made','Larve','Käfer'], 'Hohes Bauwerk.', 'Berliner Fernsehturm'],
  ['Fluss', 'Schluss', ['Bach','Strom','See'], 'Das Ende von etwas.', 'Fluss'],
  ['Maus', 'Strauß', ['Ratte','Käfer','Spinne'], 'Großer flugunfähiger Vogel.', 'Hausmaus'],
  ['Schnee', 'See', ['Eis','Frost','Kälte'], 'Stilles Gewässer.', 'See'],
  ['Tisch', 'Fisch', ['Stuhl','Bank','Möbel'], 'Schwimmt im Wasser.', 'Tisch'],
  ['Hose', 'Rose', ['Kleid','Hemd','Mantel'], 'Stachelige Blume.', 'Hose'],
  ['Wand', 'Land', ['Decke','Boden','Mauer'], 'Großes Gebiet, hat Grenzen.', 'Wiese'],
  ['Faden', 'Laden', ['Knoten','Schnur','Garn'], 'Geschäft zum Einkaufen.', 'Buch'],
  ['Mauer', 'Bauer', ['Wand','Stein','Zaun'], 'Bestellt das Feld.', 'Wiese'],
  ['Brot', 'Tot', ['Mehl','Hefe','Brötchen'], 'Nicht mehr lebendig.', 'Brot'],
  ['Schuh', 'Kuh', ['Stiefel','Sohle','Lasche'], 'Gibt Milch.', 'Schuh'],
  ['Wagen', 'Fragen', ['Auto','Karren','Reifen'], 'Wenn man etwas wissen will.', 'Auto'],
  ['Garten', 'Karten', ['Beet','Rasen','Hecke'], 'Damit spielt man Skat.', 'Wiese'],
  ['Wand', 'Sand', ['Mauer','Tapete','Boden'], 'Davon liegt viel am Strand.', 'Felsen'],
  ['Stein', 'Wein', ['Sand','Erde','Lehm'], 'Alkohol aus Trauben.', 'Felsen'],
  ['Buch', 'Kuchen', ['Heft','Roman','Brief'], 'Süßes Backwerk.', 'Buch'],
  ['Frau', 'Bau', ['Mädchen','Mutter','Tochter'], 'Wo Häuser entstehen.', 'Frau'],
  ['Fuß', 'Gruß', ['Bein','Knie','Hüfte'], 'Sagt man zur Begrüßung.', 'Fuß'],
  ['Eule', 'Säule', ['Kauz','Falke','Vogel'], 'Tragender Pfeiler in einem Tempel.', 'Akropolis'],
  ['Kerze', 'Schmerze', ['Flamme','Wachs','Docht'], 'Etwas was wehtut (Mehrzahl).', 'Kerze'],
  ['Tasse', 'Hasse', ['Becher','Krug','Glas'], 'Starkes Verb für „nicht mögen".', 'Tasse'],
  ['Brille', 'Stille', ['Glas','Sehhilfe','Bügel'], 'Wenn niemand spricht.', 'Brille'],
  ['Topf', 'Kopf', ['Pfanne','Dampf','Deckel'], 'Wo das Gehirn ist.', 'Kochtopf'],
  ['Lampe', 'Rampe', ['Licht','Birne','Schalter'], 'Beim LKW zum Beladen.', 'Lampe'],
  ['Hut', 'Mut', ['Kappe','Mütze','Helm'], 'Eigenschaft tapferer Menschen.', 'Hut'],
  ['Schloss', 'Floß', ['Burg','Mauer','Turm'], 'Schwimmt auf dem Wasser.', 'Hohenzollern'],
  ['Berg', 'Zwerg', ['Tal','Hügel','Gipfel'], 'Kleines Wesen aus dem Märchen.', 'Berg'],
  ['Frosch', 'Bosch', ['Lurch','Kröte','Quappe'], 'Bekannte Marke für Werkzeuge.', 'Pony'],
  ['Mücke', 'Brücke', ['Stechen','Insekt','Sumpf'], 'Geht über einen Fluss.', 'Mücke'],
  ['Stuhl', 'Pfuhl', ['Sofa','Sitz','Bank'], 'Anderes Wort für Pfütze oder Sumpf.', 'Stuhl'],
  ['Spiel', 'Ziel', ['Würfel','Karten','Tor'], 'Wo man ankommen will.', 'Spielzeug'],
  ['Lärm', 'Schwarm', ['Krach','Ton','Geräusch'], 'Viele Bienen oder Vögel zusammen.', 'Lärm'],
  ['Bus', 'Fluss', ['Zug','Straßenbahn','Auto'], 'Großes Wasser, fließt.', 'Bus'],
  ['Schlitz', 'Witz', ['Loch','Spalte','Riss'], 'Etwas zum Lachen.', 'Schlitten'],
  ['Saft', 'Kraft', ['Limo','Wasser','Tee'], 'Was Sportler haben.', 'Apfel'],
  ['Stadt', 'Statt', ['Ort','Dorf','Siedlung'], 'Wenn man etwas anderes tut.', 'Berlin'],
  ['Kraut', 'laut', ['Pflanze','Blätter','Tee'], 'Sehr lautstark.', 'Pflanze'],
  ['Mond', 'Pfund', ['Stern','Nacht','Licht'], '500 Gramm.', 'Mond'],
  ['Fleisch', 'Geheiß', ['Wurst','Gulasch','Steak'], 'Auf Anweisung von jemandem.', 'Fleisch'],
  ['Garten', 'warten', ['Beet','Rasen','Weg'], 'Auf etwas hoffen.', 'Wiese'],
  ['Pfanne', 'Tanne', ['Topf','Gusseisen','Pfannkuchen'], 'Nadelbaum, der Weihnachten geschmückt wird.', 'Tanne'],
  ['Ochse', 'Boxe', ['Stier','Bulle','Rind'], 'Sportkampf mit Handschuhen (Mehrzahl).', 'Stier'],
  ['Kerze', 'Schmerze', ['Wachs','Flamme','Docht'], 'Wenn man sich verletzt (Mehrzahl).', 'Kerze'],
];

// "Wortpaare"
const POOL_WORDPAIRS = [
  ['Brot', 'Butter', ['Wasser','Stein','Tisch'], 'Streicht man auf das Brot.', 'Brot'],
  ['Hammer', 'Nagel', ['Auto','Buch','Glas'], 'Etwas Dünnes aus Eisen.', 'Hammer'],
  ['Schloss', 'Schlüssel', ['Tür','Fenster','Wand'], 'Damit öffnet man.', 'Türschloss'],
  ['Nadel', 'Faden', ['Schere','Stoff','Knopf'], 'Zum Nähen, dünn und lang.', 'Nähnadel'],
  ['Tasse', 'Untertasse', ['Glas','Teller','Gabel'], 'Der kleine Teller darunter.', 'Tasse'],
  ['Regen', 'Schirm', ['Sonne','Schnee','Wind'], 'Hält den Kopf trocken.', 'Regenschirm'],
  ['Salz', 'Pfeffer', ['Zucker','Mehl','Öl'], 'Anderes Gewürz im Streuer.', 'Salz'],
  ['Tisch', 'Stuhl', ['Sofa','Bett','Regal'], 'Worauf man am Tisch sitzt.', 'Tisch'],
  ['Tag', 'Nacht', ['Morgen','Abend','Mittag'], 'Wenn der Mond am Himmel steht.', 'Mond'],
  ['Hund', 'Katze', ['Maus','Pferd','Kuh'], 'Schnurrt und fängt Mäuse.', 'Hund'],
  ['Mann', 'Frau', ['Junge','Mädchen','Kind'], 'Erwachsene weibliche Person.', 'Pony'],
  ['Vater', 'Mutter', ['Großvater','Sohn','Bruder'], 'Hat Kinder geboren.', 'Hauskatze'],
  ['Bruder', 'Schwester', ['Cousin','Tante','Vater'], 'Weibliches Geschwister.', 'Hund'],
  ['Sommer', 'Winter', ['Herbst','Frühling','Mai'], 'Kalt mit Schnee.', 'Schnee'],
  ['Sonne', 'Mond', ['Stern','Wolke','Himmel'], 'Scheint nachts.', 'Mond'],
  ['Tisch', 'Decke', ['Stuhl','Boden','Wand'], 'Liegt auf dem Esstisch.', 'Tisch'],
  ['Auto', 'Reifen', ['Motor','Hupe','Sitz'], 'Rund und aus Gummi.', 'Auto'],
  ['Buch', 'Seite', ['Deckel','Titel','Wort'], 'Ein einzelnes Blatt zum Lesen.', 'Buch'],
  ['Schuh', 'Sohle', ['Schnürsenkel','Absatz','Leder'], 'Untere Fläche des Schuhs.', 'Schuh'],
  ['Auge', 'Wimpern', ['Augenbraue','Lid','Pupille'], 'Kleine Härchen am Auge.', 'Auge'],
  ['Hand', 'Finger', ['Faust','Daumen','Nagel'], 'Ein Glied der Hand (es gibt fünf).', 'Hand'],
  ['Vogel', 'Feder', ['Schnabel','Flügel','Nest'], 'Womit Vögel ihren Körper bedecken.', 'Vogel'],
  ['Topf', 'Deckel', ['Henkel','Boden','Pfanne'], 'Verschließt den Topf oben.', 'Kochtopf'],
  ['Stift', 'Tinte', ['Papier','Mine','Spitze'], 'Flüssigkeit zum Schreiben.', 'Buch'],
  ['Bett', 'Kissen', ['Decke','Matratze','Laken'], 'Liegt unter dem Kopf.', 'Bett'],
  ['Tasse', 'Henkel', ['Boden','Rand','Tee'], 'Daran hält man die Tasse.', 'Tasse'],
  ['Schloss', 'Riegel', ['Knauf','Tür','Klinke'], 'Schiebt man, um eine Tür zu sichern.', 'Schloss'],
  ['Brille', 'Bügel', ['Glas','Rahmen','Linse'], 'Hält die Brille hinter dem Ohr.', 'Brille'],
  ['Schiff', 'Anker', ['Mast','Segel','Boot'], 'Hält das Schiff im Hafen fest.', 'Schiff'],
  ['Briefumschlag', 'Brief', ['Stempel','Adresse','Marke'], 'Steckt im Briefumschlag.', 'Buch'],
  ['Hahn', 'Henne', ['Küken','Gans','Ente'], 'Weibliches Huhn.', 'Hahn'],
  ['Frau', 'Mann', ['Kind','Junge','Mädchen'], 'Erwachsener männlicher Mensch.', 'Frau'],
  ['Junge', 'Mädchen', ['Mann','Frau','Kind'], 'Weibliches Kind.', 'Pony'],
  ['König', 'Königin', ['Prinz','Bauer','Diener'], 'Weibliche Herrscherin.', 'Brandenburger Tor'],
  ['Lehrer', 'Schüler', ['Direktor','Klasse','Tafel'], 'Wer in der Schule lernt.', 'Buch'],
  ['Ball', 'Tor', ['Wiese','Trikot','Pfeife'], 'Wo der Ball reingehört beim Fußball.', 'Brandenburger Tor'],
  ['Schlüssel', 'Schloss', ['Tür','Schrank','Riegel'], 'Wird mit dem Schlüssel geöffnet.', 'Schlüssel'],
  ['Schiff', 'Hafen', ['Mast','Segel','Anker'], 'Wo das Schiff anlegt.', 'Hamburger Hafen'],
  ['Zug', 'Schiene', ['Wagen','Lok','Bahnhof'], 'Worauf der Zug fährt.', 'Zug'],
  ['Auto', 'Garage', ['Motor','Reifen','Sitz'], 'Wo das Auto nachts steht.', 'Auto'],
  ['Pferd', 'Stall', ['Sattel','Mähne','Zaum'], 'Schlafplatz des Pferdes.', 'Pferd'],
  ['Bett', 'Matratze', ['Kopfkissen','Bettdecke','Laken'], 'Liegt im Bettrahmen.', 'Bett'],
  ['Glas', 'Wein', ['Tropfen','Flasche','Karaffe'], 'Was man im Weinglas trinkt.', 'Glas'],
  ['Pinsel', 'Farbe', ['Bild','Leinwand','Staffelei'], 'Womit der Pinsel arbeitet.', 'Pinsel'],
  ['Hammer', 'Schraube', ['Nagel','Holz','Brett'], 'Etwas das man mit dem Schraubenzieher anzieht.', 'Hammer'],
  ['Hund', 'Halsband', ['Leine','Pfote','Knochen'], 'Trägt der Hund um den Hals.', 'Hund'],
  ['Vogel', 'Käfig', ['Nest','Ast','Feder'], 'Wo der Vogel zuhause ist im Wohnzimmer.', 'Vogel'],
  ['Fisch', 'Aquarium', ['Wasser','Schuppen','Flosse'], 'Wo der Goldfisch schwimmt.', 'Fisch'],
  ['Kuh', 'Stall', ['Wiese','Heu','Glocke'], 'Wo die Kuh schläft.', 'Kuh'],
  ['Salz', 'Salzstreuer', ['Korn','Kristall','Pfanne'], 'Behälter für Salz auf dem Tisch.', 'Salz'],
  ['Pfeffer', 'Pfeffermühle', ['Korn','Streuer','Glas'], 'Mahlt Pfefferkörner frisch.', 'Salz'],
  ['Apfel', 'Stiel', ['Kern','Schale','Blüte'], 'Verbindet den Apfel mit dem Ast.', 'Apfel'],
  ['Banane', 'Schale', ['Kern','Frucht','Stiel'], 'Wird vor dem Essen entfernt.', 'Banane'],
  ['Telefon', 'Hörer', ['Tasten','Display','Akku'], 'Den hält man ans Ohr.', 'Telefon'],
  ['Brille', 'Etui', ['Bügel','Glas','Putztuch'], 'Schutzbehälter für die Brille.', 'Brille'],
  ['Schuh', 'Schnürsenkel', ['Sohle','Absatz','Lasche'], 'Werden zugebunden.', 'Schuh'],
  ['Auto', 'Lenkrad', ['Motor','Reifen','Sitz'], 'Damit lenkt der Fahrer.', 'Auto'],
  ['Fahrrad', 'Sattel', ['Lenker','Pedal','Speiche'], 'Worauf man sitzt beim Fahrradfahren.', 'Fahrrad'],
  ['Kerze', 'Docht', ['Wachs','Flamme','Halter'], 'Was im Wachs brennt.', 'Kerze'],
  ['Zahnbürste', 'Zahnpasta', ['Mundwasser','Zahnstocher','Zunge'], 'Tube voll cremiger Paste.', 'Zähne'],
  ['Sonne', 'Wärme', ['Licht','Strahl','Hitze'], 'Was die Sonne im Sommer abgibt.', 'Sonne'],
  ['Mond', 'Sterne', ['Planet','Satellit','Wolke'], 'Leuchten zusammen am Nachthimmel.', 'Mond'],
  ['Berg', 'Tal', ['Gipfel','Hang','Höhe'], 'Tiefe Senke zwischen Bergen.', 'Felsen'],
  ['Wolke', 'Regen', ['Sonne','Wind','Schnee'], 'Fällt aus dunklen Wolken.', 'Wolke'],
  ['Eis', 'Schnee', ['Hagel','Frost','Reif'], 'Weißes flockig vom Himmel.', 'Schnee'],
  ['Blitz', 'Donner', ['Sturm','Wolke','Regen'], 'Lautes Geräusch nach dem Blitz.', 'Wolke'],
  ['Auge', 'Pupille', ['Wimper','Lid','Blick'], 'Schwarzer Punkt im Auge.', 'Auge'],
  ['Mund', 'Lippen', ['Zähne','Zunge','Gaumen'], 'Damit küsst man.', 'Mund'],
  ['Kopf', 'Haare', ['Stirn','Schädel','Mund'], 'Wachsen am Kopf.', 'Kopf'],
  ['Hand', 'Daumen', ['Finger','Handfläche','Knochen'], 'Kürzester der fünf Finger.', 'Hand'],
  ['Fuß', 'Zehen', ['Sohle','Ferse','Knöchel'], 'Wie Finger am Fuß.', 'Fuß'],
  ['Brot', 'Marmelade', ['Butter','Käse','Wurst'], 'Süß auf dem Frühstücksbrot.', 'Brot'],
  ['Kaffee', 'Sahne', ['Zucker','Milch','Schokolade'], 'Macht den Kaffee weiß und cremig.', 'Schwarzwälder Kirschtorte'],
  ['Tee', 'Honig', ['Zucker','Zitrone','Milch'], 'Klebriges Süßungsmittel von Bienen.', 'Honig-Glas'],
  ['Pfeffer', 'Mühle', ['Streuer','Salz','Korn'], 'Mahlt Pfefferkörner frisch.', 'Pfeffer'],
  ['Salat', 'Dressing', ['Schüssel','Tomate','Gurke'], 'Soße über dem Salat.', 'Salat'],
  ['Topf', 'Pfannenwender', ['Deckel','Henkel','Boden'], 'Wendet Pfannkuchen.', 'Kochtopf'],
  ['Suppe', 'Schöpfkelle', ['Topf','Teller','Würze'], 'Schöpft Flüssiges aus dem Topf.', 'Kochtopf'],
];

// === SYNONYME (gleiche Bedeutung) ===
const POOL_SYNONYMS = [
  ['schnell', 'rasch', ['langsam','laut','still'], 'Mit hoher Geschwindigkeit.'],
  ['schön', 'hübsch', ['hässlich','breit','tief'], 'Ansehnlich.'],
  ['klug', 'schlau', ['dumm','laut','blass'], 'Geistig wach.'],
  ['traurig', 'betrübt', ['fröhlich','hungrig','wach'], 'Voller Kummer.'],
  ['reich', 'wohlhabend', ['arm','jung','laut'], 'Hat viel Geld.'],
  ['Auto', 'Wagen', ['Bett','Glas','Stein'], 'Fährt auf der Straße.'],
  ['Hund', 'Vierbeiner', ['Vogel','Fisch','Käfer'], 'Bellt.'],
  ['Kind', 'Jugendlicher', ['Greis','Tier','Pflanze'], 'Junger Mensch.'],
  ['mutig', 'tapfer', ['ängstlich','müde','satt'], 'Hat keine Angst.'],
  ['lustig', 'witzig', ['ernst','scharf','dunkel'], 'Bringt zum Lachen.'],
  ['leise', 'still', ['laut','grell','hart'], 'Ohne Lärm.'],
  ['groß', 'mächtig', ['klein','dünn','hell'], 'Von beträchtlicher Größe.'],
  ['arbeiten', 'schaffen', ['ruhen','schlafen','spielen'], 'Tätig sein.'],
  ['Hilfe', 'Unterstützung', ['Streit','Stille','Lärm'], 'Beistand.'],
  ['Freund', 'Kamerad', ['Feind','Fremder','Tier'], 'Vertrauter Mensch.'],
  ['Gefahr', 'Risiko', ['Sicherheit','Frieden','Glück'], 'Bedrohliche Situation.'],
  ['rennen', 'laufen', ['stehen','sitzen','schlafen'], 'Schnell vorwärts bewegen.'],
  ['froh', 'glücklich', ['traurig','müde','wütend'], 'Voller Freude.'],
  ['Wohnung', 'Zuhause', ['Garage','Auto','Werkstatt'], 'Wo man wohnt.'],
  ['weinen', 'heulen', ['lachen','schweigen','singen'], 'Tränen vergießen.'],
  ['Hut', 'Mütze', ['Schuh','Hose','Hemd'], 'Kopfbedeckung.'],
  ['kalt', 'frostig', ['heiß','warm','lau'], 'Niedrige Temperatur.'],
  ['gehen', 'spazieren', ['liegen','rollen','fliegen'], 'Zu Fuß bewegen.'],
  ['alt', 'betagt', ['jung','neu','frisch'], 'Hat ein hohes Alter.'],
  ['Geld', 'Münze', ['Stein','Holz','Stoff'], 'Womit man bezahlt.'],
  ['Buch', 'Roman', ['Apfel','Auto','Stuhl'], 'Zum Lesen.'],
  ['fragen', 'erkundigen', ['antworten','schweigen','rufen'], 'Wissen wollen.'],
  ['Arzt', 'Mediziner', ['Bauer','Tischler','Schüler'], 'Behandelt Kranke.'],
  ['anfangen', 'beginnen', ['enden','aufhören','warten'], 'Starten.'],
  ['Unfall', 'Missgeschick', ['Erfolg','Glück','Plan'], 'Etwas Unschönes geschieht.'],
  ['sprechen', 'reden', ['hören','schweigen','denken'], 'Worte sagen.'],
  ['gucken', 'schauen', ['hören','riechen','schmecken'], 'Mit den Augen wahrnehmen.'],
  ['Brief', 'Schreiben', ['Päckchen','Kiste','Karte'], 'Wird mit der Post versandt.'],
  ['groß', 'gewaltig', ['winzig','schmal','klein'], 'Sehr beträchtlich.'],
  ['niedlich', 'süß', ['hässlich','grob','laut'], 'Lieb anzusehen.'],
  ['Krankheit', 'Leiden', ['Gesundheit','Glück','Stärke'], 'Wenn man nicht gesund ist.'],
  ['mager', 'dünn', ['dick','rund','satt'], 'Sehr schmal gebaut.'],
  ['Lehrer', 'Pädagoge', ['Schüler','Kind','Bauer'], 'Unterrichtet Kinder.'],
  ['vorschlagen', 'empfehlen', ['ablehnen','verbieten','schweigen'], 'Eine Idee anbieten.'],
  ['Feier', 'Fest', ['Trauer','Arbeit','Ruhe'], 'Wenn man etwas Schönes erlebt.'],
  ['Tasche', 'Beutel', ['Schrank','Tisch','Bild'], 'Trägt man am Arm.'],
  ['Mantel', 'Jacke', ['Hose','Hemd','Schuh'], 'Wärmt im Winter.'],
  ['stören', 'belästigen', ['helfen','stützen','beruhigen'], 'Jemandem auf die Nerven gehen.'],
  ['Kummer', 'Sorge', ['Glück','Freude','Mut'], 'Schwere Gedanken.'],
  ['Begegnung', 'Treffen', ['Trennung','Abschied','Flucht'], 'Wenn zwei Menschen aufeinander zukommen.'],
  ['Unterhaltung', 'Gespräch', ['Stille','Lärm','Schrei'], 'Wenn man miteinander redet.'],
  ['gehorchen', 'folgen', ['widerstehen','streiten','schreien'], 'Tun was gesagt wird.'],
  ['Räuber', 'Dieb', ['Bauer','Polizist','Richter'], 'Wer fremdes Eigentum nimmt.'],
  ['Strafe', 'Buße', ['Lob','Lohn','Gabe'], 'Was man bekommt wenn man etwas falsch macht.'],
  ['weise', 'klug', ['dumm','jung','laut'], 'Voller Lebenserfahrung.'],
  ['Bewegung', 'Gymnastik', ['Ruhe','Stille','Stillstand'], 'Sportliche Übungen.'],
  ['Wohnung', 'Apartment', ['Garage','Stall','Werkstatt'], 'Modernes Wort für eine kleine Wohneinheit.'],
  ['Freude', 'Vergnügen', ['Trauer','Sorge','Mühe'], 'Etwas das Spaß macht.'],
  ['rasch', 'eilig', ['langsam','sanft','still'], 'Mit hoher Geschwindigkeit.'],
  ['frech', 'dreist', ['nett','höflich','lieb'], 'Unverschämt und respektlos.'],
  ['Schlafzimmer', 'Boudoir', ['Küche','Bad','Garten'], 'Französischer Begriff für Schlafraum.'],
  ['Gefahr', 'Bedrohung', ['Sicherheit','Frieden','Glück'], 'Etwas das schaden kann.'],
  ['Geheimnis', 'Mysterium', ['Wahrheit','Klarheit','Antwort'], 'Etwas das verborgen bleibt.'],
  ['Glaube', 'Religion', ['Wissen','Zweifel','Antwort'], 'Konfession und Tradition.'],
  ['Gewohnheit', 'Routine', ['Neuheit','Überraschung','Zufall'], 'Was man jeden Tag macht.'],
  ['Glück', 'Zufriedenheit', ['Trauer','Pech','Schmerz'], 'Wenn alles gut ist.'],
  ['hartnäckig', 'stur', ['weich','sanft','flexibel'], 'Bockig und nicht nachgebend.'],
  ['Held', 'Vorbild', ['Feigling','Verlierer','Schurke'], 'Jemand den man bewundert.'],
  ['hilfreich', 'nützlich', ['unbrauchbar','schädlich','störend'], 'Wenn etwas Gutes bringt.'],
  ['intelligent', 'gescheit', ['dumm','blöd','laut'], 'Geistig leistungsfähig.'],
  ['interessant', 'spannend', ['langweilig','öde','still'], 'Hält die Aufmerksamkeit.'],
  ['Kollege', 'Mitarbeiter', ['Feind','Fremder','Gegner'], 'Mit der Person arbeitet man zusammen.'],
  ['kompliziert', 'verzwickt', ['einfach','klar','leicht'], 'Schwer zu verstehen.'],
  ['König', 'Monarch', ['Bauer','Diener','Knecht'], 'Höchste herrschende Person.'],
  ['langweilig', 'öde', ['lustig','spannend','witzig'], 'Wenn nichts passiert.'],
  ['Lärm', 'Krach', ['Stille','Ruhe','Schweigen'], 'Sehr laut.'],
  ['Lehrer', 'Pädagoge', ['Schüler','Klempner','Bäcker'], 'Wer Wissen vermittelt.'],
  ['logisch', 'vernünftig', ['unsinnig','dumm','wirr'], 'Ergibt Sinn.'],
  ['Mund', 'Maul', ['Hand','Fuß','Auge'], 'Bei Tieren so genannt.'],
  ['mutig', 'tapfer', ['feige','ängstlich','still'], 'Hat keine Angst.'],
  ['nett', 'freundlich', ['unhöflich','gemein','frech'], 'Lieb und höflich.'],
  ['oben', 'darüber', ['unten','seitlich','versteckt'], 'Über etwas hinweg.'],
  ['offen', 'geöffnet', ['zu','geschlossen','dicht'], 'Tür weit auf.'],
  ['Plage', 'Last', ['Glück','Erleichterung','Spaß'], 'Etwas das schwer drückt.'],
  ['Plan', 'Vorhaben', ['Zufall','Chaos','Fehler'], 'Etwas das man vorher überlegt.'],
  ['raten', 'tippen', ['wissen','klären','beweisen'], 'Eine Vermutung äußern.'],
  ['ruhig', 'still', ['laut','wild','grell'], 'Ohne Lärm.'],
  ['Schaden', 'Verlust', ['Gewinn','Vorteil','Glück'], 'Wenn man etwas nicht mehr hat.'],
  ['Schicksal', 'Bestimmung', ['Zufall','Wahl','Glück'], 'Was vorherbestimmt ist.'],
  ['schützen', 'bewahren', ['gefährden','verlassen','aussetzen'], 'Etwas sicher halten.'],
  ['Sehnsucht', 'Verlangen', ['Abneigung','Hass','Sattheit'], 'Sich nach etwas zurücksehnen.'],
  ['Stimme', 'Ton', ['Stille','Ruhe','Schweigen'], 'Klang aus dem Mund.'],
  ['Streit', 'Zank', ['Frieden','Einigkeit','Eintracht'], 'Lautstarker Disput.'],
  ['Tasche', 'Beutel', ['Schrank','Regal','Kasten'], 'Behälter zum Tragen.'],
  ['traurig', 'betrübt', ['fröhlich','heiter','laut'], 'Niedergeschlagene Stimmung.'],
  ['Treppe', 'Stiege', ['Rampe','Aufzug','Leiter'], 'Stufen die nach oben führen.'],
  ['ungezogen', 'frech', ['brav','folgsam','ruhig'], 'Bei Kindern, die nicht hören.'],
  ['unsicher', 'wackelig', ['stabil','fest','sicher'], 'Wenn ein Stuhl wankt.'],
  ['Verbrecher', 'Krimineller', ['Bürger','Helfer','Held'], 'Wer gegen das Gesetz verstößt.'],
  ['Verein', 'Klub', ['Einzelperson','Gruppe','Liga'], 'Englisches Wort dafür.'],
  ['verstecken', 'verbergen', ['zeigen','offenlegen','enthüllen'], 'Etwas vor Blicken schützen.'],
  ['vorher', 'zuvor', ['danach','später','nachher'], 'Vor einem Ereignis.'],
  ['Wäldchen', 'Hain', ['Wüste','Steppe','Eiskante'], 'Kleine Gruppe von Bäumen.'],
  ['Wand', 'Mauer', ['Decke','Boden','Tür'], 'Aus Steinen oder Beton, vertikal.'],
  ['Wiese', 'Weide', ['Wald','Acker','Garten'], 'Grasfläche wo Kühe grasen.'],
];

// === WORTFINDUNG (Buchstabe + Kategorie) ===
const POOL_WORDFIND = [
  // Tiere
  { kategorie: 'Tier', buchstabe: 'B', correct: 'Bär', distract: ['Auto','Banane','Tisch'] },
  { kategorie: 'Tier', buchstabe: 'F', correct: 'Fuchs', distract: ['Hose','Buch','Apfel'] },
  { kategorie: 'Tier', buchstabe: 'H', correct: 'Hund', distract: ['Stuhl','Brot','Lampe'] },
  { kategorie: 'Tier', buchstabe: 'K', correct: 'Katze', distract: ['Tisch','Mantel','Salz'] },
  { kategorie: 'Tier', buchstabe: 'M', correct: 'Maus', distract: ['Stuhl','Eimer','Wein'] },
  { kategorie: 'Tier', buchstabe: 'P', correct: 'Pferd', distract: ['Decke','Brot','Hut'] },
  { kategorie: 'Tier', buchstabe: 'S', correct: 'Schaf', distract: ['Tasse','Kissen','Bild'] },
  { kategorie: 'Tier', buchstabe: 'V', correct: 'Vogel', distract: ['Brot','Hose','Lampe']},
  // Berufe
  { kategorie: 'Beruf', buchstabe: 'A', correct: 'Arzt', distract: ['Apfel','Auto','Anker']},
  { kategorie: 'Beruf', buchstabe: 'B', correct: 'Bäcker', distract: ['Birne','Buch','Berg']},
  { kategorie: 'Beruf', buchstabe: 'F', correct: 'Friseur', distract: ['Frosch','Fisch','Feder']},
  { kategorie: 'Beruf', buchstabe: 'G', correct: 'Gärtner', distract: ['Garten','Glas','Geld']},
  { kategorie: 'Beruf', buchstabe: 'K', correct: 'Koch', distract: ['Kuchen','Kerze','Krug']},
  { kategorie: 'Beruf', buchstabe: 'L', correct: 'Lehrer', distract: ['Lampe','Löffel','Linde']},
  { kategorie: 'Beruf', buchstabe: 'M', correct: 'Maler', distract: ['Maus','Mantel','Mond']},
  { kategorie: 'Beruf', buchstabe: 'P', correct: 'Polizist', distract: ['Pferd','Pflaume','Pfanne']},
  { kategorie: 'Beruf', buchstabe: 'S', correct: 'Schreiner', distract: ['Stuhl','Sonne','Stern']},
  // Obst und Gemüse
  { kategorie: 'Obst', buchstabe: 'A', correct: 'Apfel', distract: ['Anker','Auto','Antenne']},
  { kategorie: 'Obst', buchstabe: 'B', correct: 'Birne', distract: ['Bus','Bett','Bürste']},
  { kategorie: 'Obst', buchstabe: 'E', correct: 'Erdbeere', distract: ['Eimer','Esel','Eis']},
  { kategorie: 'Obst', buchstabe: 'K', correct: 'Kirsche', distract: ['Kissen','Krug','Kerze']},
  { kategorie: 'Obst', buchstabe: 'O', correct: 'Orange', distract: ['Ofen','Ohr','Otter']},
  { kategorie: 'Obst', buchstabe: 'P', correct: 'Pflaume', distract: ['Puppe','Pfanne','Plakat']},
  { kategorie: 'Obst', buchstabe: 'Z', correct: 'Zitrone', distract: ['Zaun','Zug','Zucker']},
  // Städte (deutsche)
  { kategorie: 'Stadt in Deutschland', buchstabe: 'B', correct: 'Berlin', distract: ['Bonn','Bremen','Bochum']},
  { kategorie: 'Stadt in Deutschland', buchstabe: 'F', correct: 'Frankfurt', distract: ['Freiburg','Fürth','Flensburg']},
  { kategorie: 'Stadt in Deutschland', buchstabe: 'H', correct: 'Hamburg', distract: ['Hannover','Heidelberg','Halle']},
  { kategorie: 'Stadt in Deutschland', buchstabe: 'K', correct: 'Köln', distract: ['Kassel','Karlsruhe','Kiel']},
  { kategorie: 'Stadt in Deutschland', buchstabe: 'M', correct: 'München', distract: ['Mainz','Mannheim','Münster']},
  { kategorie: 'Stadt in Deutschland', buchstabe: 'S', correct: 'Stuttgart', distract: ['Saarbrücken','Schwerin','Siegen']},
  // Blumen
  { kategorie: 'Blume', buchstabe: 'L', correct: 'Lilie', distract: ['Lampe','Löwe','Linse']},
  { kategorie: 'Blume', buchstabe: 'N', correct: 'Nelke', distract: ['Nacht','Nadel','Note']},
  { kategorie: 'Blume', buchstabe: 'R', correct: 'Rose', distract: ['Ring','Reis','Regen']},
  { kategorie: 'Blume', buchstabe: 'T', correct: 'Tulpe', distract: ['Tasse','Tiger','Topf']},
  { kategorie: 'Blume', buchstabe: 'V', correct: 'Veilchen', distract: ['Vase','Vogel','Vater']},
  // Gemüse
  { kategorie: 'Gemüse', buchstabe: 'K', correct: 'Karotte', distract: ['Kuchen','Krug','Kerze']},
  { kategorie: 'Gemüse', buchstabe: 'P', correct: 'Paprika', distract: ['Pflaume','Pfanne','Plakat']},
  { kategorie: 'Gemüse', buchstabe: 'S', correct: 'Salat', distract: ['Sand','Schuh','Stern']},
  { kategorie: 'Gemüse', buchstabe: 'Z', correct: 'Zwiebel', distract: ['Zaun','Zucker','Zirkus']},
  { kategorie: 'Gemüse', buchstabe: 'B', correct: 'Brokkoli', distract: ['Buch','Bett','Birke']},
  { kategorie: 'Gemüse', buchstabe: 'G', correct: 'Gurke', distract: ['Glas','Geige','Gabel']},
  // Länder
  { kategorie: 'Land in Europa', buchstabe: 'D', correct: 'Deutschland', distract: ['Dänemark','Dominica','Dschibuti']},
  { kategorie: 'Land in Europa', buchstabe: 'F', correct: 'Frankreich', distract: ['Finnland','Färöer','Fidschi']},
  { kategorie: 'Land in Europa', buchstabe: 'I', correct: 'Italien', distract: ['Indien','Iran','Israel']},
  { kategorie: 'Land in Europa', buchstabe: 'P', correct: 'Polen', distract: ['Peru','Pakistan','Panama']},
  { kategorie: 'Land in Europa', buchstabe: 'S', correct: 'Spanien', distract: ['Senegal','Singapur','Sudan']},
  // Möbel
  { kategorie: 'Möbel', buchstabe: 'B', correct: 'Bett', distract: ['Birne','Buch','Brot']},
  { kategorie: 'Möbel', buchstabe: 'S', correct: 'Stuhl', distract: ['Sand','Sonne','Salz']},
  { kategorie: 'Möbel', buchstabe: 'T', correct: 'Tisch', distract: ['Topf','Tasche','Turm']},
  { kategorie: 'Möbel', buchstabe: 'R', correct: 'Regal', distract: ['Rad','Rose','Ring']},
  // Werkzeuge
  { kategorie: 'Werkzeug', buchstabe: 'H', correct: 'Hammer', distract: ['Hand','Hut','Hund']},
  { kategorie: 'Werkzeug', buchstabe: 'S', correct: 'Säge', distract: ['Sand','Stuhl','Salz']},
  { kategorie: 'Werkzeug', buchstabe: 'Z', correct: 'Zange', distract: ['Zucker','Zelt','Zaun']},
  { kategorie: 'Werkzeug', buchstabe: 'B', correct: 'Bohrer', distract: ['Buch','Bett','Birne']},
  // Musikinstrumente
  { kategorie: 'Musikinstrument', buchstabe: 'G', correct: 'Gitarre', distract: ['Glas','Garten','Gabel']},
  { kategorie: 'Musikinstrument', buchstabe: 'K', correct: 'Klavier', distract: ['Kerze','Krone','Kuchen']},
  { kategorie: 'Musikinstrument', buchstabe: 'T', correct: 'Trompete', distract: ['Tasche','Teller','Topf']},
  { kategorie: 'Musikinstrument', buchstabe: 'V', correct: 'Violine', distract: ['Vase','Vogel','Volk']},
  // Kleidung
  { kategorie: 'Kleidung', buchstabe: 'H', correct: 'Hose', distract: ['Hund','Haus','Hammer']},
  { kategorie: 'Kleidung', buchstabe: 'M', correct: 'Mantel', distract: ['Mehl','Maus','Mond']},
  { kategorie: 'Kleidung', buchstabe: 'S', correct: 'Schuh', distract: ['Sonne','Stern','Salz']},
  { kategorie: 'Kleidung', buchstabe: 'P', correct: 'Pullover', distract: ['Pferd','Pfanne','Pflaster']},
  // Sportarten
  { kategorie: 'Sportart', buchstabe: 'F', correct: 'Fußball', distract: ['Frosch','Feder','Fenster']},
  { kategorie: 'Sportart', buchstabe: 'T', correct: 'Tennis', distract: ['Topf','Tasche','Tafel']},
  { kategorie: 'Sportart', buchstabe: 'S', correct: 'Schwimmen', distract: ['Stuhl','Stein','Schule']},
  { kategorie: 'Sportart', buchstabe: 'B', correct: 'Boxen', distract: ['Buch','Birne','Brot']},
  { kategorie: 'Sportart', buchstabe: 'R', correct: 'Reiten', distract: ['Regen','Reis','Ring']},
  // Getränke
  { kategorie: 'Getränk', buchstabe: 'B', correct: 'Bier', distract: ['Brot','Buch','Bett']},
  { kategorie: 'Getränk', buchstabe: 'W', correct: 'Wasser', distract: ['Wand','Wald','Wolke']},
  { kategorie: 'Getränk', buchstabe: 'M', correct: 'Milch', distract: ['Mond','Maus','Mehl']},
  { kategorie: 'Getränk', buchstabe: 'T', correct: 'Tee', distract: ['Tisch','Topf','Turm']},
  { kategorie: 'Getränk', buchstabe: 'K', correct: 'Kaffee', distract: ['Kuchen','Krone','Kissen']},
  { kategorie: 'Getränk', buchstabe: 'S', correct: 'Saft', distract: ['Sand','Stein','Sofa']},
  // Möbel
  { kategorie: 'Möbel', buchstabe: 'K', correct: 'Kommode', distract: ['Krone','Kerze','Kuchen']},
  { kategorie: 'Möbel', buchstabe: 'S', correct: 'Schrank', distract: ['Stein','Sand','Salz']},
  { kategorie: 'Möbel', buchstabe: 'L', correct: 'Liege', distract: ['Lampe','Linde','Linse']},
  // Berufe (mehr)
  { kategorie: 'Beruf', buchstabe: 'D', correct: 'Dachdecker', distract: ['Dachs','Dose','Drachen']},
  { kategorie: 'Beruf', buchstabe: 'I', correct: 'Ingenieur', distract: ['Insel','Igel','Idee']},
  { kategorie: 'Beruf', buchstabe: 'J', correct: 'Journalist', distract: ['Junge','Jacke','Jahr']},
  { kategorie: 'Beruf', buchstabe: 'O', correct: 'Optiker', distract: ['Otter','Ofen','Oase']},
  { kategorie: 'Beruf', buchstabe: 'Z', correct: 'Zahnarzt', distract: ['Zucker','Zitrone','Zaun']},
  // Tiere (mehr)
  { kategorie: 'Tier', buchstabe: 'A', correct: 'Affe', distract: ['Apfel','Auto','Ampel']},
  { kategorie: 'Tier', buchstabe: 'D', correct: 'Dachs', distract: ['Dose','Decke','Dorf']},
  { kategorie: 'Tier', buchstabe: 'E', correct: 'Esel', distract: ['Eis','Erbse','Erde']},
  { kategorie: 'Tier', buchstabe: 'G', correct: 'Giraffe', distract: ['Glas','Gabel','Garten']},
  { kategorie: 'Tier', buchstabe: 'I', correct: 'Igel', distract: ['Insel','Idee','Iglu']},
  { kategorie: 'Tier', buchstabe: 'L', correct: 'Löwe', distract: ['Lampe','Lehrer','Liege']},
  { kategorie: 'Tier', buchstabe: 'N', correct: 'Nashorn', distract: ['Nagel','Nase','Nacht']},
  { kategorie: 'Tier', buchstabe: 'O', correct: 'Otter', distract: ['Ofen','Oase','Orange']},
  { kategorie: 'Tier', buchstabe: 'R', correct: 'Reh', distract: ['Regen','Reis','Riese']},
  { kategorie: 'Tier', buchstabe: 'T', correct: 'Tiger', distract: ['Tisch','Tasse','Topf']},
  { kategorie: 'Tier', buchstabe: 'W', correct: 'Wolf', distract: ['Wand','Welle','Weizen']},
  // Obst (mehr)
  { kategorie: 'Obst', buchstabe: 'H', correct: 'Himbeere', distract: ['Heft','Hose','Hund']},
  { kategorie: 'Obst', buchstabe: 'M', correct: 'Mango', distract: ['Maus','Mond','Mehl']},
  { kategorie: 'Obst', buchstabe: 'W', correct: 'Weintraube', distract: ['Wand','Wolke','Wolle']},
  // Länder erweitert
  { kategorie: 'Land in Europa', buchstabe: 'N', correct: 'Norwegen', distract: ['Niger','Namibia','Nepal']},
  { kategorie: 'Land in Europa', buchstabe: 'B', correct: 'Belgien', distract: ['Brasilien','Botswana','Bahamas']},
  { kategorie: 'Land in Europa', buchstabe: 'G', correct: 'Griechenland', distract: ['Ghana','Guatemala','Guinea']},
  { kategorie: 'Land in Europa', buchstabe: 'Ö', correct: 'Österreich', distract: ['Ozeanien','Oman','Ostasien']},
];

// === TIERKINDER ===
const POOL_ANIMAL_KIDS = [
  ['Pferd', 'Fohlen', ['Welpe','Küken','Kalb'], 'Klein und mit langen Beinen, gleich nach der Geburt.'],
  ['Hund', 'Welpe', ['Fohlen','Lamm','Küken'], 'Tapsig und verspielt.'],
  ['Katze', 'Kätzchen', ['Welpe','Lamm','Ferkel'], 'Schon in der Verkleinerungsform vom Namen.'],
  ['Kuh', 'Kalb', ['Lamm','Fohlen','Ferkel'], 'Steht auf der Weide bei seiner Mutter.'],
  ['Schaf', 'Lamm', ['Kalb','Welpe','Küken'], 'Weiß und wollig.'],
  ['Schwein', 'Ferkel', ['Lamm','Welpe','Fohlen'], 'Rosa und neugierig.'],
  ['Ziege', 'Zicklein', ['Lamm','Kalb','Fohlen'], 'Klettert gerne.'],
  ['Huhn', 'Küken', ['Welpe','Lamm','Ferkel'], 'Gelb, klein und flauschig.'],
  ['Ente', 'Entenküken', ['Lamm','Fohlen','Welpe'], 'Schwimmt schon kurz nach der Geburt.'],
  ['Hase', 'Häschen', ['Lamm','Fohlen','Welpe'], 'Lange Ohren in klein.'],
  ['Bär', 'Bärenjunges', ['Welpe','Lamm','Ferkel'], 'Dick und pelzig.'],
  ['Wolf', 'Wolfsjunges', ['Lamm','Fohlen','Ferkel'], 'Verwandt mit dem Hund.'],
  ['Fuchs', 'Fuchswelpe', ['Lamm','Kalb','Küken'], 'Rote Fellfarbe wie die Eltern.'],
  ['Reh', 'Rehkitz', ['Lamm','Fohlen','Küken'], 'Hat weiße Tupfen.'],
  ['Hirsch', 'Hirschkalb', ['Lamm','Welpe','Ferkel'], 'Wird später großes Geweih bekommen.'],
  ['Adler', 'Adlerjunges', ['Welpe','Lamm','Ferkel'], 'Wird später großen Schnabel haben.'],
  ['Storch', 'Storchenküken', ['Lamm','Welpe','Ferkel'], 'Fliegt im Herbst nach Süden.'],
  ['Frosch', 'Kaulquappe', ['Küken','Welpe','Larve'], 'Lebt zuerst nur im Wasser.'],
  ['Schmetterling', 'Raupe', ['Larve','Küken','Welpe'], 'Kriecht und frisst Blätter.'],
  ['Löwe', 'Löwenjunges', ['Lamm','Welpe','Kalb'], 'Wird später eine Mähne tragen.'],
  ['Tiger', 'Tigerjunges', ['Welpe','Lamm','Kalb'], 'Hat orange Streifen.'],
  ['Elefant', 'Elefantenkalb', ['Welpe','Lamm','Ferkel'], 'Wird später einen Rüssel haben.'],
  ['Giraffe', 'Giraffenkalb', ['Lamm','Welpe','Kalb'], 'Wird später sehr lange Beine bekommen.'],
  ['Eule', 'Eulenküken', ['Lamm','Welpe','Ferkel'], 'Wird später nachts jagen.'],
  ['Pinguin', 'Pinguinküken', ['Lamm','Welpe','Ferkel'], 'Watschelt schon klein im Schnee.'],
  ['Maus', 'Mäuschen', ['Lamm','Welpe','Kalb'], 'Schon im Namen verkleinert.'],
  ['Kuckuck', 'Kuckucksjunges', ['Lamm','Welpe','Ferkel'], 'Eltern „rufen" den eigenen Namen.'],
  ['Dachs', 'Dachswelpe', ['Lamm','Welpe','Kalb'], 'Lebt unter der Erde.'],
  ['Igel', 'Igeljunges', ['Lamm','Welpe','Ferkel'], 'Hat schon kleine Stacheln.'],
  ['Eichhörnchen', 'Eichhörnchenjunges', ['Lamm','Welpe','Ferkel'], 'Klettert auf Bäume.'],
  ['Kaninchen', 'Kaninchenjunges', ['Lamm','Welpe','Ferkel'], 'Lange Ohren in klein.'],
  ['Schwan', 'Schwanenküken', ['Lamm','Welpe','Ferkel'], 'Klein und grau, wird groß und weiß.'],
  ['Pfau', 'Pfauenküken', ['Lamm','Welpe','Ferkel'], 'Wird später einen Federfächer tragen.'],
  ['Maulwurf', 'Maulwurfsjunges', ['Lamm','Welpe','Ferkel'], 'Lebt im Erdtunnel.'],
  ['Krokodil', 'Krokodiljunges', ['Lamm','Welpe','Ferkel'], 'Schlüpft aus dem Ei am Wasser.'],
  ['Schildkröte', 'Schildkrötenjunges', ['Lamm','Welpe','Ferkel'], 'Hat einen festen Panzer.'],
  ['Kamel', 'Kamelfohlen', ['Welpe','Lamm','Ferkel'], 'Wird später Höcker bilden.'],
  ['Lama', 'Lamababy', ['Lamm','Welpe','Ferkel'], 'Hat weiches Fell.'],
  ['Wal', 'Walkalb', ['Lamm','Welpe','Ferkel'], 'Schon klein im Meer.'],
  ['Delfin', 'Delfinjunges', ['Lamm','Welpe','Ferkel'], 'Schwimmt schnell und springt.'],
  ['Hai', 'Haijunges', ['Lamm','Welpe','Ferkel'], 'Hat schon scharfe Zähne.'],
  ['Pfau', 'Pfauenküken', ['Welpe','Lamm','Kalb'], 'Vogel mit prächtigem Schwanz.'],
  ['Affe', 'Affenkind', ['Welpe','Lamm','Ferkel'], 'Klettert von Ast zu Ast.'],
  ['Känguru', 'Kängurujunges', ['Welpe','Lamm','Ferkel'], 'Sitzt im Beutel der Mutter.'],
  ['Krähe', 'Krähenküken', ['Welpe','Lamm','Ferkel'], 'Schwarzer Vogel, krächzt laut.'],
  ['Spatz', 'Spatzenküken', ['Welpe','Lamm','Ferkel'], 'Kleiner Stadtvogel.'],
  ['Taube', 'Taubenküken', ['Welpe','Lamm','Ferkel'], 'Friedensvogel der Stadt.'],
  ['Möwe', 'Möwenküken', ['Welpe','Lamm','Ferkel'], 'Vogel an der Küste.'],
  ['Frosch', 'Kaulquappe', ['Lamm','Welpe','Ferkel'], 'Lebt zuerst nur im Wasser.'],
  ['Schmetterling', 'Raupe', ['Lamm','Welpe','Ferkel'], 'Frisst Blätter, dann Verpuppung.'],
  ['Bär', 'Bärenjunges', ['Welpe','Lamm','Ferkel'], 'Pelzig und tapsig.'],
  ['Wolf', 'Wolfsjunges', ['Lamm','Ferkel','Welpe'], 'Sieht aus wie ein Husky-Welpe.'],
  ['Fuchs', 'Fuchswelpe', ['Lamm','Kalb','Küken'], 'Rotes Fell, lebt im Wald.'],
  ['Dachs', 'Dachsjunges', ['Welpe','Lamm','Ferkel'], 'Lebt im Bau unter der Erde.'],
  ['Wildkatze', 'Wildkatzenjunges', ['Welpe','Lamm','Ferkel'], 'Wie ein Kätzchen, nur im Wald.'],
  ['Marder', 'Marderjunges', ['Lamm','Welpe','Ferkel'], 'Schlanker Räuber, klettert gut.'],
  ['Wiesel', 'Wieseljunges', ['Welpe','Lamm','Ferkel'], 'Sehr klein und schnell.'],
  ['Iltis', 'Iltisjunges', ['Lamm','Welpe','Ferkel'], 'Zur Marder-Familie.'],
  ['Otter', 'Otterjunges', ['Welpe','Lamm','Ferkel'], 'Schwimmt gerne im Fluss.'],
  ['Robbe', 'Robbenbaby', ['Welpe','Lamm','Ferkel'], 'Liegt am Strand der Nordsee.'],
  ['Walross', 'Walrossbaby', ['Welpe','Lamm','Ferkel'], 'Kommt später mit großen Hauern.'],
  ['Zebra', 'Zebrafohlen', ['Welpe','Lamm','Ferkel'], 'Wird Streifen tragen.'],
  ['Nashorn', 'Nashornkalb', ['Welpe','Lamm','Ferkel'], 'Bekommt später ein Horn.'],
  ['Hippopotamus', 'Flusspferdkalb', ['Welpe','Lamm','Ferkel'], 'Wird groß und lebt im Fluss.'],
  ['Bison', 'Bisonkalb', ['Welpe','Lamm','Ferkel'], 'Großes nordamerikanisches Tier.'],
  ['Antilope', 'Antilopenkalb', ['Welpe','Lamm','Ferkel'], 'Lebt in der Steppe.'],
  ['Strauß', 'Straußenküken', ['Lamm','Welpe','Ferkel'], 'Wird flugunfähiger Riesenvogel.'],
  ['Specht', 'Spechtjunges', ['Welpe','Lamm','Ferkel'], 'Klopft mit Schnabel ans Holz.'],
  ['Drossel', 'Drosseljunges', ['Welpe','Lamm','Ferkel'], 'Singvogel im Garten.'],
  ['Amsel', 'Amseljunges', ['Welpe','Lamm','Ferkel'], 'Schwarzer Vogel mit gelbem Schnabel.'],
  ['Lerche', 'Lerchenküken', ['Welpe','Lamm','Ferkel'], 'Singt hoch in der Luft.'],
  ['Turmfalke', 'Falkenküken', ['Welpe','Lamm','Ferkel'], 'Greifvogel auf Kirchtürmen.'],
  ['Bussard', 'Bussardküken', ['Welpe','Lamm','Ferkel'], 'Greifvogel über Feldern.'],
  ['Eule', 'Eulenküken', ['Welpe','Lamm','Ferkel'], 'Großes Auge, lebt nachts.'],
  ['Schwein', 'Ferkel', ['Welpe','Lamm','Küken'], 'Rosa Tier, schnaubt.'],
  ['Pferd', 'Fohlen', ['Welpe','Küken','Kalb'], 'Galoppiert auf der Weide.'],
  ['Hund', 'Welpe', ['Fohlen','Lamm','Küken'], 'Hat einen feuchten Hundeblick.'],
  ['Katze', 'Kätzchen', ['Welpe','Lamm','Ferkel'], 'Schnurrt schon klein.'],
  ['Schaf', 'Lamm', ['Kalb','Welpe','Küken'], 'Wollig und blökend.'],
  ['Ziege', 'Zicklein', ['Lamm','Kalb','Fohlen'], 'Klettert gerne hoch.'],
  ['Kuh', 'Kalb', ['Lamm','Fohlen','Ferkel'], 'Steht neben der Mutter auf der Weide.'],
  ['Henne', 'Küken', ['Welpe','Lamm','Ferkel'], 'Gelb und flauschig.'],
  ['Ente', 'Entenküken', ['Lamm','Fohlen','Welpe'], 'Schwimmt schon klein.'],
  ['Gans', 'Gänschen', ['Welpe','Lamm','Ferkel'], 'Watschelt zur Wiese.'],
  ['Esel', 'Eselsfohlen', ['Welpe','Lamm','Ferkel'], 'Lange Ohren von Anfang an.'],
  ['Reh', 'Rehkitz', ['Lamm','Fohlen','Küken'], 'Hat weiße Tupfen.'],
  ['Hirsch', 'Hirschkalb', ['Lamm','Welpe','Ferkel'], 'Wird später ein Geweih tragen.'],
  ['Wildschwein', 'Frischling', ['Welpe','Lamm','Küken'], 'Hat hellbraune Längsstreifen.'],
  ['Eisbär', 'Eisbärenbaby', ['Welpe','Lamm','Ferkel'], 'Polarbewohner, weißes Fell.'],
  ['Panda', 'Pandababy', ['Welpe','Lamm','Ferkel'], 'Frisst Bambus.'],
  ['Koala', 'Joey', ['Welpe','Lamm','Ferkel'], 'Lebt im Eukalyptusbaum.'],
  ['Pinguin', 'Pinguinküken', ['Welpe','Lamm','Ferkel'], 'Watschelt im Schnee.'],
  ['Storch', 'Storchenküken', ['Welpe','Lamm','Ferkel'], 'Roter Schnabel und lange Beine bekommt es.'],
  ['Eichhörnchen', 'Eichhörnchenjunges', ['Welpe','Lamm','Ferkel'], 'Klettert mit buschigem Schwanz.'],
  ['Hase', 'Häschen', ['Welpe','Lamm','Ferkel'], 'Hoppelt durchs Feld.'],
  ['Maus', 'Mäuschen', ['Welpe','Lamm','Ferkel'], 'Schon im Namen klein.'],
  ['Hamster', 'Hamsterjunges', ['Welpe','Lamm','Ferkel'], 'Backentaschen voll.'],
  ['Elefant', 'Elefantenkalb', ['Welpe','Lamm','Ferkel'], 'Wird später einen Rüssel haben.'],
];

// === BERUFE — Wer arbeitet mit was ===
const POOL_PROFESSIONS = [
  // Werkzeug → Beruf
  ['Stethoskop', 'Arzt', ['Bäcker','Maler','Lehrer'], 'Hört damit das Herz ab.'],
  ['Backofen', 'Bäcker', ['Friseur','Polizist','Schreiner'], 'Bäckt Brot und Brötchen.'],
  ['Schere', 'Friseur', ['Arzt','Koch','Maler'], 'Schneidet damit Haare.'],
  ['Pinsel', 'Maler', ['Koch','Lehrer','Bäcker'], 'Streicht Farbe auf Wände.'],
  ['Tafel', 'Lehrer', ['Bauer','Bäcker','Polizist'], 'Steht im Klassenzimmer.'],
  ['Kochlöffel', 'Koch', ['Maler','Friseur','Lehrer'], 'Rührt damit im Topf.'],
  ['Hammer', 'Schreiner', ['Bäcker','Arzt','Friseur'], 'Schlägt Nägel ein.'],
  ['Trecker', 'Bauer', ['Polizist','Arzt','Maler'], 'Pflügt das Feld.'],
  ['Polizeikelle', 'Polizist', ['Bäcker','Arzt','Lehrer'], 'Regelt den Verkehr.'],
  ['Feuerwehrschlauch', 'Feuerwehrmann', ['Lehrer','Koch','Maler'], 'Löscht damit Brände.'],
  ['Briefe', 'Briefträger', ['Koch','Maler','Bauer'], 'Bringt Post ins Haus.'],
  ['Garten', 'Gärtner', ['Bäcker','Lehrer','Arzt'], 'Pflegt Pflanzen und Beete.'],
  ['Auto reparieren', 'Mechaniker', ['Friseur','Lehrer','Koch'], 'Schraubt am Motor.'],
  ['Notenblatt', 'Musiker', ['Bauer','Polizist','Bäcker'], 'Spielt Instrumente.'],
  ['Hammer und Meißel', 'Bildhauer', ['Bäcker','Lehrer','Bauer'], 'Macht Skulpturen aus Stein.'],
  ['Zementmischer', 'Maurer', ['Friseur','Arzt','Lehrer'], 'Baut Häuser aus Steinen.'],
  ['Kelle', 'Maurer', ['Friseur','Arzt','Lehrer'], 'Verteilt damit Mörtel.'],
  ['Schiff', 'Kapitän', ['Bauer','Lehrer','Maler'], 'Steuert auf dem Meer.'],
  ['Flugzeug', 'Pilot', ['Friseur','Bäcker','Bauer'], 'Fliegt durch die Luft.'],
  ['Fußball', 'Fußballspieler', ['Lehrer','Maler','Friseur'], 'Trägt Fußballschuhe.'],
  ['Stoffe und Nadel', 'Schneider', ['Bäcker','Bauer','Polizist'], 'Macht maßgefertigte Kleidung.'],
  ['Brille zum Augenarzt', 'Optiker', ['Friseur','Bäcker','Polizist'], 'Verkauft Brillen.'],
  ['Pinzette und Wattestäbchen', 'Kosmetikerin', ['Lehrer','Polizist','Bauer'], 'Pflegt das Gesicht.'],
  ['Zahnbohrer', 'Zahnarzt', ['Friseur','Bäcker','Mechaniker'], 'Bohrt schmerzhaft im Mund.'],
  ['Spritze und Wattepad', 'Krankenschwester', ['Friseur','Bäcker','Bauer'], 'Pflegt Patienten im Krankenhaus.'],
  ['Babywiege', 'Hebamme', ['Maler','Bauer','Bäcker'], 'Begleitet bei der Geburt.'],
  ['Hammer und Säge', 'Tischler', ['Bäcker','Friseur','Arzt'], 'Macht Möbel aus Holz.'],
  ['Bierfass', 'Wirt', ['Bauer','Bäcker','Maler'], 'Schenkt Getränke aus.'],
  ['Mikroskop', 'Wissenschaftler', ['Bauer','Bäcker','Friseur'], 'Forscht im Labor.'],
  ['Kostüm und Maske', 'Schauspieler', ['Bauer','Maler','Bäcker'], 'Spielt Rollen auf der Bühne.'],
  ['Notenständer', 'Dirigent', ['Bauer','Maler','Polizist'], 'Leitet das Orchester mit dem Stab.'],
  ['Bibel und Kanzel', 'Pfarrer', ['Bauer','Lehrer','Bäcker'], 'Predigt in der Kirche.'],
  ['Camera und Stativ', 'Fotograf', ['Bauer','Friseur','Bäcker'], 'Macht Bilder zum Andenken.'],
  ['Lkw-Lenkrad', 'Lkw-Fahrer', ['Bauer','Friseur','Bäcker'], 'Fährt schwere Fracht über die Autobahn.'],
  ['Sense und Pflug', 'Bauer', ['Friseur','Bäcker','Lehrer'], 'Bestellt Felder und Wiesen.'],
  ['Mehl und Hefe', 'Bäcker', ['Friseur','Bauer','Lehrer'], 'Bäckt Brot und Brötchen.'],
  ['Tablett und Notizblock', 'Kellner', ['Bauer','Bäcker','Friseur'], 'Bringt Essen an den Tisch.'],
  ['Computer und Tastatur', 'Programmierer', ['Bauer','Bäcker','Friseur'], 'Schreibt Code für Software.'],
  ['Putzlappen und Eimer', 'Reinigungskraft', ['Bauer','Bäcker','Friseur'], 'Hält Räume sauber.'],
  ['Stempel', 'Beamter', ['Bauer','Bäcker','Friseur'], 'Arbeitet im Amt mit Akten.'],
  ['Akte und Robe', 'Richter', ['Bäcker','Bauer','Friseur'], 'Spricht das Urteil im Gericht.'],
  ['Fingerabdruck und Lupe', 'Detektiv', ['Bauer','Bäcker','Friseur'], 'Sucht nach Spuren.'],
  ['Mikrofon vor der Kamera', 'Journalist', ['Bauer','Bäcker','Friseur'], 'Berichtet aktuelle Nachrichten.'],
  ['Steuererklärung', 'Steuerberater', ['Bauer','Friseur','Bäcker'], 'Hilft beim Ausfüllen der Steuer.'],
  ['Verträge und Akten', 'Rechtsanwalt', ['Bauer','Bäcker','Friseur'], 'Vertritt vor Gericht.'],
  ['Telefonzentrale', 'Telefonist', ['Bauer','Bäcker','Maler'], 'Verbindet Anrufe.'],
  ['Schaufel und Sense', 'Landwirt', ['Friseur','Bäcker','Maler'], 'Bewirtschaftet das Feld.'],
  ['Bohnen und Topf', 'Koch', ['Maler','Bauer','Lehrer'], 'Bereitet das Essen zu.'],
  ['Spaten und Schubkarre', 'Friedhofsgärtner', ['Bäcker','Polizist','Schreiner'], 'Pflegt Gräber.'],
  ['Tonband und Mikrofon', 'Tontechniker', ['Maler','Bäcker','Friseur'], 'Sorgt für guten Klang.'],
  ['Computer und Code', 'Softwareentwickler', ['Bauer','Bäcker','Friseur'], 'Schreibt Programme.'],
  ['Schweißbrenner', 'Schweißer', ['Bauer','Bäcker','Lehrer'], 'Verbindet Metallteile.'],
  ['Sägewerk', 'Sägewerker', ['Friseur','Bäcker','Bauer'], 'Verarbeitet Baumstämme zu Brettern.'],
  ['Backstein', 'Maurer', ['Friseur','Arzt','Lehrer'], 'Mauert Wände hoch.'],
  ['Pflaster und Spachtel', 'Stuckateur', ['Bauer','Bäcker','Maler'], 'Verputzt Wände im Innenraum.'],
  ['Klebstoff und Tapete', 'Tapezierer', ['Bauer','Bäcker','Friseur'], 'Klebt Wandtapete.'],
  ['Schlüsselrohling', 'Schlüsseldienst', ['Bauer','Bäcker','Maler'], 'Macht Schlüssel nach.'],
  ['Werkzeugkasten', 'Klempner', ['Lehrer','Bäcker','Bauer'], 'Repariert verstopfte Rohre.'],
  ['Knete und Drehrad', 'Töpfer', ['Bauer','Bäcker','Friseur'], 'Macht Vasen aus Ton.'],
  ['Goldwaage', 'Juwelier', ['Bauer','Bäcker','Friseur'], 'Verkauft edlen Schmuck.'],
  ['Hund und Schafherde', 'Schäfer', ['Bäcker','Maler','Lehrer'], 'Hütet die Schafe.'],
  ['Bienenstock und Schleuder', 'Imker', ['Bauer','Bäcker','Friseur'], 'Pflegt Bienen und erntet Honig.'],
  ['Tankwagen', 'Tankwart', ['Bauer','Bäcker','Friseur'], 'Verkauft Benzin und Diesel.'],
  ['Mistgabel', 'Stallbursche', ['Friseur','Bäcker','Lehrer'], 'Säubert die Tierställe.'],
  ['Vergrößerungsglas', 'Lupenforscher', ['Bauer','Friseur','Bäcker'], 'Untersucht Kleinstes.'],
  ['Wage und Tüten', 'Verkäufer', ['Bauer','Lehrer','Friseur'], 'Wiegt und packt im Geschäft.'],
  ['Roboter im Werk', 'Mechatroniker', ['Bauer','Bäcker','Friseur'], 'Wartet Industrieanlagen.'],
  ['Notenblatt', 'Komponist', ['Bauer','Bäcker','Friseur'], 'Schreibt Musik.'],
  ['Tinte und Feder', 'Schriftsteller', ['Bauer','Bäcker','Friseur'], 'Verfasst Romane.'],
  ['Pinsel und Staffelei', 'Künstler', ['Bauer','Bäcker','Friseur'], 'Malt Bilder.'],
  ['Stoff und Bügeleisen', 'Schneider', ['Bauer','Friseur','Bäcker'], 'Näht Anzüge nach Maß.'],
  ['Pinnwand und Hammer', 'Hausmeister', ['Bauer','Friseur','Bäcker'], 'Kümmert sich um das Schulhaus.'],
  ['Tier-OP-Tisch', 'Tierarzt', ['Bauer','Bäcker','Friseur'], 'Behandelt kranke Hunde und Katzen.'],
  ['Brille und Augenklappe', 'Augenarzt', ['Bauer','Bäcker','Friseur'], 'Misst die Sehkraft.'],
  ['Krankenwagen', 'Sanitäter', ['Bauer','Bäcker','Friseur'], 'Hilft bei Notfällen schnell.'],
  ['Zollkontrolle', 'Zollbeamter', ['Bauer','Bäcker','Friseur'], 'Untersucht Reisegepäck.'],
  ['Buschmesser', 'Förster', ['Bauer','Bäcker','Friseur'], 'Geht durch den Wald, schaut nach Bäumen.'],
  ['Kletterausrüstung', 'Bergführer', ['Bauer','Bäcker','Friseur'], 'Begleitet beim Bergsteigen.'],
  ['Skiausrüstung', 'Skilehrer', ['Bauer','Bäcker','Friseur'], 'Bringt Anfängern das Skifahren bei.'],
  ['Kompass und Karte', 'Kartograph', ['Bauer','Bäcker','Friseur'], 'Zeichnet Landkarten.'],
  ['Forschungsmikroskop', 'Biologe', ['Bauer','Bäcker','Friseur'], 'Studiert Pflanzen und Tiere.'],
  ['Zollstock', 'Vermesser', ['Bauer','Bäcker','Friseur'], 'Misst Grundstücke aus.'],
  ['Schubkarre und Mörtel', 'Maurer', ['Bauer','Friseur','Bäcker'], 'Baut Wände.'],
  ['Übersetzungswörterbuch', 'Übersetzer', ['Bauer','Bäcker','Friseur'], 'Wandelt Sprachen ineinander um.'],
  ['Steuerakte', 'Buchhalter', ['Bauer','Bäcker','Friseur'], 'Führt die Bücher der Firma.'],
  ['Funkgerät', 'Polizist', ['Bauer','Bäcker','Friseur'], 'Trägt Uniform und sorgt für Ordnung.'],
  ['Mörtelkübel', 'Putzer', ['Bauer','Bäcker','Friseur'], 'Verputzt Hauswände.'],
  ['Spritzpistole', 'Lackierer', ['Bauer','Bäcker','Friseur'], 'Lackiert Autos und Möbel.'],
  ['Korkenzieher und Glas', 'Sommelier', ['Bauer','Bäcker','Friseur'], 'Berät bei der Weinwahl im Restaurant.'],
  ['Telefonbuch und Anschlussdose', 'Elektriker', ['Bauer','Bäcker','Friseur'], 'Verlegt Stromleitungen.'],
  ['Mehl und Backofen', 'Konditor', ['Bauer','Friseur','Lehrer'], 'Macht feine Torten und Pralinen.'],
  ['Vergaser und Schraubenschlüssel', 'Automechaniker', ['Bauer','Bäcker','Friseur'], 'Repariert kaputte Autos.'],
  ['Pfeife und Sportplatz', 'Schiedsrichter', ['Bauer','Bäcker','Friseur'], 'Pfeift bei Foulspiel.'],
  ['Trillerpfeife und Kelle', 'Verkehrspolizist', ['Bauer','Bäcker','Friseur'], 'Regelt den Verkehr im Berufsverkehr.'],
  ['Wagenheber', 'Reifenwechsler', ['Bauer','Bäcker','Friseur'], 'Wechselt im Herbst die Sommerreifen.'],
  ['Stoppuhr', 'Trainer', ['Bauer','Bäcker','Friseur'], 'Coacht Sportler.'],
  ['Trekkingstöcke', 'Wanderführer', ['Bauer','Bäcker','Friseur'], 'Begleitet auf Wanderungen.'],
  ['Pinsel und Farbeimer', 'Anstreicher', ['Bauer','Bäcker','Friseur'], 'Streicht Wände innen oder außen.'],
];

// === HOMONYME (Doppeldeutige Wörter) ===
// Format: { word, hint1, hint2, distract: [3 falsche Lösungen], explanation }
// Frage: "Welches Wort hat diese beiden Bedeutungen: 1) X, 2) Y?"
const POOL_HOMONYMS = [
  { word: 'Hahn', hint1: 'Männliches Huhn', hint2: 'Bauteil zur Wasserregelung',
    distract: ['Vogel','Schraube','Rohr'], explanation: 'Das Tier kräht, der Wasserhahn liefert Wasser.' },
  { word: 'Bank', hint1: 'Sitzgelegenheit im Park', hint2: 'Geldinstitut',
    distract: ['Stuhl','Sparkasse','Kasse'], explanation: 'Auf der Parkbank sitzt man, bei der Bank holt man Geld.' },
  { word: 'Maus', hint1: 'Kleines Nagetier', hint2: 'Eingabegerät am Computer',
    distract: ['Ratte','Tastatur','Bildschirm'], explanation: 'Lebendiges Tier oder Computer-Zubehör.' },
  { word: 'Schloss', hint1: 'Großes herrschaftliches Gebäude', hint2: 'Vorrichtung an Türen',
    distract: ['Burg','Schlüssel','Riegel'], explanation: 'In dem einen wohnt der König, das andere hält die Tür zu.' },
  { word: 'Birne', hint1: 'Süße Frucht am Baum', hint2: 'Lichtquelle in der Lampe',
    distract: ['Apfel','Glühlampe','Leuchte'], explanation: 'Obst oder Glühbirne.' },
  { word: 'Kiefer', hint1: 'Nadelbaum im Wald', hint2: 'Knochen im Gesicht',
    distract: ['Tanne','Zahn','Kinn'], explanation: 'Baumart oder Teil des Schädels.' },
  { word: 'Blatt', hint1: 'Wächst am Baum', hint2: 'Stück Papier',
    distract: ['Frucht','Buch','Heft'], explanation: 'Pflanzenteil oder Papierseite.' },
  { word: 'Zug', hint1: 'Fortbewegungsmittel auf Schienen', hint2: 'Bewegung beim Schach',
    distract: ['Bus','Sprung','Wurf'], explanation: 'Bahnreise oder Spielzug.' },
  { word: 'Strom', hint1: 'Großer Fluss', hint2: 'Elektrische Energie',
    distract: ['Bach','Spannung','Licht'], explanation: 'Wasserlauf oder elektrischer Strom.' },
  { word: 'Schlange', hint1: 'Reptil ohne Beine', hint2: 'Lange Reihe wartender Menschen',
    distract: ['Echse','Reihe','Linie'], explanation: 'Tier oder wartende Menschenmenge.' },
  { word: 'Note', hint1: 'Schulische Bewertung', hint2: 'Musikalisches Zeichen',
    distract: ['Punkt','Klang','Ton'], explanation: 'Zensur oder Musikzeichen.' },
  { word: 'Flügel', hint1: 'Tragfläche eines Vogels', hint2: 'Großes Klavier',
    distract: ['Schwinge','Klavier','Pedal'], explanation: 'Vogelteil oder Tasteninstrument.' },
  { word: 'Decke', hint1: 'Schlafdecke aus Stoff', hint2: 'Obere Begrenzung des Raumes',
    distract: ['Kissen','Wand','Boden'], explanation: 'Bettzeug oder Zimmerdecke.' },
  { word: 'Kran', hint1: 'Großer Vogel mit langen Beinen', hint2: 'Maschine zum Heben von Lasten',
    distract: ['Storch','Bagger','Hebel'], explanation: 'Tier oder Baustellengerät.' },
  { word: 'Bock', hint1: 'Männliche Ziege', hint2: 'Lust auf etwas haben',
    distract: ['Schaf','Wille','Spaß'], explanation: 'Tier oder umgangssprachlich „Lust".' },
  { word: 'Brücke', hint1: 'Bauwerk über Wasser', hint2: 'Gymnastische Übung',
    distract: ['Tunnel','Sprung','Salto'], explanation: 'Übergang oder Turnübung.' },
  { word: 'Tor', hint1: 'Großer Eingang', hint2: 'Punktgewinn beim Fußball',
    distract: ['Pforte','Treffer','Punkt'], explanation: 'Eingang oder Treffer.' },
  { word: 'Mutter', hint1: 'Weibliches Elternteil', hint2: 'Zu einer Schraube gehörendes Teil',
    distract: ['Vater','Schraube','Bolzen'], explanation: 'Person oder Maschinenteil.' },
  { word: 'Kamm', hint1: 'Werkzeug zum Haare ordnen', hint2: 'Gebirgs-Höhenzug',
    distract: ['Bürste','Berg','Hügel'], explanation: 'Frisierhilfe oder Berghöhenzug.' },
  { word: 'Star', hint1: 'Kleiner Singvogel', hint2: 'Berühmte Persönlichkeit',
    distract: ['Krähe','Berühmtheit','Ruhm'], explanation: 'Vogelart oder Berühmtheit.' },
  { word: 'Bauer', hint1: 'Landwirt auf dem Hof', hint2: 'Käfig für Vögel',
    distract: ['Müller','Käfig','Gehege'], explanation: 'Beruf oder Vogelkäfig.' },
  { word: 'Pony', hint1: 'Kleines Pferd', hint2: 'Frisur mit Stirnhaaren',
    distract: ['Esel','Locke','Zopf'], explanation: 'Pferderasse oder Haarschnitt.' },
  { word: 'Kiwi', hint1: 'Grüne haarige Frucht', hint2: 'Vogelart aus Neuseeland',
    distract: ['Mango','Strauß','Emu'], explanation: 'Frucht oder Vogel.' },
  { word: 'Linse', hint1: 'Hülsenfrucht zum Kochen', hint2: 'Optisches Glas in der Brille',
    distract: ['Erbse','Glas','Spiegel'], explanation: 'Lebensmittel oder Bauteil von Brillen und Kameras.' },
  { word: 'Zelle', hint1: 'Kleinster Baustein des Lebens', hint2: 'Raum im Gefängnis',
    distract: ['Atom','Käfig','Raum'], explanation: 'Biologischer Baustein oder Haftraum.' },
  { word: 'Kanal', hint1: 'Künstliche Wasserstraße', hint2: 'Sender im Fernsehen',
    distract: ['Fluss','Programm','Sender'], explanation: 'Wasserweg oder TV-Programm.' },
  { word: 'Kunde', hint1: 'Person, die etwas kauft', hint2: 'Wissen über etwas (z.B. Tierkunde)',
    distract: ['Käufer','Wissen','Lehre'], explanation: 'Käufer oder „-kunde" wie in Heimatkunde.' },
  { word: 'Schimmel', hint1: 'Weißes Pferd', hint2: 'Pilzbefall an alten Lebensmitteln',
    distract: ['Pony','Pilz','Belag'], explanation: 'Pferderasse oder Pilz.' },
  { word: 'Steuer', hint1: 'Lenkrad eines Autos', hint2: 'Geldbetrag an den Staat',
    distract: ['Volant','Abgabe','Lenkung'], explanation: 'Lenkvorrichtung oder Abgabe.' },
  { word: 'Erde', hint1: 'Unser Planet', hint2: 'Bodenmaterial im Garten',
    distract: ['Welt','Sand','Lehm'], explanation: 'Himmelskörper oder Pflanzboden.' },
  { word: 'Brille', hint1: 'Sehhilfe für die Augen', hint2: 'Vorsatz auf der Toilette',
    distract: ['Lupe','Sitz','Deckel'], explanation: 'Augenhilfe oder WC-Brille.' },
  { word: 'Pferdeschwanz', hint1: 'Frisur mit zusammengebundenen Haaren', hint2: 'Körperteil eines Pferdes',
    distract: ['Zopf','Mähne','Locke'], explanation: 'Frisur oder Schwanz vom Pferd.' },
  { word: 'Schimmer', hint1: 'Schwacher Lichtschein', hint2: 'Geringes Wissen über etwas',
    distract: ['Glanz','Ahnung','Spur'], explanation: 'Lichtschein oder „keinen Schimmer haben".' },
  { word: 'Hut', hint1: 'Kopfbedeckung', hint2: 'Aufsicht oder Schutz (auf der Hut sein)',
    distract: ['Mütze','Vorsicht','Schutz'], explanation: 'Kleidungsstück oder Achtsamkeit.' },
  { word: 'Pol', hint1: 'Nördlicher oder südlicher Erdpunkt', hint2: 'Anschluss an einer Batterie',
    distract: ['Achse','Kontakt','Stecker'], explanation: 'Erdpunkt oder Stromanschluss.' },
  { word: 'Reif', hint1: 'Schmuckring am Finger', hint2: 'Eiskristall-Belag im Winter',
    distract: ['Ring','Eis','Frost'], explanation: 'Schmuck oder Frostbelag.' },
  { word: 'Schauer', hint1: 'Kurzer Regenfall', hint2: 'Gefühl, das einem über den Rücken läuft',
    distract: ['Regen','Angst','Gänsehaut'], explanation: 'Kurzer Regen oder Gruseln.' },
  { word: 'Mandel', hint1: 'Nuss zum Backen', hint2: 'Lymphdrüse im Hals',
    distract: ['Nuss','Drüse','Knoten'], explanation: 'Nussart oder Halsmandel.' },
  { word: 'Krone', hint1: 'Kopfschmuck eines Königs', hint2: 'Oberer Teil eines Zahnes',
    distract: ['Reif','Zahn','Spitze'], explanation: 'Königsschmuck oder Zahnteil.' },
  { word: 'Ente', hint1: 'Wasservogel', hint2: 'Falsche Zeitungsnachricht',
    distract: ['Gans','Lüge','Bericht'], explanation: 'Vogel oder Falschmeldung.' },
  { word: 'Birke', hint1: 'Baum mit weißer Rinde', hint2: 'Sportgerät zum Schlagen (alt)',
    distract: ['Eiche','Stock','Rute'], explanation: 'Baumart oder Rute (veraltet).' },
  { word: 'Ball', hint1: 'Rundes Spielzeug', hint2: 'Festliche Tanzveranstaltung',
    distract: ['Kugel','Fest','Feier'], explanation: 'Sport oder Tanzfest.' },
  { word: 'Fliege', hint1: 'Lästiges Insekt', hint2: 'Schleife am Hemd statt Krawatte',
    distract: ['Mücke','Schleife','Knoten'], explanation: 'Insekt oder Halsschmuck.' },
  { word: 'Hering', hint1: 'Salzwasser-Fisch', hint2: 'Stab zum Befestigen eines Zelts',
    distract: ['Lachs','Stab','Pflock'], explanation: 'Fisch oder Zeltstange.' },
  { word: 'Pflaster', hint1: 'Wundverband', hint2: 'Belag auf Straßen und Wegen',
    distract: ['Verband','Asphalt','Stein'], explanation: 'Verband oder Straßenbelag.' },
  { word: 'Esel', hint1: 'Tier mit langen Ohren', hint2: 'Hilfsmittel zum Merken (Eselsbrücke)',
    distract: ['Pferd','Trick','Tipp'], explanation: 'Tier oder „Eselsbrücke".' },
  { word: 'Adler', hint1: 'Großer Greifvogel', hint2: 'Wappen-Symbol Deutschlands',
    distract: ['Falke','Wappen','Logo'], explanation: 'Vogel oder Wappentier.' },
  { word: 'Rad', hint1: 'Teil von Auto und Fahrrad', hint2: 'Kunststück beim Turnen',
    distract: ['Reifen','Salto','Sprung'], explanation: 'Fahrzeugteil oder Turnübung.' },
  { word: 'Hammer', hint1: 'Werkzeug zum Schlagen', hint2: 'Etwas Großartiges (umgangssprachlich)',
    distract: ['Beil','Wahnsinn','Klasse'], explanation: 'Werkzeug oder „Das ist der Hammer!".' },
  { word: 'Spitze', hint1: 'Vorderes Ende einer Nadel', hint2: 'Feine geklöppelte Stoffverzierung',
    distract: ['Punkt','Stoff','Borde'], explanation: 'Nadelende oder Stoffart.' },
  { word: 'Karte', hint1: 'Stück Papier zum Verschicken', hint2: 'Zum Spielen mit 52 Stück',
    distract: ['Brief','Spiel','Deck'], explanation: 'Postkarte oder Spielkarte.' },
  { word: 'Stollen', hint1: 'Weihnachtskuchen aus Dresden', hint2: 'Bergwerk-Tunnel',
    distract: ['Plätzchen','Tunnel','Schacht'], explanation: 'Kuchen oder Bergwerk.' },
  { word: 'Gericht', hint1: 'Zubereitete Mahlzeit', hint2: 'Ort, an dem Recht gesprochen wird',
    distract: ['Essen','Gesetz','Urteil'], explanation: 'Speise oder Gerichtshof.' },
  { word: 'Schnecke', hint1: 'Tier mit Haus auf dem Rücken', hint2: 'Süßes Hefegebäck',
    distract: ['Wurm','Brötchen','Kuchen'], explanation: 'Tier oder Gebäckart.' },
  { word: 'Ohr', hint1: 'Hörorgan am Kopf', hint2: 'Loch in der Nadel zum Einfädeln',
    distract: ['Mund','Loch','Öse'], explanation: 'Sinnesorgan oder Nadelöhr.' },
  { word: 'Wolf', hint1: 'Wildtier, Vorfahre vom Hund', hint2: 'Maschine zum Zerkleinern von Fleisch',
    distract: ['Hund','Mühle','Mixer'], explanation: 'Tier oder Fleischwolf.' },
  { word: 'Lauf', hint1: 'Sportliche Strecke beim Joggen', hint2: 'Vorderer Teil eines Gewehrs',
    distract: ['Sprint','Rohr','Spitze'], explanation: 'Joggen oder Gewehrteil.' },
  { word: 'Rolle', hint1: 'Teil im Bürostuhl, dreht sich', hint2: 'Aufgabe in einem Theaterstück',
    distract: ['Rad','Spiel','Aufgabe'], explanation: 'Mechanisches Teil oder Schauspiel-Part.' },
  { word: 'Strauß', hint1: 'Bündel Blumen', hint2: 'Großer flugunfähiger Vogel',
    distract: ['Bouquet','Storch','Adler'], explanation: 'Blumengeschenk oder afrikanischer Vogel.' },
  { word: 'Birne', hint1: 'Süße Frucht am Baum', hint2: 'Lichtquelle in der Lampe',
    distract: ['Apfel','Glühlampe','Leuchte'], explanation: 'Obst oder Glühbirne.' },
  { word: 'Decke', hint1: 'Wärmt einen im Bett', hint2: 'Obere Begrenzung des Zimmers',
    distract: ['Kissen','Wand','Boden'], explanation: 'Bettzeug oder Zimmerdecke.' },
  { word: 'Aufzug', hint1: 'Fährt nach oben in einem Hochhaus', hint2: 'Festliche Kleidung',
    distract: ['Treppe','Outfit','Lift'], explanation: 'Lift oder Garderobe.' },
  { word: 'Absatz', hint1: 'Hinterer Teil des Schuhs', hint2: 'Abschnitt im Text',
    distract: ['Sohle','Kapitel','Zeile'], explanation: 'Schuh-Teil oder Text-Abschnitt.' },
  { word: 'Bart', hint1: 'Wächst dem Mann im Gesicht', hint2: 'Gezackter Teil eines Schlüssels',
    distract: ['Locke','Haar','Kerbe'], explanation: 'Gesichtsbehaarung oder Schlüsselteil.' },
  { word: 'Brett', hint1: 'Flaches Stück Holz', hint2: 'Spielfläche bei Schach oder Mühle',
    distract: ['Balken','Tisch','Spielplatte'], explanation: 'Holzplatte oder Spielfeld.' },
  { word: 'Kreuz', hint1: 'Christliches Symbol', hint2: 'Teil des Rückens',
    distract: ['Schädel','Rücken','Hüfte'], explanation: 'Religiöses Zeichen oder Lendenbereich.' },
  { word: 'Hahn', hint1: 'Männliches Huhn', hint2: 'Bauteil zur Wasserregelung',
    distract: ['Vogel','Schraube','Rohr'], explanation: 'Tier oder Wasserhahn.' },
  { word: 'Bank', hint1: 'Sitzgelegenheit im Park', hint2: 'Wo man Geld einzahlt',
    distract: ['Stuhl','Sparkasse','Kasse'], explanation: 'Sitzgelegenheit oder Geldinstitut.' },
  { word: 'Maus', hint1: 'Kleines graues Tier', hint2: 'Eingabegerät am Computer',
    distract: ['Ratte','Tastatur','Bildschirm'], explanation: 'Tier oder Computermaus.' },
  { word: 'Schloss', hint1: 'Großes herrschaftliches Gebäude', hint2: 'Hängt am Fahrradrahmen',
    distract: ['Burg','Schlüssel','Riegel'], explanation: 'Königshaus oder Sicherung.' },
  { word: 'Floh', hint1: 'Springendes Insekt', hint2: 'Markt mit alten Sachen (Floh-…)',
    distract: ['Käfer','Bazar','Tausch'], explanation: 'Insekt oder Flohmarkt.' },
  { word: 'Trommel', hint1: 'Schlaginstrument', hint2: 'Drehende Teil der Waschmaschine',
    distract: ['Pauke','Schleuder','Walze'], explanation: 'Musikinstrument oder Maschinenteil.' },
  { word: 'Stamm', hint1: 'Hauptteil eines Baums', hint2: 'Gemeinschaft mit Häuptling',
    distract: ['Ast','Volk','Sippe'], explanation: 'Baumteil oder Volksgruppe.' },
  { word: 'Nase', hint1: 'Damit riecht man', hint2: 'Vorsprung am Schiff',
    distract: ['Mund','Bug','Schnabel'], explanation: 'Sinnesorgan oder Schiffsteil.' },
  { word: 'Glas', hint1: 'Daraus trinkt man', hint2: 'Material für Fenster',
    distract: ['Becher','Holz','Stoff'], explanation: 'Gefäß oder Material.' },
  { word: 'Glocke', hint1: 'Im Kirchturm', hint2: 'Frische Tomate (Tomaten-…)',
    distract: ['Klingel','Beere','Frucht'], explanation: 'Klangkörper oder Tomaten-Sorte.' },
  { word: 'Kohl', hint1: 'Gemüse mit dichten Blättern', hint2: 'Berühmter deutscher Bundeskanzler',
    distract: ['Salat','Schmidt','Brandt'], explanation: 'Pflanze oder Helmut Kohl.' },
  { word: 'Stern', hint1: 'Leuchtet am Nachthimmel', hint2: 'Berühmte Persönlichkeit',
    distract: ['Mond','Berühmtheit','Promi'], explanation: 'Himmelskörper oder berühmter Mensch.' },
  { word: 'Brille', hint1: 'Sehhilfe', hint2: 'Sitz auf der Toilette',
    distract: ['Lupe','Sitz','Deckel'], explanation: 'Sehhilfe oder WC-Brille.' },
  { word: 'Pony', hint1: 'Kleines Pferd', hint2: 'Frisur mit Stirnhaaren',
    distract: ['Esel','Locke','Zopf'], explanation: 'Pferdeart oder Haarschnitt.' },
  { word: 'Kiwi', hint1: 'Grüne haarige Frucht', hint2: 'Vogelart aus Neuseeland',
    distract: ['Mango','Strauß','Emu'], explanation: 'Frucht oder Vogel.' },
  { word: 'Kunde', hint1: 'Person, die etwas kauft', hint2: '„-kunde" wie in Heimatkunde',
    distract: ['Käufer','Wissen','Lehre'], explanation: 'Käufer oder Wissensgebiet.' },
  { word: 'Mole', hint1: 'Steinerner Hafenwall', hint2: 'Kleines kuscheliges Tier (Maul-…)',
    distract: ['Hafen','Kaninchen','Eule'], explanation: 'Schiffsanleger oder Maulwurf.' },
  { word: 'Reform', hint1: 'Veränderung in Politik', hint2: 'Gesundheitsbewusste Lebensmittel (-haus)',
    distract: ['Politik','Bio','Diät'], explanation: 'Veränderung oder Reformhaus.' },
  { word: 'Hieb', hint1: 'Schlag mit dem Schwert', hint2: 'Auflage einer Schallplatte (Best-of-…)',
    distract: ['Stoß','Album','Treffer'], explanation: 'Schwertschlag oder Schlager-Hit.' },
  { word: 'Lager', hint1: 'Wo Waren aufbewahrt werden', hint2: 'Gruppe von Anhängern (politisch)',
    distract: ['Halle','Partei','Gruppe'], explanation: 'Speicher oder politische Gruppierung.' },
  { word: 'Gericht', hint1: 'Zubereitete Mahlzeit', hint2: 'Ort wo Recht gesprochen wird',
    distract: ['Essen','Gesetz','Urteil'], explanation: 'Speise oder Justizgebäude.' },
  { word: 'Welle', hint1: 'Bewegte Wassermasse im Meer', hint2: 'Lockige Frisur',
    distract: ['Strömung','Locke','Brandung'], explanation: 'Wasserwelle oder Frisur.' },
  { word: 'Schach', hint1: 'Brettspiel der Könige', hint2: 'Bedrohung des gegnerischen Königs',
    distract: ['Dame','Angriff','Sieg'], explanation: 'Spiel oder Spielzustand.' },
  { word: 'Sturm', hint1: 'Heftiges Wetter', hint2: 'Angriff auf eine Burg',
    distract: ['Regen','Hieb','Schlacht'], explanation: 'Wetterereignis oder Burganfall.' },
  { word: 'Pinne', hint1: 'Hebel zum Steuern eines Bootes', hint2: 'Kleiner Nagel ohne Kopf',
    distract: ['Ruder','Stift','Bolzen'], explanation: 'Bootsteil oder Bürobedarf.' },
  { word: 'Beere', hint1: 'Kleine süße Frucht', hint2: 'Stelle auf der Sonderlandebahn',
    distract: ['Frucht','Bahn','Linie'], explanation: 'Obst oder Schiffslandeplatz.' },
  { word: 'Wirbel', hint1: 'Knochen in der Wirbelsäule', hint2: 'Aufgeregte Aufregung',
    distract: ['Rippe','Tumult','Lärm'], explanation: 'Anatomie oder Trubel.' },
  { word: 'Wäsche', hint1: 'Schmutzige Kleidung', hint2: 'Reinigungsvorgang',
    distract: ['Anzug','Spülen','Sauber'], explanation: 'Kleidung oder Tätigkeit.' },
  { word: 'Hut', hint1: 'Kopfbedeckung', hint2: 'Vorsicht („auf der Hut sein")',
    distract: ['Mütze','Vorsicht','Schutz'], explanation: 'Kleidung oder Achtsamkeit.' },
  { word: 'Hügel', hint1: 'Kleine Erhebung im Gelände', hint2: 'Stelle aus Sand am Strand',
    distract: ['Berg','Sandburg','Tal'], explanation: 'Erhebung oder Sandhaufen.' },
  { word: 'Note', hint1: 'Bewertung in der Schule', hint2: 'Musikalisches Zeichen',
    distract: ['Punkt','Klang','Ton'], explanation: 'Zensur oder Musikzeichen.' },
];

// === WORTREIHEN: Welches Wort passt nicht? ===
// Format: [Liste mit 5 Wörtern, das falsche, Hinweis]
const POOL_SEMANTIC = [
  [['Auto','Werkstatt','Bühne','Öl','Vorhang'], 'Vorhang', 'Vier Begriffe gehören zur Autowerkstatt.'],
  [['Teich','Nordsee','Fluss','Swimmingpool','Bach'], 'Swimmingpool', 'Vier sind natürliche Gewässer.'],
  [['Auto','Fahrrad','Motorrad','Schiff','Roller'], 'Schiff', 'Vier fahren auf der Straße.'],
  [['Eiche','Birke','Tanne','Rose','Buche'], 'Rose', 'Vier sind Bäume, eines ist eine Blume.'],
  [['Hammer','Säge','Schraubenzieher','Brot','Zange'], 'Brot', 'Vier sind Werkzeuge.'],
  [['Apfel','Birne','Zwiebel','Pfirsich','Pflaume'], 'Zwiebel', 'Vier sind Obstsorten.'],
  [['Klavier','Geige','Trompete','Tasse','Flöte'], 'Tasse', 'Vier sind Musikinstrumente.'],
  [['Berlin','Hamburg','München','Paris','Köln'], 'Paris', 'Vier sind deutsche Städte.'],
  [['Hund','Katze','Schaf','Tisch','Pferd'], 'Tisch', 'Vier sind Tiere.'],
  [['rot','blau','grün','laut','gelb'], 'laut', 'Vier sind Farben.'],
  [['Januar','März','Sommer','Mai','Juli'], 'Sommer', 'Vier sind Monate.'],
  [['Montag','Dienstag','Woche','Freitag','Sonntag'], 'Woche', 'Vier sind Wochentage.'],
  [['Brief','Brötchen','Brot','Brezel','Kuchen'], 'Brief', 'Vier sind Backwaren.'],
  [['Stuhl','Tisch','Bett','Mantel','Sofa'], 'Mantel', 'Vier sind Möbel.'],
  [['Adler','Spatz','Storch','Hai','Möwe'], 'Hai', 'Vier sind Vögel.'],
  [['Auge','Ohr','Nase','Mund','Buch'], 'Buch', 'Vier sind Sinnesorgane oder Gesichtsteile.'],
  [['Niere','Leber','Lunge','Stein','Herz'], 'Stein', 'Vier sind innere Organe.'],
  [['Donau','Rhein','Elbe','Bodensee','Main'], 'Bodensee', 'Vier sind Flüsse, einer ein See.'],
  [['Goethe','Schiller','Mozart','Kafka','Brecht'], 'Mozart', 'Vier sind Schriftsteller.'],
  [['Beethoven','Bach','Mozart','Picasso','Schubert'], 'Picasso', 'Vier sind Komponisten.'],
  [['Frühling','Sommer','Februar','Herbst','Winter'], 'Februar', 'Vier sind Jahreszeiten.'],
  [['Gabel','Messer','Löffel','Hammer','Teller'], 'Hammer', 'Vier gehören zum Esstisch.'],
  [['Wiese','Wald','Acker','Meer','Berg'], 'Meer', 'Vier sind Landschaften, eines Wasser.'],
  [['Fußball','Tennis','Boxen','Schach','Eishockey'], 'Schach', 'Vier sind körperliche Sportarten.'],
  [['Pflaume','Kirsche','Erdbeere','Aprikose','Pfirsich'], 'Erdbeere', 'Vier haben einen Stein im Inneren.'],
  [['Knie','Ellbogen','Schulter','Stirn','Hüfte'], 'Stirn', 'Vier sind Gelenke.'],
  [['Tasse','Glas','Becher','Teller','Krug'], 'Teller', 'Vier sind Trinkgefäße.'],
  [['Hose','Mantel','Hemd','Schuh','Pullover'], 'Schuh', 'Vier sind Kleidungsstücke für den Oberkörper oder die Beine.'],
  [['Sonne','Mond','Stern','Wolke','Komet'], 'Wolke', 'Vier sind Himmelskörper.'],
  [['Kuchen','Torte','Plätzchen','Brot','Keks'], 'Brot', 'Vier sind Süßspeisen, eines herzhaft.'],
  [['Lehrer','Schüler','Direktor','Bauer','Sekretärin'], 'Bauer', 'Vier arbeiten in der Schule.'],
  [['Geige','Cello','Harfe','Trommel','Bratsche'], 'Trommel', 'Vier sind Streichinstrumente.'],
  [['Nordsee','Ostsee','Mittelmeer','Bodensee','Atlantik'], 'Bodensee', 'Vier sind Meere.'],
  [['Auge','Ohr','Mund','Hand','Nase'], 'Hand', 'Vier sind Sinnesorgane im Gesicht.'],
  [['Sommer','Herbst','Winter','Januar','Frühling'], 'Januar', 'Vier sind Jahreszeiten.'],
  [['Wolf','Bär','Reh','Hund','Wildschwein'], 'Hund', 'Vier sind Wildtiere.'],
  [['Kette','Ring','Armband','Krone','Uhr'], 'Krone', 'Vier sind Schmuckstücke, das andere königlich.'],
  [['Pinsel','Farbe','Hammer','Leinwand','Palette'], 'Hammer', 'Vier braucht ein Maler.'],
  [['Apfel','Birne','Kirsche','Karotte','Pflaume'], 'Karotte', 'Vier wachsen am Baum.'],
  [['Liebe','Hass','Freude','Trauer','Stuhl'], 'Stuhl', 'Vier sind Gefühle.'],
  [['Norden','Süden','Osten','Westen','Mitte'], 'Mitte', 'Vier sind Himmelsrichtungen.'],
  [['Gabel','Messer','Löffel','Schere','Teelöffel'], 'Schere', 'Vier sind Essbesteck.'],
  [['Klavier','Trompete','Geige','Tisch','Flöte'], 'Tisch', 'Vier sind Musikinstrumente.'],
  [['Sand','Stein','Wasser','Kies','Erde'], 'Wasser', 'Vier sind feste Bodenarten.'],
  [['Mai','Juni','Juli','Mittwoch','August'], 'Mittwoch', 'Vier sind Monate.'],
  [['Sofa','Sessel','Stuhl','Kühlschrank','Hocker'], 'Kühlschrank', 'Vier sind Sitzmöbel.'],
  [['Hund','Katze','Hamster','Pferd','Kanarienvogel'], 'Pferd', 'Vier passen in eine Stadtwohnung.'],
  [['Gold','Silber','Bronze','Wasser','Kupfer'], 'Wasser', 'Vier sind Metalle.'],
  [['Schach','Dame','Mühle','Skat','Halma'], 'Skat', 'Vier sind Brettspiele.'],
  [['Hut','Mütze','Kappe','Mantel','Helm'], 'Mantel', 'Vier sind Kopfbedeckungen.'],
  [['Eichhörnchen','Maus','Reh','Pudel','Hase'], 'Pudel', 'Vier sind Wildtiere.'],
  [['Apfelsaft','Wein','Bier','Wasser','Stein'], 'Stein', 'Vier sind Getränke.'],
  [['Hand','Knie','Fuß','Arm','Auge'], 'Auge', 'Vier sind Gliedmaßen oder Gelenke.'],
  [['Maler','Schreiner','Schmied','Bäcker','Buch'], 'Buch', 'Vier sind Berufe.'],
  [['Pinsel','Hammer','Säge','Apfel','Schraubendreher'], 'Apfel', 'Vier sind Werkzeuge.'],
  [['Mond','Sonne','Stern','Wolke','Komet'], 'Wolke', 'Vier sind Himmelskörper.'],
  [['Goethe','Schiller','Mozart','Heine','Hesse'], 'Mozart', 'Vier sind Schriftsteller.'],
  [['Picasso','van Gogh','Mozart','Monet','Rembrandt'], 'Mozart', 'Vier sind Maler.'],
  [['Krähe','Spatz','Adler','Forelle','Eule'], 'Forelle', 'Vier sind Vögel, eines ein Fisch.'],
  [['Hering','Lachs','Forelle','Adler','Karpfen'], 'Adler', 'Vier sind Fische.'],
  [['Rose','Tulpe','Nelke','Tomate','Lilie'], 'Tomate', 'Vier sind Blumen, eines Gemüse.'],
  [['Apfel','Birne','Kirsche','Karotte','Pflaume'], 'Karotte', 'Vier wachsen am Baum.'],
  [['Stuhl','Tisch','Schrank','Kühlschrank','Bett'], 'Kühlschrank', 'Vier sind klassische Möbel.'],
  [['rot','blau','grün','rund','gelb'], 'rund', 'Vier sind Farben.'],
  [['rund','eckig','viereckig','laut','dreieckig'], 'laut', 'Vier sind Formen.'],
  [['Berlin','Hamburg','München','Paris','Köln'], 'Paris', 'Vier sind deutsche Städte.'],
  [['Sushi','Pizza','Pasta','Schraube','Salat'], 'Schraube', 'Vier sind Speisen.'],
  [['Brot','Brötchen','Brezel','Kuchen','Brief'], 'Brief', 'Vier sind Backwaren.'],
  [['Hammer','Säge','Zange','Apfel','Bohrer'], 'Apfel', 'Vier sind Werkzeuge.'],
  [['Mai','Juli','August','Mittwoch','Oktober'], 'Mittwoch', 'Vier sind Monate.'],
  [['Hund','Katze','Maus','Lampe','Pferd'], 'Lampe', 'Vier sind Tiere.'],
  [['Auge','Ohr','Nase','Hand','Mund'], 'Hand', 'Vier sind Gesichtssinne.'],
  [['Gabel','Messer','Löffel','Hammer','Teelöffel'], 'Hammer', 'Vier gehören aufs Esstisch.'],
  [['Krone','Zepter','Thron','Ring','Hammer'], 'Hammer', 'Vier symbolisieren Königswürde.'],
  [['Mantel','Hose','Hemd','Schuh','Pullover'], 'Schuh', 'Vier wärmen Oberkörper oder Beine.'],
  [['Niere','Leber','Lunge','Stein','Herz'], 'Stein', 'Vier sind innere Organe.'],
  [['Apfel','Pflaume','Pfirsich','Erdbeere','Aprikose'], 'Erdbeere', 'Vier haben einen Kern.'],
  [['Wal','Hai','Delfin','Kuh','Tintenfisch'], 'Kuh', 'Vier leben im Meer.'],
  [['Berlin','Hamburg','München','Bayern','Köln'], 'Bayern', 'Vier sind Städte, eines ein Bundesland.'],
  [['Vater','Mutter','Bruder','Lehrer','Schwester'], 'Lehrer', 'Vier sind Familienmitglieder.'],
  [['Geige','Bratsche','Cello','Klavier','Kontrabass'], 'Klavier', 'Vier sind Streichinstrumente.'],
  [['Bibel','Roman','Lexikon','Heft','Schreibblock'], 'Schreibblock', 'Vier sind gebundene Bücher.'],
  [['Schraube','Nagel','Niete','Brett','Bolzen'], 'Brett', 'Vier sind Verbindungselemente.'],
  [['Säure','Salz','Pfeffer','Zucker','Curry'], 'Säure', 'Vier sind Gewürze.'],
  [['Konzert','Theater','Oper','Garten','Kino'], 'Garten', 'Vier sind Veranstaltungsorte.'],
  [['Auto','Bus','Fahrrad','Stuhl','Motorrad'], 'Stuhl', 'Vier fahren auf der Straße.'],
  [['Tanker','Yacht','Kajak','Auto','Floß'], 'Auto', 'Vier schwimmen auf dem Wasser.'],
  [['Kreide','Bleistift','Filzstift','Schere','Kuli'], 'Schere', 'Vier sind Schreibgeräte.'],
  [['Hut','Schal','Mantel','Hose','Bluse'], 'Bluse', 'Vier sind warm im Winter.'],
  [['Glück','Pech','Zufall','Schicksal','Brot'], 'Brot', 'Vier haben mit Schicksal zu tun.'],
  [['Pflicht','Auftrag','Aufgabe','Sport','Pensum'], 'Sport', 'Vier sind Verpflichtungen.'],
  [['Apotheke','Drogerie','Praxis','Markt','Klinik'], 'Markt', 'Vier sind medizinische Orte.'],
  [['Hammer','Säge','Bohrer','Brot','Zange'], 'Brot', 'Vier sind Werkzeuge.'],
  [['Mehl','Hefe','Teig','Stein','Salz'], 'Stein', 'Vier braucht man zum Brotbacken.'],
  [['Walfisch','Forelle','Hai','Karpfen','Aal'], 'Walfisch', 'Vier sind echte Fische, einer ein Säugetier.'],
  [['Bahnhof','Flughafen','Hafen','Garage','Bushaltestelle'], 'Garage', 'Vier sind Verkehrsknotenpunkte.'],
  [['Ballett','Walzer','Tango','Geige','Salsa'], 'Geige', 'Vier sind Tanzarten.'],
  [['Frühstück','Mittagessen','Kaffee','Frühaufsteher','Abendessen'], 'Frühaufsteher', 'Vier sind Mahlzeiten.'],
];

// === LÜCKENTEXTE: Sprichwort/Satz mit fehlendem Wort ===
// Format: { sentence, missing, distract: [3], hint }
const POOL_LUECKENTEXT = [
  { sentence: 'Wer im Glashaus sitzt, soll nicht mit ___ werfen.', missing: 'Steinen',
    distract: ['Bällen','Worten','Federn'], hint: 'Etwas Hartes, das man werfen kann.' },
  { sentence: 'Lügen haben kurze ___.', missing: 'Beine',
    distract: ['Arme','Wege','Wurzeln'], hint: 'Damit läuft man.' },
  { sentence: 'Hunger ist der beste ___.', missing: 'Koch',
    distract: ['Freund','Lehrer','Helfer'], hint: 'Bereitet das Essen zu.' },
  { sentence: 'Übung macht den ___.', missing: 'Meister',
    distract: ['Schüler','Lehrer','Fachmann'], hint: 'Wer etwas perfekt beherrscht.' },
  { sentence: 'Der frühe Vogel fängt den ___.', missing: 'Wurm',
    distract: ['Käfer','Fisch','Tag'], hint: 'Lebt im Erdboden.' },
  { sentence: 'Wer anderen eine ___ gräbt, fällt selbst hinein.', missing: 'Grube',
    distract: ['Treppe','Mauer','Brücke'], hint: 'Tiefes Loch im Boden.' },
  { sentence: 'Reden ist ___, Schweigen ist Gold.', missing: 'Silber',
    distract: ['Bronze','Eisen','Kupfer'], hint: 'Edelmetall, weniger wertvoll als Gold.' },
  { sentence: 'In der Kürze liegt die ___.', missing: 'Würze',
    distract: ['Wahrheit','Macht','Stärke'], hint: 'Reimt sich auf „Kürze".' },
  { sentence: 'Wer rastet, der ___.', missing: 'rostet',
    distract: ['lastet','tastet','passt'], hint: 'Wie bei altem Eisen, das nicht benutzt wird.' },
  { sentence: 'Morgenstund hat Gold im ___.', missing: 'Mund',
    distract: ['Bund','Hund','Rund'], hint: 'Damit isst und spricht man.' },
  { sentence: 'Aller Anfang ist ___.', missing: 'schwer',
    distract: ['leicht','schön','klein'], hint: 'Das Gegenteil von leicht.' },
  { sentence: 'Eile mit ___.', missing: 'Weile',
    distract: ['Würde','Eile','Sorge'], hint: 'Ein bisschen Zeit lassen.' },
  { sentence: 'Wer A sagt, muss auch ___ sagen.', missing: 'B',
    distract: ['C','D','Z'], hint: 'Der nächste Buchstabe im Alphabet.' },
  { sentence: 'Kleider machen ___.', missing: 'Leute',
    distract: ['Männer','Frauen','Kinder'], hint: 'Allgemeiner Begriff für Menschen.' },
  { sentence: 'Ein Unglück kommt selten ___.', missing: 'allein',
    distract: ['nachts','heute','spät'], hint: 'Ohne Begleitung.' },
  { sentence: 'Steter Tropfen höhlt den ___.', missing: 'Stein',
    distract: ['Berg','Sand','Holz'], hint: 'Sehr hartes Material.' },
  { sentence: 'Viele ___ verderben den Brei.', missing: 'Köche',
    distract: ['Hände','Tassen','Kellner'], hint: 'Die kochen das Essen.' },
  { sentence: 'Was du heute kannst besorgen, das verschiebe nicht auf ___.', missing: 'morgen',
    distract: ['später','übermorgen','niemals'], hint: 'Der nächste Tag.' },
  { sentence: 'Ohne Fleiß kein ___.', missing: 'Preis',
    distract: ['Geld','Lohn','Erfolg'], hint: 'Reimt sich auf „Fleiß".' },
  { sentence: 'Der Apfel fällt nicht weit vom ___.', missing: 'Stamm',
    distract: ['Baum','Ast','Boden'], hint: 'Der Hauptteil eines Baums.' },
  { sentence: 'Mit ___ und Brot wird selbst die Not zur Lust.', missing: 'Wein',
    distract: ['Bier','Saft','Tee'], hint: 'Alkoholisches Getränk aus Trauben.' },
  { sentence: 'Wer den ___ nicht ehrt, ist des Talers nicht wert.', missing: 'Pfennig',
    distract: ['Cent','Euro','Heller'], hint: 'Alte deutsche Münze, kleinster Wert.' },
  { sentence: 'Müßiggang ist aller Laster ___.', missing: 'Anfang',
    distract: ['Ende','Mitte','Wurzel'], hint: 'Wo etwas beginnt.' },
  { sentence: 'Wer sich in Gefahr begibt, kommt darin ___.', missing: 'um',
    distract: ['davon','heraus','frei'], hint: 'Stirbt darin.' },
  { sentence: 'Eine Schwalbe macht noch keinen ___.', missing: 'Sommer',
    distract: ['Winter','Frühling','Herbst'], hint: 'Die warme Jahreszeit.' },
  { sentence: 'Das Hemd ist mir näher als der ___.', missing: 'Rock',
    distract: ['Mantel','Pullover','Schal'], hint: 'Kleidungsstück, das Frauen tragen.' },
  { sentence: 'Eine Krähe hackt der anderen kein ___ aus.', missing: 'Auge',
    distract: ['Ohr','Bein','Herz'], hint: 'Damit sieht man.' },
  { sentence: 'Wenn die Katze aus dem Haus ist, tanzen die ___.', missing: 'Mäuse',
    distract: ['Ratten','Hunde','Vögel'], hint: 'Kleine Nager mit langem Schwanz.' },
  { sentence: 'Dummheit und Stolz wachsen auf einem ___.', missing: 'Holz',
    distract: ['Baum','Stamm','Brett'], hint: 'Reimt sich auf „Stolz".' },
  { sentence: 'Wer schreibt, der ___.', missing: 'bleibt',
    distract: ['liest','singt','schweigt'], hint: 'Reimt sich auf „schreibt".' },
  { sentence: 'Ein gebranntes Kind scheut das ___.', missing: 'Feuer',
    distract: ['Wasser','Licht','Gas'], hint: 'Was brennt und wärmt.' },
  { sentence: 'Aus den Augen, aus dem ___.', missing: 'Sinn',
    distract: ['Herz','Kopf','Blick'], hint: 'Wo Gedanken entstehen.' },
  { sentence: 'Wer wagt, ___.', missing: 'gewinnt',
    distract: ['verliert','wartet','denkt'], hint: 'Den Sieg holen.' },
  { sentence: 'Trau, schau, ___!', missing: 'wem',
    distract: ['was','wo','wer'], hint: 'Frage nach einer Person im Dativ.' },
  { sentence: 'Liebe geht durch den ___.', missing: 'Magen',
    distract: ['Kopf','Mund','Hals'], hint: 'Wo das Essen verdaut wird.' },
  { sentence: 'Stille Wasser sind ___.', missing: 'tief',
    distract: ['flach','klar','blau'], hint: 'Das Gegenteil von oberflächlich.' },
  { sentence: 'Vier Augen sehen mehr als ___.', missing: 'zwei',
    distract: ['drei','eins','sechs'], hint: 'Eine kleinere Zahl.' },
  { sentence: 'Wenn zwei sich streiten, freut sich der ___.', missing: 'Dritte',
    distract: ['Vierte','Erste','Zweite'], hint: 'Die Person dazwischen.' },
  { sentence: 'Wer sich verspätet, hat das ___.', missing: 'Nachsehen',
    distract: ['Vorsehen','Übersehen','Mitsehen'], hint: 'Reimt sich auf „Sehen".' },
  { sentence: 'Reden ist Silber, Schweigen ist ___.', missing: 'Gold',
    distract: ['Bronze','Eisen','Silber'], hint: 'Edelmetall, gelb.' },
  { sentence: 'Der Mensch denkt, Gott ___.', missing: 'lenkt',
    distract: ['denkt','spricht','schweigt'], hint: 'Reimt sich auf „denkt".' },
  { sentence: 'Lieber den Spatz in der Hand als die ___ auf dem Dach.', missing: 'Taube',
    distract: ['Krähe','Möwe','Eule'], hint: 'Friedensvogel.' },
  { sentence: 'Pünktlichkeit ist die Höflichkeit der ___.', missing: 'Könige',
    distract: ['Bauern','Diener','Herren'], hint: 'Das Gegenteil von Bauern.' },
  { sentence: 'Wer A sagt, muss auch ___ sagen.', missing: 'B',
    distract: ['Z','C','O'], hint: 'Zweiter Buchstabe im Alphabet.' },
  { sentence: 'Spare in der Zeit, dann hast du in der ___.', missing: 'Not',
    distract: ['Freude','Ruhe','Zeit'], hint: 'Eine schwere Lage.' },
  { sentence: 'Wer nicht hören will, muss ___.', missing: 'fühlen',
    distract: ['sehen','schmecken','riechen'], hint: 'Mit der Haut wahrnehmen.' },
  { sentence: 'Es führen viele Wege nach ___.', missing: 'Rom',
    distract: ['Paris','Berlin','Wien'], hint: 'Hauptstadt von Italien.' },
  { sentence: 'Der Wolf im ___pelz.', missing: 'Schafs',
    distract: ['Hunde','Schweine','Bären'], hint: 'Sanftes weißes Tier.' },
  { sentence: 'Die Hoffnung stirbt ___.', missing: 'zuletzt',
    distract: ['früh','schnell','langsam'], hint: 'Das Gegenteil von zuerst.' },
  { sentence: 'Aus einer Mücke einen ___ machen.', missing: 'Elefanten',
    distract: ['Berg','Wal','Bären'], hint: 'Größtes Landtier.' },
  { sentence: 'Da liegt der Hund ___.', missing: 'begraben',
    distract: ['versteckt','vergraben','geschlafen'], hint: 'Unter der Erde verborgen.' },
  { sentence: 'Den Nagel auf den ___ treffen.', missing: 'Kopf',
    distract: ['Punkt','Boden','Tisch'], hint: 'Oberster Körperteil.' },
  { sentence: 'Da haben wir den Salat — alles ist ___.', missing: 'durcheinander',
    distract: ['fertig','verloren','beendet'], hint: 'Wenn nichts an seinem Platz ist.' },
  { sentence: 'Lachen ist die beste ___.', missing: 'Medizin',
    distract: ['Therapie','Heilung','Salbe'], hint: 'Heilmittel.' },
  { sentence: 'Geld stinkt ___.', missing: 'nicht',
    distract: ['immer','nie','sehr'], hint: 'Das Gegenteil von doch.' },
  { sentence: 'Was du heute kannst besorgen, das verschiebe nicht auf ___.', missing: 'morgen',
    distract: ['gestern','heute','Sonntag'], hint: 'Der nächste Tag.' },
  { sentence: 'Übung macht den ___.', missing: 'Meister',
    distract: ['Schüler','Lehrer','Helfer'], hint: 'Wer eine Sache wirklich beherrscht.' },
  { sentence: 'Wer nicht wagt, der nicht ___.', missing: 'gewinnt',
    distract: ['arbeitet','versucht','plant'], hint: 'Den Sieg holen.' },
  { sentence: 'Die Zeit heilt alle ___.', missing: 'Wunden',
    distract: ['Sorgen','Probleme','Krankheiten'], hint: 'Verletzungen am Körper.' },
  { sentence: 'Klein, aber ___.', missing: 'fein',
    distract: ['groß','schön','schnell'], hint: 'Reimt sich auf „klein".' },
  { sentence: 'Alle guten Dinge sind ___.', missing: 'drei',
    distract: ['zwei','vier','fünf'], hint: 'Mehr als zwei, weniger als vier.' },
  { sentence: 'Klappern gehört zum ___.', missing: 'Handwerk',
    distract: ['Beruf','Kochen','Schreiben'], hint: 'Tätigkeit mit den Händen.' },
  { sentence: 'Eine Schwalbe macht noch keinen ___.', missing: 'Sommer',
    distract: ['Frühling','Winter','Herbst'], hint: 'Wärmste Jahreszeit.' },
  { sentence: 'Erst die Arbeit, dann das ___.', missing: 'Vergnügen',
    distract: ['Essen','Spielen','Schlafen'], hint: 'Spaß und Freude.' },
  { sentence: 'Reden ist Silber, ___ ist Gold.', missing: 'Schweigen',
    distract: ['Hören','Denken','Lesen'], hint: 'Nicht sprechen.' },
  { sentence: 'Andere Länder, andere ___.', missing: 'Sitten',
    distract: ['Sprachen','Menschen','Häuser'], hint: 'Bräuche und Gewohnheiten.' },
  { sentence: 'Der Apfel fällt nicht weit vom ___.', missing: 'Stamm',
    distract: ['Baum','Ast','Boden'], hint: 'Mittlerer Teil des Baumes.' },
  { sentence: 'Morgenstund hat ___ im Mund.', missing: 'Gold',
    distract: ['Silber','Honig','Brot'], hint: 'Edles, gelbes Metall.' },
  { sentence: 'Mit Speck fängt man ___.', missing: 'Mäuse',
    distract: ['Vögel','Hasen','Katzen'], hint: 'Kleine Nager mit langem Schwanz.' },
  { sentence: 'Wer einmal lügt, dem glaubt man ___.', missing: 'nicht',
    distract: ['immer','manchmal','heute'], hint: 'Verneinung.' },
  { sentence: 'Wer den Pfennig nicht ehrt, ist des Talers nicht ___.', missing: 'wert',
    distract: ['froh','sicher','klug'], hint: 'Reimt sich auf „ehrt".' },
  { sentence: 'Lieber den Spatz in der Hand als die ___ auf dem Dach.', missing: 'Taube',
    distract: ['Krähe','Möwe','Eule'], hint: 'Friedensvogel.' },
  { sentence: 'Die ___ macht den Meister.', missing: 'Übung',
    distract: ['Schule','Theorie','Lehre'], hint: 'Wiederholtes Trainieren.' },
  { sentence: 'Eine ___ macht noch keinen Sommer.', missing: 'Schwalbe',
    distract: ['Maus','Biene','Wolke'], hint: 'Zugvogel der bei warmem Wetter zurückkehrt.' },
  { sentence: 'Es ist nicht alles Gold, was ___.', missing: 'glänzt',
    distract: ['leuchtet','funkelt','schimmert'], hint: 'Wenn etwas im Licht reflektiert.' },
  { sentence: 'Geteiltes Leid ist halbes ___.', missing: 'Leid',
    distract: ['Glück','Lachen','Unglück'], hint: 'Selbes Wort wie am Anfang.' },
  { sentence: 'Der Mensch denkt, Gott ___.', missing: 'lenkt',
    distract: ['weiß','schaut','hilft'], hint: 'Reimt sich auf „denkt".' },
  { sentence: 'In der Ruhe liegt die ___.', missing: 'Kraft',
    distract: ['Stärke','Macht','Energie'], hint: 'Was Sportler haben.' },
  { sentence: 'Klein, aber ___.', missing: 'fein',
    distract: ['groß','schön','schnell'], hint: 'Reimt sich auf „klein".' },
  { sentence: 'Reden ist Silber, ___ ist Gold.', missing: 'Schweigen',
    distract: ['Hören','Denken','Lesen'], hint: 'Nicht sprechen.' },
  { sentence: 'Andere Länder, andere ___.', missing: 'Sitten',
    distract: ['Sprachen','Menschen','Häuser'], hint: 'Bräuche und Gewohnheiten.' },
  { sentence: 'Geteilte ___ ist doppelte Freude.', missing: 'Freude',
    distract: ['Liebe','Lachen','Trauer'], hint: 'Selbes Wort wie am Ende.' },
  { sentence: 'Pünktlichkeit ist die Höflichkeit der ___.', missing: 'Könige',
    distract: ['Bauern','Diener','Herren'], hint: 'Adelige Herrscher.' },
  { sentence: 'Aller guten Dinge sind ___.', missing: 'drei',
    distract: ['zwei','vier','fünf'], hint: 'Zahl zwischen zwei und vier.' },
  { sentence: 'Ohne ___ kein Preis.', missing: 'Fleiß',
    distract: ['Geld','Glück','Schweiß'], hint: 'Hartes Arbeiten.' },
  { sentence: 'Stille Wasser sind ___.', missing: 'tief',
    distract: ['flach','klar','blau'], hint: 'Das Gegenteil von oberflächlich.' },
  { sentence: 'Wer A sagt, muss auch ___ sagen.', missing: 'B',
    distract: ['Z','C','O'], hint: 'Zweiter Buchstabe im Alphabet.' },
  { sentence: 'Spare in der Zeit, dann hast du in der ___.', missing: 'Not',
    distract: ['Freude','Ruhe','Zeit'], hint: 'Schwere Lage.' },
  { sentence: 'Wer nicht hören will, muss ___.', missing: 'fühlen',
    distract: ['sehen','schmecken','riechen'], hint: 'Mit der Haut wahrnehmen.' },
  { sentence: 'Es führen viele Wege nach ___.', missing: 'Rom',
    distract: ['Paris','Berlin','Wien'], hint: 'Italienische Hauptstadt.' },
  { sentence: 'Aus den Augen, aus dem ___.', missing: 'Sinn',
    distract: ['Herz','Kopf','Blick'], hint: 'Wo Gedanken entstehen.' },
  { sentence: 'Wer wagt, ___.', missing: 'gewinnt',
    distract: ['verliert','wartet','denkt'], hint: 'Den Sieg holen.' },
  { sentence: 'Da liegt der ___ begraben.', missing: 'Hund',
    distract: ['Schatz','Knochen','Hase'], hint: 'Vierbeiner mit Bell.' },
  { sentence: 'Den Nagel auf den ___ treffen.', missing: 'Kopf',
    distract: ['Punkt','Boden','Tisch'], hint: 'Oberster Körperteil.' },
  { sentence: 'Aus einer Mücke einen ___ machen.', missing: 'Elefanten',
    distract: ['Berg','Wal','Bären'], hint: 'Größtes Landtier.' },
  { sentence: 'Der ___ heiligt die Mittel.', missing: 'Zweck',
    distract: ['Plan','Traum','Wille'], hint: 'Das Ziel.' },
  { sentence: 'Was du heute kannst besorgen, das verschiebe nicht auf ___.', missing: 'morgen',
    distract: ['gestern','heute','Sonntag'], hint: 'Der nächste Tag.' },
  { sentence: 'Die ___ heilt alle Wunden.', missing: 'Zeit',
    distract: ['Hoffnung','Liebe','Geduld'], hint: 'Stunden, Tage, Wochen.' },
];

// === ALLGEMEINWISSEN ===
const POOL_ALLGEMEIN = [
  { q: 'Wie viele Bundesländer hat Deutschland?', a: '16', distract: ['12','18','20'] },
  { q: 'Welche ist die Hauptstadt von Bayern?', a: 'München', distract: ['Nürnberg','Augsburg','Regensburg'] },
  { q: 'Welcher Fluss fließt durch Köln?', a: 'Rhein', distract: ['Donau','Elbe','Main'] },
  { q: 'In welchem Jahr fiel die Berliner Mauer?', a: '1989', distract: ['1985','1991','1987'] },
  { q: 'Wer schrieb „Faust"?', a: 'Goethe', distract: ['Schiller','Brecht','Kafka'] },
  { q: 'Welcher Komponist war taub?', a: 'Beethoven', distract: ['Mozart','Bach','Schubert'] },
  { q: 'Wie viele Beine hat eine Spinne?', a: '8', distract: ['6','10','4'] },
  { q: 'Welcher Planet ist der Sonne am nächsten?', a: 'Merkur', distract: ['Venus','Mars','Erde'] },
  { q: 'Was ist die Hauptstadt von Frankreich?', a: 'Paris', distract: ['Lyon','Marseille','Nizza'] },
  { q: 'Welches Tier ist der „König der Tiere"?', a: 'Löwe', distract: ['Tiger','Bär','Adler'] },
  { q: 'Wie viele Tage hat der Februar in einem Schaltjahr?', a: '29', distract: ['28','30','31'] },
  { q: 'Welche Farben hat die deutsche Flagge?', a: 'Schwarz-Rot-Gold', distract: ['Schwarz-Weiß-Rot','Rot-Weiß','Blau-Weiß-Rot'] },
  { q: 'Wie heißt das längste Gebirge Europas?', a: 'Alpen', distract: ['Karpaten','Pyrenäen','Skanden'] },
  { q: 'Welcher Kontinent ist der größte?', a: 'Asien', distract: ['Afrika','Amerika','Europa'] },
  { q: 'Wie heißt das Geld in den USA?', a: 'Dollar', distract: ['Pfund','Peso','Real'] },
  { q: 'Wer malte die Mona Lisa?', a: 'Leonardo da Vinci', distract: ['Michelangelo','Raffael','Picasso'] },
  { q: 'Welcher Vogel kann nicht fliegen?', a: 'Pinguin', distract: ['Adler','Möwe','Spatz'] },
  { q: 'Was bedeutet „PKW"?', a: 'Personenkraftwagen', distract: ['Pkw-Karren','Personenkutsche','Postkraftwagen'] },
  { q: 'Welcher Tag kommt nach Mittwoch?', a: 'Donnerstag', distract: ['Dienstag','Freitag','Samstag'] },
  { q: 'Wie viele Buchstaben hat das deutsche Alphabet (ohne Umlaute)?', a: '26', distract: ['24','28','30'] },
  // Geographie
  { q: 'Welcher ist der größte Ozean?', a: 'Pazifik', distract: ['Atlantik','Indischer Ozean','Arktischer Ozean'] },
  { q: 'In welchem Land steht der Eiffelturm?', a: 'Frankreich', distract: ['Italien','Spanien','Belgien'] },
  { q: 'Welcher Berg ist Deutschlands höchster?', a: 'Zugspitze', distract: ['Watzmann','Brocken','Feldberg'] },
  { q: 'Welche Stadt ist die Hauptstadt der Schweiz?', a: 'Bern', distract: ['Zürich','Genf','Basel'] },
  { q: 'Welcher Fluss fließt durch Wien?', a: 'Donau', distract: ['Rhein','Elbe','Inn'] },
  { q: 'Welches Meer trennt Deutschland von Schweden?', a: 'Ostsee', distract: ['Nordsee','Mittelmeer','Adria'] },
  { q: 'In welchem Bundesland liegt München?', a: 'Bayern', distract: ['Baden-Württemberg','Hessen','Sachsen'] },
  { q: 'Welche Stadt ist die Hauptstadt von Italien?', a: 'Rom', distract: ['Mailand','Florenz','Neapel'] },
  { q: 'In welchem Kontinent liegt Ägypten?', a: 'Afrika', distract: ['Asien','Europa','Australien'] },
  { q: 'Welcher Kontinent ist der kleinste?', a: 'Australien', distract: ['Europa','Antarktis','Südamerika'] },
  // Geschichte
  { q: 'Wann begann der Zweite Weltkrieg?', a: '1939', distract: ['1914','1945','1933'] },
  { q: 'Wann endete der Zweite Weltkrieg?', a: '1945', distract: ['1939','1949','1944'] },
  { q: 'Wer war der erste Bundeskanzler der Bundesrepublik Deutschland?', a: 'Konrad Adenauer', distract: ['Willy Brandt','Helmut Kohl','Ludwig Erhard'] },
  { q: 'Welche Königin regierte Großbritannien sehr lange im 20. Jahrhundert?', a: 'Elisabeth II.', distract: ['Victoria','Maria','Anne'] },
  { q: 'Wer entdeckte 1492 Amerika?', a: 'Christoph Kolumbus', distract: ['Marco Polo','Vasco da Gama','James Cook'] },
  { q: 'Welche deutsche Stadt war geteilt durch eine Mauer?', a: 'Berlin', distract: ['München','Hamburg','Frankfurt'] },
  { q: 'In welchem Jahrhundert lebte Martin Luther?', a: '16. Jahrhundert', distract: ['15. Jahrhundert','17. Jahrhundert','14. Jahrhundert'] },
  { q: 'Wann wurde die Bundesrepublik Deutschland gegründet?', a: '1949', distract: ['1945','1955','1939'] },
  { q: 'Wer war Otto von Bismarck?', a: 'Deutscher Reichskanzler', distract: ['Komponist','Maler','Erfinder'] },
  // Tiere/Natur
  { q: 'Wie heißt das größte Säugetier?', a: 'Blauwal', distract: ['Elefant','Giraffe','Nashorn'] },
  { q: 'Wie viele Höcker hat ein Dromedar?', a: '1', distract: ['2','3','keine'] },
  { q: 'Welches Tier wird auch „König der Lüfte" genannt?', a: 'Adler', distract: ['Falke','Geier','Storch'] },
  { q: 'Welches Tier legt die größten Eier?', a: 'Strauß', distract: ['Adler','Schwan','Pute'] },
  { q: 'Welches Tier ist das schnellste an Land?', a: 'Gepard', distract: ['Pferd','Tiger','Strauß'] },
  { q: 'Wie viele Kammern hat ein Rindermagen?', a: '4', distract: ['1','2','3'] },
  { q: 'Wie heißen die Streifen am Zebra?', a: 'Schwarz und weiß', distract: ['Schwarz und braun','Grau und weiß','Bunt'] },
  { q: 'Welches Insekt produziert Honig?', a: 'Biene', distract: ['Wespe','Hummel','Käfer'] },
  { q: 'Wie nennt man eine Gruppe von Wölfen?', a: 'Rudel', distract: ['Schwarm','Herde','Schar'] },
  { q: 'Welcher Vogel ist das Wappentier Deutschlands?', a: 'Adler', distract: ['Falke','Eule','Taube'] },
  // Wissenschaft
  { q: 'Wie viele Planeten hat unser Sonnensystem?', a: '8', distract: ['7','9','10'] },
  { q: 'Welcher Planet ist der größte?', a: 'Jupiter', distract: ['Saturn','Mars','Erde'] },
  { q: 'Wie heißt der Stern, um den die Erde kreist?', a: 'Sonne', distract: ['Mond','Polarstern','Sirius'] },
  { q: 'Aus welchem Material besteht ein Diamant?', a: 'Kohlenstoff', distract: ['Kalk','Quarz','Eisen'] },
  { q: 'Wer formulierte die Relativitätstheorie?', a: 'Albert Einstein', distract: ['Isaac Newton','Galileo Galilei','Marie Curie'] },
  { q: 'Was ist H₂O?', a: 'Wasser', distract: ['Salz','Sauerstoff','Luft'] },
  { q: 'Wie viele Knochen hat ein erwachsener Mensch?', a: '206', distract: ['150','300','500'] },
  { q: 'Welcher Körperteil pumpt das Blut?', a: 'Herz', distract: ['Lunge','Niere','Leber'] },
  { q: 'Was misst man in Grad Celsius?', a: 'Temperatur', distract: ['Gewicht','Länge','Lautstärke'] },
  { q: 'Wie viele Beine hat ein Insekt?', a: '6', distract: ['4','8','10'] },
  // Musik / Kunst / Literatur
  { q: 'Wer schrieb die „Zauberflöte"?', a: 'Mozart', distract: ['Beethoven','Bach','Wagner'] },
  { q: 'Wer komponierte die 9. Sinfonie mit „Ode an die Freude"?', a: 'Beethoven', distract: ['Mozart','Schubert','Brahms'] },
  { q: 'Aus welcher Stadt kamen die Beatles?', a: 'Liverpool', distract: ['London','Manchester','Birmingham'] },
  { q: 'Wer schrieb „Romeo und Julia"?', a: 'Shakespeare', distract: ['Goethe','Schiller','Molière'] },
  { q: 'Wer ist der Autor von „Die Verwandlung"?', a: 'Franz Kafka', distract: ['Thomas Mann','Hermann Hesse','Bertolt Brecht'] },
  { q: 'Wer malte den „Sternenhimmel" und schnitt sich ein Ohr ab?', a: 'Vincent van Gogh', distract: ['Pablo Picasso','Claude Monet','Édouard Manet'] },
  { q: 'Welches Instrument hat 88 Tasten?', a: 'Klavier', distract: ['Akkordeon','Orgel','Cembalo'] },
  { q: 'Wer schrieb „Faust"?', a: 'Goethe', distract: ['Schiller','Lessing','Heine'] },
  { q: 'In welcher Stadt steht die Statue von David (Michelangelo)?', a: 'Florenz', distract: ['Rom','Mailand','Venedig'] },
  { q: 'Wer schrieb „Die Räuber"?', a: 'Schiller', distract: ['Goethe','Lessing','Brecht'] },
  // Sport
  { q: 'Wie viele Spieler hat eine Fußballmannschaft auf dem Platz?', a: '11', distract: ['9','10','12'] },
  { q: 'Welche Sportart wird in Wimbledon gespielt?', a: 'Tennis', distract: ['Golf','Cricket','Rugby'] },
  { q: 'Wie viele Ringe hat das olympische Symbol?', a: '5', distract: ['4','6','7'] },
  { q: 'In welchem Land wurden die Olympischen Spiele erfunden?', a: 'Griechenland', distract: ['Italien','Frankreich','Spanien'] },
  { q: 'Wie oft finden die Olympischen Sommerspiele statt?', a: 'Alle 4 Jahre', distract: ['Alle 2 Jahre','Jährlich','Alle 5 Jahre'] },
  // Alltagswissen
  { q: 'Wie viele Karten hat ein Skat-Spiel?', a: '32', distract: ['52','24','40'] },
  { q: 'Wie viele Spielfelder hat ein Schachbrett?', a: '64', distract: ['32','100','81'] },
  { q: 'Welche Farben hat das Schachbrett?', a: 'Schwarz und weiß', distract: ['Rot und schwarz','Grün und weiß','Braun und gelb'] },
  { q: 'Wie viele Augen hat ein Würfel?', a: '21', distract: ['18','24','15'] },
  { q: 'Wie viele Stunden hat ein Tag?', a: '24', distract: ['12','48','20'] },
  { q: 'Wie viele Minuten hat eine Stunde?', a: '60', distract: ['50','100','30'] },
  { q: 'Wie viele Tage hat ein Jahr (kein Schaltjahr)?', a: '365', distract: ['360','366','364'] },
  { q: 'Wie viele Wochentage gibt es?', a: '7', distract: ['5','6','8'] },
  { q: 'Welcher Wochentag kommt nach Sonntag?', a: 'Montag', distract: ['Samstag','Dienstag','Freitag'] },
  { q: 'Welcher Monat hat 28 oder 29 Tage?', a: 'Februar', distract: ['Januar','April','November'] },
  { q: 'Welche Farbe entsteht aus Blau und Gelb?', a: 'Grün', distract: ['Lila','Orange','Braun'] },
  { q: 'Welche Farbe entsteht aus Rot und Blau?', a: 'Lila', distract: ['Grün','Orange','Schwarz'] },
  { q: 'Wie heißt die Hauptstadt von Spanien?', a: 'Madrid', distract: ['Barcelona','Sevilla','Valencia'] },
  { q: 'Wie heißt die Hauptstadt von Schweden?', a: 'Stockholm', distract: ['Oslo','Kopenhagen','Helsinki'] },
  { q: 'Welche Sprache spricht man in Brasilien?', a: 'Portugiesisch', distract: ['Spanisch','Englisch','Italienisch'] },
  // Technologie / Erfindungen
  { q: 'Wer erfand die Glühbirne?', a: 'Thomas Edison', distract: ['Albert Einstein','Nikola Tesla','Alexander Graham Bell'] },
  { q: 'Wer erfand das Telefon?', a: 'Alexander Graham Bell', distract: ['Thomas Edison','Samuel Morse','Guglielmo Marconi'] },
  { q: 'Wer erfand den Buchdruck mit beweglichen Lettern?', a: 'Johannes Gutenberg', distract: ['Martin Luther','Konrad Zuse','Kaiser Karl der Große'] },
  { q: 'In welchem Jahrhundert wurde das Auto erfunden?', a: '19. Jahrhundert', distract: ['18. Jahrhundert','20. Jahrhundert','17. Jahrhundert'] },
  { q: 'Wer erfand die erste deutsche Auto-Marke?', a: 'Carl Benz', distract: ['Henry Ford','Wilhelm Maybach','Rudolf Diesel'] },
  // Kochen
  { q: 'Welche Zutat braucht man für Brot?', a: 'Mehl', distract: ['Reis','Zucker','Salz'] },
  { q: 'Wie nennt man rohen Fisch in der japanischen Küche?', a: 'Sushi', distract: ['Tempura','Ramen','Wasabi'] },
  { q: 'Was ist Kümmel?', a: 'Gewürz', distract: ['Tier','Frucht','Getränk'] },
  { q: 'Aus welcher Frucht wird Wein gemacht?', a: 'Trauben', distract: ['Äpfel','Pflaumen','Beeren'] },
  { q: 'Aus welcher Frucht wird Most gemacht?', a: 'Äpfel', distract: ['Trauben','Birnen','Kirschen'] },
  // Berühmte Personen
  { q: 'Wer war der Vater des Christentums?', a: 'Jesus Christus', distract: ['Mose','Paulus','Petrus'] },
  { q: 'Wer schrieb die Theorie der Schwerkraft?', a: 'Isaac Newton', distract: ['Albert Einstein','Galileo Galilei','Charles Darwin'] },
  { q: 'Wer war Anne Frank?', a: 'Tagebuchschreiberin im Versteck', distract: ['Schauspielerin','Politikerin','Komponistin'] },
  { q: 'Wer formulierte die Evolutionstheorie?', a: 'Charles Darwin', distract: ['Gregor Mendel','Louis Pasteur','Albert Einstein'] },
  { q: 'Wie hieß der erste Mensch auf dem Mond?', a: 'Neil Armstrong', distract: ['Yuri Gagarin','Buzz Aldrin','John Glenn'] },
  // === HAUPTSTÄDTE EUROPA ===
  { q: 'Was ist die Hauptstadt von Deutschland?', a: 'Berlin', distract: ['Hamburg','München','Frankfurt'] },
  { q: 'Was ist die Hauptstadt von Österreich?', a: 'Wien', distract: ['Salzburg','Graz','Innsbruck'] },
  { q: 'Was ist die Hauptstadt der Schweiz?', a: 'Bern', distract: ['Zürich','Genf','Basel'] },
  { q: 'Was ist die Hauptstadt von Frankreich?', a: 'Paris', distract: ['Lyon','Marseille','Bordeaux'] },
  { q: 'Was ist die Hauptstadt von Italien?', a: 'Rom', distract: ['Mailand','Florenz','Venedig'] },
  { q: 'Was ist die Hauptstadt von Spanien?', a: 'Madrid', distract: ['Barcelona','Sevilla','Valencia'] },
  { q: 'Was ist die Hauptstadt von Portugal?', a: 'Lissabon', distract: ['Porto','Faro','Coimbra'] },
  { q: 'Was ist die Hauptstadt von Großbritannien?', a: 'London', distract: ['Manchester','Liverpool','Edinburgh'] },
  { q: 'Was ist die Hauptstadt von Schottland?', a: 'Edinburgh', distract: ['Glasgow','Dundee','Aberdeen'] },
  { q: 'Was ist die Hauptstadt von Irland?', a: 'Dublin', distract: ['Belfast','Cork','Galway'] },
  { q: 'Was ist die Hauptstadt der Niederlande?', a: 'Amsterdam', distract: ['Den Haag','Rotterdam','Utrecht'] },
  { q: 'Was ist die Hauptstadt von Belgien?', a: 'Brüssel', distract: ['Antwerpen','Brügge','Lüttich'] },
  { q: 'Was ist die Hauptstadt von Dänemark?', a: 'Kopenhagen', distract: ['Aarhus','Odense','Aalborg'] },
  { q: 'Was ist die Hauptstadt von Schweden?', a: 'Stockholm', distract: ['Göteborg','Malmö','Uppsala'] },
  { q: 'Was ist die Hauptstadt von Norwegen?', a: 'Oslo', distract: ['Bergen','Trondheim','Stavanger'] },
  { q: 'Was ist die Hauptstadt von Finnland?', a: 'Helsinki', distract: ['Espoo','Tampere','Turku'] },
  { q: 'Was ist die Hauptstadt von Polen?', a: 'Warschau', distract: ['Krakau','Danzig','Posen'] },
  { q: 'Was ist die Hauptstadt von Tschechien?', a: 'Prag', distract: ['Brünn','Pilsen','Ostrava'] },
  { q: 'Was ist die Hauptstadt von Ungarn?', a: 'Budapest', distract: ['Debrecen','Szeged','Pécs'] },
  { q: 'Was ist die Hauptstadt von Griechenland?', a: 'Athen', distract: ['Thessaloniki','Patras','Piräus'] },
  { q: 'Was ist die Hauptstadt von Russland?', a: 'Moskau', distract: ['Sankt Petersburg','Kiew','Minsk'] },
  { q: 'Was ist die Hauptstadt von Rumänien?', a: 'Bukarest', distract: ['Sofia','Belgrad','Athen'] },
  { q: 'Was ist die Hauptstadt von Bulgarien?', a: 'Sofia', distract: ['Bukarest','Belgrad','Skopje'] },
  { q: 'Was ist die Hauptstadt von Kroatien?', a: 'Zagreb', distract: ['Split','Rijeka','Dubrovnik'] },
  // === HAUPTSTÄDTE WELT ===
  { q: 'Was ist die Hauptstadt der USA?', a: 'Washington', distract: ['New York','Los Angeles','Chicago'] },
  { q: 'Was ist die Hauptstadt von Kanada?', a: 'Ottawa', distract: ['Toronto','Vancouver','Montreal'] },
  { q: 'Was ist die Hauptstadt von Australien?', a: 'Canberra', distract: ['Sydney','Melbourne','Perth'] },
  { q: 'Was ist die Hauptstadt von China?', a: 'Peking', distract: ['Schanghai','Hongkong','Tokio'] },
  { q: 'Was ist die Hauptstadt von Japan?', a: 'Tokio', distract: ['Osaka','Kyoto','Yokohama'] },
  { q: 'Was ist die Hauptstadt von Indien?', a: 'Neu-Delhi', distract: ['Mumbai','Kalkutta','Bangalore'] },
  { q: 'Was ist die Hauptstadt von Brasilien?', a: 'Brasília', distract: ['Rio de Janeiro','São Paulo','Salvador'] },
  { q: 'Was ist die Hauptstadt von Argentinien?', a: 'Buenos Aires', distract: ['Córdoba','Rosario','Mendoza'] },
  { q: 'Was ist die Hauptstadt von Mexiko?', a: 'Mexiko-Stadt', distract: ['Guadalajara','Monterrey','Tijuana'] },
  { q: 'Was ist die Hauptstadt von Ägypten?', a: 'Kairo', distract: ['Alexandria','Luxor','Gizeh'] },
  { q: 'Was ist die Hauptstadt von Südafrika?', a: 'Pretoria', distract: ['Kapstadt','Johannesburg','Durban'] },
  { q: 'Was ist die Hauptstadt der Türkei?', a: 'Ankara', distract: ['Istanbul','Izmir','Bursa'] },
  { q: 'Was ist die Hauptstadt von Israel?', a: 'Jerusalem', distract: ['Tel Aviv','Haifa','Eilat'] },
  // === DEUTSCHE BUNDESLÄNDER UND HAUPTSTÄDTE ===
  { q: 'Was ist die Landeshauptstadt von Bayern?', a: 'München', distract: ['Nürnberg','Augsburg','Regensburg'] },
  { q: 'Was ist die Landeshauptstadt von Baden-Württemberg?', a: 'Stuttgart', distract: ['Karlsruhe','Mannheim','Freiburg'] },
  { q: 'Was ist die Landeshauptstadt von Hessen?', a: 'Wiesbaden', distract: ['Frankfurt','Darmstadt','Kassel'] },
  { q: 'Was ist die Landeshauptstadt von Nordrhein-Westfalen?', a: 'Düsseldorf', distract: ['Köln','Dortmund','Essen'] },
  { q: 'Was ist die Landeshauptstadt von Niedersachsen?', a: 'Hannover', distract: ['Braunschweig','Osnabrück','Oldenburg'] },
  { q: 'Was ist die Landeshauptstadt von Sachsen?', a: 'Dresden', distract: ['Leipzig','Chemnitz','Zwickau'] },
  { q: 'Was ist die Landeshauptstadt von Rheinland-Pfalz?', a: 'Mainz', distract: ['Koblenz','Trier','Ludwigshafen'] },
  { q: 'Was ist die Landeshauptstadt von Schleswig-Holstein?', a: 'Kiel', distract: ['Lübeck','Flensburg','Neumünster'] },
  { q: 'Was ist die Landeshauptstadt von Thüringen?', a: 'Erfurt', distract: ['Jena','Weimar','Gera'] },
  { q: 'Was ist die Landeshauptstadt von Brandenburg?', a: 'Potsdam', distract: ['Cottbus','Brandenburg','Frankfurt (Oder)'] },
  // === AUTOMARKEN — Herkunftsländer ===
  { q: 'Aus welchem Land kommt Volkswagen?', a: 'Deutschland', distract: ['Italien','Frankreich','Japan'] },
  { q: 'Aus welchem Land kommt BMW?', a: 'Deutschland', distract: ['Schweden','USA','Italien'] },
  { q: 'Aus welchem Land kommt Mercedes-Benz?', a: 'Deutschland', distract: ['Frankreich','Italien','USA'] },
  { q: 'Aus welchem Land kommt Audi?', a: 'Deutschland', distract: ['Italien','Frankreich','Schweden'] },
  { q: 'Aus welchem Land kommt Porsche?', a: 'Deutschland', distract: ['Italien','Großbritannien','USA'] },
  { q: 'Aus welchem Land kommt Opel?', a: 'Deutschland', distract: ['Frankreich','Italien','Spanien'] },
  { q: 'Aus welchem Land kommt Ferrari?', a: 'Italien', distract: ['Deutschland','Frankreich','USA'] },
  { q: 'Aus welchem Land kommt Lamborghini?', a: 'Italien', distract: ['Deutschland','Frankreich','Spanien'] },
  { q: 'Aus welchem Land kommt Fiat?', a: 'Italien', distract: ['Frankreich','Spanien','Deutschland'] },
  { q: 'Aus welchem Land kommt Alfa Romeo?', a: 'Italien', distract: ['Frankreich','Spanien','Deutschland'] },
  { q: 'Aus welchem Land kommt Maserati?', a: 'Italien', distract: ['Frankreich','Deutschland','USA'] },
  { q: 'Aus welchem Land kommt Renault?', a: 'Frankreich', distract: ['Italien','Spanien','Deutschland'] },
  { q: 'Aus welchem Land kommt Peugeot?', a: 'Frankreich', distract: ['Italien','Spanien','Deutschland'] },
  { q: 'Aus welchem Land kommt Citroën?', a: 'Frankreich', distract: ['Italien','Spanien','Belgien'] },
  { q: 'Aus welchem Land kommt Bugatti?', a: 'Frankreich', distract: ['Italien','Deutschland','Schweiz'] },
  { q: 'Aus welchem Land kommt Volvo?', a: 'Schweden', distract: ['Norwegen','Finnland','Dänemark'] },
  { q: 'Aus welchem Land kommt Saab?', a: 'Schweden', distract: ['Finnland','Norwegen','Dänemark'] },
  { q: 'Aus welchem Land kommt Toyota?', a: 'Japan', distract: ['China','Südkorea','Taiwan'] },
  { q: 'Aus welchem Land kommt Honda?', a: 'Japan', distract: ['China','Südkorea','USA'] },
  { q: 'Aus welchem Land kommt Nissan?', a: 'Japan', distract: ['China','Südkorea','Taiwan'] },
  { q: 'Aus welchem Land kommt Mazda?', a: 'Japan', distract: ['China','Südkorea','Thailand'] },
  { q: 'Aus welchem Land kommt Mitsubishi?', a: 'Japan', distract: ['China','Südkorea','Taiwan'] },
  { q: 'Aus welchem Land kommt Suzuki?', a: 'Japan', distract: ['China','Südkorea','Indien'] },
  { q: 'Aus welchem Land kommt Hyundai?', a: 'Südkorea', distract: ['Japan','China','Taiwan'] },
  { q: 'Aus welchem Land kommt Kia?', a: 'Südkorea', distract: ['Japan','China','Vietnam'] },
  { q: 'Aus welchem Land kommt Ford?', a: 'USA', distract: ['Deutschland','Großbritannien','Kanada'] },
  { q: 'Aus welchem Land kommt Chevrolet?', a: 'USA', distract: ['Frankreich','Italien','Großbritannien'] },
  { q: 'Aus welchem Land kommt Tesla?', a: 'USA', distract: ['Deutschland','China','Japan'] },
  { q: 'Aus welchem Land kommt Cadillac?', a: 'USA', distract: ['Großbritannien','Frankreich','Kanada'] },
  { q: 'Aus welchem Land kommt Jaguar?', a: 'Großbritannien', distract: ['Deutschland','Frankreich','Italien'] },
  { q: 'Aus welchem Land kommt Rolls-Royce?', a: 'Großbritannien', distract: ['Deutschland','Frankreich','Italien'] },
  { q: 'Aus welchem Land kommt Land Rover?', a: 'Großbritannien', distract: ['Deutschland','USA','Italien'] },
  { q: 'Aus welchem Land kommt Mini?', a: 'Großbritannien', distract: ['Deutschland','Italien','Frankreich'] },
  { q: 'Aus welchem Land kommt Bentley?', a: 'Großbritannien', distract: ['Deutschland','Italien','Frankreich'] },
  { q: 'Aus welchem Land kommt Aston Martin?', a: 'Großbritannien', distract: ['Italien','Frankreich','USA'] },
  { q: 'Aus welchem Land kommt Škoda?', a: 'Tschechien', distract: ['Polen','Slowakei','Ungarn'] },
  { q: 'Aus welchem Land kommt Seat?', a: 'Spanien', distract: ['Italien','Portugal','Frankreich'] },
  { q: 'Aus welchem Land kommt Dacia?', a: 'Rumänien', distract: ['Bulgarien','Ungarn','Türkei'] },
  // === AUTOMARKEN — Logos und Modelle ===
  { q: 'Welche Automarke hat einen Stern als Logo?', a: 'Mercedes-Benz', distract: ['BMW','Audi','Volkswagen'] },
  { q: 'Welche Automarke hat vier Ringe als Logo?', a: 'Audi', distract: ['BMW','Mercedes','Volkswagen'] },
  { q: 'Welche Automarke hat ein blau-weißes Propeller-Logo?', a: 'BMW', distract: ['Audi','Mercedes','Opel'] },
  { q: 'Welche Automarke hat ein springendes Pferd als Logo?', a: 'Ferrari', distract: ['Lamborghini','Porsche','Maserati'] },
  { q: 'Welche Automarke hat einen Stier als Logo?', a: 'Lamborghini', distract: ['Ferrari','Maserati','Alfa Romeo'] },
  { q: 'Welche Automarke produziert den „Käfer"?', a: 'Volkswagen', distract: ['BMW','Audi','Opel'] },
  { q: 'Welche Automarke produziert den „Golf"?', a: 'Volkswagen', distract: ['BMW','Audi','Opel'] },
  { q: 'Welche Automarke produziert den „911"?', a: 'Porsche', distract: ['Ferrari','BMW','Mercedes'] },
  { q: 'Welche Automarke produziert den „A4"?', a: 'Audi', distract: ['BMW','Mercedes','Volkswagen'] },
  // === ESSEN UND KÜCHE ===
  { q: 'Aus welchem Land kommt die Pizza?', a: 'Italien', distract: ['Frankreich','Spanien','Griechenland'] },
  { q: 'Aus welchem Land kommt das Sushi?', a: 'Japan', distract: ['China','Thailand','Korea'] },
  { q: 'Aus welchem Land kommt das Sauerkraut?', a: 'Deutschland', distract: ['Polen','Russland','Tschechien'] },
  { q: 'Aus welchem Land kommt die Paella?', a: 'Spanien', distract: ['Italien','Portugal','Frankreich'] },
  { q: 'Aus welchem Land kommt das Croissant?', a: 'Frankreich', distract: ['Österreich','Italien','Belgien'] },
  { q: 'Aus welchem Land kommt der Champagner?', a: 'Frankreich', distract: ['Italien','Deutschland','Spanien'] },
  { q: 'Aus welchem Land kommt der Cheddar-Käse?', a: 'England', distract: ['Frankreich','Italien','Schweiz'] },
  { q: 'Aus welchem Land kommt der Parmesan?', a: 'Italien', distract: ['Frankreich','Schweiz','Spanien'] },
  { q: 'Aus welchem Land kommen die Nudeln (ursprünglich)?', a: 'China', distract: ['Italien','Japan','Indien'] },
  { q: 'Aus welcher deutschen Stadt kommt das berühmte „Schwarzbier"?', a: 'Köstritz', distract: ['München','Berlin','Hamburg'] },
];

// === ANALOGIEN — A verhält sich zu B wie C zu ___ ===
// Format: { a, b, c, d (richtig), distract: [3], hint }
const POOL_ANALOGIEN = [
  { a: 'Hund', b: 'Welpe', c: 'Pferd', d: 'Fohlen', distract: ['Reiter','Stall','Sattel'], hint: 'Das Junge eines Tieres.' },
  { a: 'Hand', b: 'Finger', c: 'Fuß', d: 'Zehe', distract: ['Schuh','Bein','Knie'], hint: 'Die kleinen Anhänge am Ende.' },
  { a: 'Sommer', b: 'heiß', c: 'Winter', d: 'kalt', distract: ['weiß','still','lang'], hint: 'Das gegenteilige Wetter.' },
  { a: 'Vogel', b: 'fliegen', c: 'Fisch', d: 'schwimmen', distract: ['kriechen','laufen','springen'], hint: 'Die typische Fortbewegung.' },
  { a: 'Auge', b: 'sehen', c: 'Ohr', d: 'hören', distract: ['fühlen','riechen','schmecken'], hint: 'Was man mit dem Sinnesorgan tut.' },
  { a: 'Brot', b: 'Bäcker', c: 'Fleisch', d: 'Metzger', distract: ['Bauer','Koch','Gast'], hint: 'Wer das Lebensmittel verkauft.' },
  { a: 'Tag', b: 'Nacht', c: 'hell', d: 'dunkel', distract: ['grau','schwarz','still'], hint: 'Das Gegenteil von hell.' },
  { a: 'Schule', b: 'Lehrer', c: 'Krankenhaus', d: 'Arzt', distract: ['Pfleger','Patient','Schwester'], hint: 'Wer behandelt im Krankenhaus.' },
  { a: 'Buch', b: 'lesen', c: 'Lied', d: 'singen', distract: ['hören','tanzen','sehen'], hint: 'Was man mit dem Lied macht.' },
  { a: 'Apfel', b: 'Frucht', c: 'Karotte', d: 'Gemüse', distract: ['Wurzel','Salat','Beilage'], hint: 'Die Kategorie für Karotten.' },
  { a: 'Kuh', b: 'Milch', c: 'Henne', d: 'Ei', distract: ['Federn','Hahn','Stall'], hint: 'Was eine Henne legt.' },
  { a: 'Schnee', b: 'weiß', c: 'Gras', d: 'grün', distract: ['braun','gelb','blau'], hint: 'Die Farbe von Gras.' },
  { a: 'Auto', b: 'Straße', c: 'Zug', d: 'Schiene', distract: ['Tunnel','Bahnhof','Reise'], hint: 'Worauf der Zug fährt.' },
  { a: 'Buch', b: 'Seite', c: 'Baum', d: 'Blatt', distract: ['Stamm','Ast','Wurzel'], hint: 'Was am Baum wächst.' },
  { a: 'König', b: 'Krone', c: 'Soldat', d: 'Helm', distract: ['Schwert','Schuh','Mantel'], hint: 'Kopfbedeckung des Soldaten.' },
  { a: 'Vogel', b: 'Nest', c: 'Hund', d: 'Hütte', distract: ['Garten','Wiese','Pfote'], hint: 'Wo der Hund wohnt.' },
  { a: 'Fuß', b: 'Schuh', c: 'Hand', d: 'Handschuh', distract: ['Ring','Uhr','Armband'], hint: 'Bedeckt die Hand.' },
  { a: 'Maler', b: 'Pinsel', c: 'Schreiner', d: 'Hammer', distract: ['Säge','Holz','Nagel'], hint: 'Werkzeug zum Schlagen.' },
  { a: 'Stuhl', b: 'sitzen', c: 'Bett', d: 'liegen', distract: ['stehen','springen','tanzen'], hint: 'Was man im Bett tut.' },
  { a: 'Mehl', b: 'Brot', c: 'Holz', d: 'Möbel', distract: ['Wald','Feuer','Tür'], hint: 'Wofür Holz verarbeitet wird.' },
  { a: 'Sonne', b: 'Tag', c: 'Mond', d: 'Nacht', distract: ['Stern','Himmel','Licht'], hint: 'Wann der Mond am Himmel steht.' },
  { a: 'Hunger', b: 'essen', c: 'Durst', d: 'trinken', distract: ['schlafen','rufen','warten'], hint: 'Was man bei Durst tut.' },
  { a: 'Tasse', b: 'Kaffee', c: 'Glas', d: 'Wasser', distract: ['Milch','Saft','Tee'], hint: 'Typisches Getränk im Glas.' },
  { a: 'Kalt', b: 'Eis', c: 'Heiß', d: 'Feuer', distract: ['Sonne','Glut','Asche'], hint: 'Etwas das brennt und heiß ist.' },
  { a: 'Anfang', b: 'Ende', c: 'Frage', d: 'Antwort', distract: ['Wort','Satz','Stille'], hint: 'Das Gegenstück zur Frage.' },
  { a: 'Tisch', b: 'Holz', c: 'Fenster', d: 'Glas', distract: ['Stein','Metall','Stoff'], hint: 'Material durch das man hindurchsehen kann.' },
  { a: 'Lehrer', b: 'Schule', c: 'Pfarrer', d: 'Kirche', distract: ['Krankenhaus','Werkstatt','Bahnhof'], hint: 'Wo der Pfarrer arbeitet.' },
  { a: 'Vogel', b: 'Eier', c: 'Kuh', d: 'Milch', distract: ['Wolle','Honig','Federn'], hint: 'Was die Kuh gibt.' },
  { a: 'Pinsel', b: 'Maler', c: 'Geige', d: 'Musiker', distract: ['Bauer','Bäcker','Pilot'], hint: 'Wer die Geige spielt.' },
  { a: 'Trauben', b: 'Wein', c: 'Äpfel', d: 'Most', distract: ['Saft','Marmelade','Mus'], hint: 'Apfelsaft, der vergoren ist.' },
  { a: 'Bauer', b: 'Feld', c: 'Fischer', d: 'Meer', distract: ['Hafen','Boot','Fluss'], hint: 'Wo der Fischer arbeitet.' },
  { a: 'Kalt', b: 'Frieren', c: 'Müde', d: 'Schlafen', distract: ['Wachen','Lachen','Weinen'], hint: 'Was man tut, wenn man müde ist.' },
  { a: 'Pferd', b: 'Stall', c: 'Auto', d: 'Garage', distract: ['Tankstelle','Werkstatt','Straße'], hint: 'Wo das Auto „schläft".' },
  { a: 'Hut', b: 'Kopf', c: 'Schuh', d: 'Fuß', distract: ['Hand','Knie','Rücken'], hint: 'Wo der Schuh getragen wird.' },
  { a: 'Wasser', b: 'See', c: 'Sand', d: 'Wüste', distract: ['Berg','Wald','Stadt'], hint: 'Großer Bereich aus Sand.' },
  { a: 'Buch', b: 'Bibliothek', c: 'Bild', d: 'Galerie', distract: ['Garten','Schule','Kirche'], hint: 'Wo Bilder ausgestellt werden.' },
  { a: 'Polizist', b: 'Pistole', c: 'Soldat', d: 'Gewehr', distract: ['Stock','Speer','Stab'], hint: 'Klassische Waffe der Soldaten.' },
  { a: 'Lachen', b: 'Freude', c: 'Weinen', d: 'Trauer', distract: ['Wut','Angst','Müdigkeit'], hint: 'Gefühl, das zum Weinen führt.' },
  { a: 'Honig', b: 'Biene', c: 'Seide', d: 'Seidenraupe', distract: ['Spinne','Wurm','Ameise'], hint: 'Sie produziert den feinen Faden.' },
  { a: 'Schneider', b: 'Stoff', c: 'Schmied', d: 'Eisen', distract: ['Holz','Stein','Glas'], hint: 'Material des Schmieds.' },
  { a: 'Sehen', b: 'Auge', c: 'Riechen', d: 'Nase', distract: ['Mund','Ohr','Hand'], hint: 'Damit nimmt man Düfte wahr.' },
  { a: 'Schmecken', b: 'Zunge', c: 'Hören', d: 'Ohr', distract: ['Auge','Mund','Nase'], hint: 'Sinnesorgan für Geräusche.' },
  { a: 'Frühstück', b: 'Morgen', c: 'Abendessen', d: 'Abend', distract: ['Mittag','Mitternacht','Vormittag'], hint: 'Wann man zu Abend isst.' },
  { a: 'Geld', b: 'Bank', c: 'Buch', d: 'Bibliothek', distract: ['Kirche','Schule','Markt'], hint: 'Ort wo Bücher aufbewahrt werden.' },
  { a: 'Hund', b: 'bellt', c: 'Katze', d: 'miaut', distract: ['bellt','wiehert','quiekt'], hint: 'Welches Geräusch macht eine Katze?' },
  { a: 'Frosch', b: 'quakt', c: 'Pferd', d: 'wiehert', distract: ['miaut','bellt','blökt'], hint: 'Pferdetypischer Laut.' },
  { a: 'Katze', b: 'Tatze', c: 'Hund', d: 'Pfote', distract: ['Krallen','Hand','Klaue'], hint: 'So nennt man den Fuß des Hundes.' },
  { a: 'Bett', b: 'Schlafzimmer', c: 'Herd', d: 'Küche', distract: ['Bad','Garage','Flur'], hint: 'Raum, in dem der Herd steht.' },
  { a: 'Auto', b: 'Tank', c: 'Mensch', d: 'Magen', distract: ['Herz','Lunge','Niere'], hint: 'Verdaut die Nahrung.' },
  { a: 'Pinguin', b: 'Antarktis', c: 'Kamel', d: 'Wüste', distract: ['Wald','Meer','Berg'], hint: 'Lebensraum der Kamele.' },
  { a: 'Auto', b: 'Räder', c: 'Schiff', d: 'Anker', distract: ['Reifen','Sattel','Mast'], hint: 'Hält das Schiff im Hafen fest.' },
  { a: 'Eichel', b: 'Eiche', c: 'Kastanie', d: 'Kastanienbaum', distract: ['Buche','Birke','Eiche'], hint: 'Baum der Kastanienfrüchte.' },
  { a: 'Hund', b: 'Hütte', c: 'Biene', d: 'Bienenstock', distract: ['Nest','Höhle','Bau'], hint: 'Behausung der Bienen.' },
  { a: 'Mensch', b: 'gehen', c: 'Schlange', d: 'kriechen', distract: ['fliegen','schwimmen','springen'], hint: 'Fortbewegung der Schlange.' },
  { a: 'Hahn', b: 'kräht', c: 'Esel', d: 'iaht', distract: ['blökt','wiehert','muht'], hint: 'Eselslaut, den jeder kennt.' },
  { a: 'Wasser', b: 'flüssig', c: 'Eis', d: 'fest', distract: ['gasförmig','warm','klar'], hint: 'Aggregatzustand von Eis.' },
  { a: 'Kuchen', b: 'backen', c: 'Pullover', d: 'stricken', distract: ['nähen','flechten','weben'], hint: 'Womit Oma den Pulli macht.' },
  { a: 'Lehrer', b: 'unterrichten', c: 'Arzt', d: 'heilen', distract: ['lernen','fragen','schreiben'], hint: 'Aufgabe des Arztes.' },
  { a: 'Sänger', b: 'singen', c: 'Tänzer', d: 'tanzen', distract: ['rennen','springen','klopfen'], hint: 'Was Tänzer auf der Bühne tun.' },
  { a: 'Glas', b: 'durchsichtig', c: 'Wand', d: 'undurchsichtig', distract: ['glatt','rau','weich'], hint: 'Im Gegensatz zum Glas.' },
  { a: 'Hammer', b: 'Schlagen', c: 'Säge', d: 'Sägen', distract: ['Drücken','Drehen','Bohren'], hint: 'Tätigkeit mit der Säge.' },
  { a: 'Apfel', b: 'rot', c: 'Banane', d: 'gelb', distract: ['blau','grün','schwarz'], hint: 'Farbe der reifen Banane.' },
  { a: 'Brot', b: 'Bäcker', c: 'Schuhe', d: 'Schuster', distract: ['Bauer','Maler','Lehrer'], hint: 'Wer Schuhe macht und repariert.' },
  { a: 'Wald', b: 'Bäume', c: 'Wiese', d: 'Gras', distract: ['Sand','Felsen','Eis'], hint: 'Was auf der Wiese wächst.' },
  { a: 'Sommer', b: 'Schwitzen', c: 'Winter', d: 'Frieren', distract: ['Lachen','Weinen','Singen'], hint: 'Was man im Winter im Freien tut.' },
  { a: 'Frosch', b: 'Tümpel', c: 'Maulwurf', d: 'Erde', distract: ['Wolke','Baum','Stein'], hint: 'Wo der Maulwurf gräbt.' },
  { a: 'Fisch', b: 'Schuppen', c: 'Vogel', d: 'Federn', distract: ['Fell','Haut','Schale'], hint: 'Bedecken den Vogel.' },
  { a: 'Lampe', b: 'leuchten', c: 'Ofen', d: 'wärmen', distract: ['kühlen','frieren','verbrennen'], hint: 'Wofür der Ofen sorgt.' },
  { a: 'Wasser', b: 'See', c: 'Bäume', d: 'Wald', distract: ['Wiese','Park','Feld'], hint: 'Wo viele Bäume stehen.' },
  { a: 'Brot', b: 'Bäckerei', c: 'Medizin', d: 'Apotheke', distract: ['Krankenhaus','Drogerie','Klinik'], hint: 'Hier kauft man Tabletten.' },
  { a: 'Lehrer', b: 'Klassenzimmer', c: 'Koch', d: 'Küche', distract: ['Bühne','Werkstatt','Studio'], hint: 'Wo der Koch arbeitet.' },
  { a: 'Pinguin', b: 'Wasser', c: 'Geier', d: 'Luft', distract: ['Wald','Wiese','Boden'], hint: 'Wo Geier kreisen.' },
  { a: 'Buch', b: 'Worte', c: 'Lied', d: 'Töne', distract: ['Farben','Gerüche','Berührungen'], hint: 'Was Lieder hörbar macht.' },
  { a: 'Glas', b: 'zerbrechlich', c: 'Stahl', d: 'fest', distract: ['weich','dünn','klar'], hint: 'Eigenschaft von Stahl.' },
  { a: 'Pferd', b: 'wiehern', c: 'Wolf', d: 'heulen', distract: ['miauen','bellen','quaken'], hint: 'Wolfslaut nachts beim Mond.' },
  { a: 'Maler', b: 'Bild', c: 'Komponist', d: 'Lied', distract: ['Buch','Skulptur','Film'], hint: 'Was ein Komponist erschafft.' },
  { a: 'Sommer', b: 'Sonnencreme', c: 'Winter', d: 'Schal', distract: ['Sonnenbrille','Mütze','Mantel'], hint: 'Wickelt man um den Hals.' },
  { a: 'Vogel', b: 'Schnabel', c: 'Mensch', d: 'Mund', distract: ['Nase','Ohr','Hand'], hint: 'Damit isst und spricht der Mensch.' },
  { a: 'Buch', b: 'Bibliothek', c: 'Fisch', d: 'Aquarium', distract: ['Käfig','Stall','Wald'], hint: 'Wo Fische gehalten werden.' },
  { a: 'Hagel', b: 'Eis', c: 'Regen', d: 'Wasser', distract: ['Schnee','Frost','Tropfen'], hint: 'Aus was Regen besteht.' },
  { a: 'Tier', b: 'Zoo', c: 'Pflanze', d: 'Botanischer Garten', distract: ['Wald','Park','Wiese'], hint: 'Wo seltene Pflanzen ausgestellt werden.' },
  { a: 'Tag', b: 'Sonne', c: 'Nacht', d: 'Mond', distract: ['Stern','Wolke','Licht'], hint: 'Was nachts am Himmel zu sehen ist.' },
  { a: 'Hund', b: 'Knochen', c: 'Kaninchen', d: 'Karotte', distract: ['Heu','Maus','Nuss'], hint: 'Lieblingsessen vom Kaninchen.' },
  { a: 'Pinguin', b: 'Antarktis', c: 'Eisbär', d: 'Arktis', distract: ['Wüste','Wald','Meer'], hint: 'Wo Eisbären leben.' },
  { a: 'Honig', b: 'Süß', c: 'Zitrone', d: 'Sauer', distract: ['Bitter','Salzig','Scharf'], hint: 'Geschmack einer Zitrone.' },
  { a: 'Geld', b: 'Geldbeutel', c: 'Werkzeug', d: 'Werkzeugkasten', distract: ['Schrank','Kiste','Tasche'], hint: 'Wo Werkzeuge aufbewahrt werden.' },
  { a: 'Sänger', b: 'Bühne', c: 'Profikoch', d: 'Restaurantküche', distract: ['Wohnzimmer','Hof','Garage'], hint: 'Wo der Profikoch arbeitet.' },
  { a: 'Rathaus', b: 'Bürgermeister', c: 'Schloss', d: 'König', distract: ['Bauer','Diener','Page'], hint: 'Höchster Bewohner eines Schlosses.' },
  { a: 'Brille', b: 'sehen', c: 'Hörgerät', d: 'hören', distract: ['fühlen','riechen','schmecken'], hint: 'Sinn der vom Hörgerät unterstützt wird.' },
  { a: 'Mond', b: 'Erde', c: 'Erde', d: 'Sonne', distract: ['Mars','Jupiter','Pluto'], hint: 'Stern um den die Erde kreist.' },
  { a: 'Schlüssel', b: 'Schloss', c: 'Hand', d: 'Türklinke', distract: ['Tür','Wand','Fenster'], hint: 'Was man mit der Hand drückt.' },
  { a: 'Bär', b: 'Höhle', c: 'Igel', d: 'Laubhaufen', distract: ['Nest','Bau','Wald'], hint: 'Wo Igel überwintern.' },
  { a: 'Nein', b: 'Ja', c: 'Stop', d: 'Los', distract: ['Halt','Pause','Aus'], hint: 'Beim Sport: Startsignal.' },
  { a: 'Frühling', b: 'Knospen', c: 'Herbst', d: 'Bunte Blätter', distract: ['Blüten','Samen','Wurzeln'], hint: 'Was im Herbst auffällt.' },
  { a: 'Hände', b: 'klatschen', c: 'Füße', d: 'stampfen', distract: ['rennen','springen','treten'], hint: 'Lautes Aufsetzen der Füße.' },
  { a: 'Wein', b: 'Trauben', c: 'Apfelmost', d: 'Äpfel', distract: ['Birnen','Zitronen','Kirschen'], hint: 'Frucht aus der Apfelmost gemacht wird.' },
  { a: 'Schach', b: 'König', c: 'Skat', d: 'Trumpf', distract: ['Joker','Ass','Bube'], hint: 'Wichtige Karte beim Skat-Spiel.' },
];

// === ZUSAMMENGESETZTE WÖRTER (Komposita) ===
// Format: { teil1, teil2, correct, distract: [3], hint }
const POOL_KOMPOSITA = [
  { teil1: 'Apfel', teil2: 'Baum', correct: 'Apfelbaum', distract: ['Obstbaum','Apfelfrucht','Baumapfel'], hint: 'Wo Äpfel wachsen.' },
  { teil1: 'Haus', teil2: 'Tür', correct: 'Haustür', distract: ['Türhaus','Türöffnung','Hauseingang'], hint: 'Vorderer Eingang am Haus.' },
  { teil1: 'Sonnen', teil2: 'Brille', correct: 'Sonnenbrille', distract: ['Sommerbrille','Augenbrille','Brillensonne'], hint: 'Schützt die Augen vor hellem Licht.' },
  { teil1: 'Regen', teil2: 'Schirm', correct: 'Regenschirm', distract: ['Schirmregen','Wetterschirm','Regendach'], hint: 'Hält trocken bei Niederschlag.' },
  { teil1: 'Hand', teil2: 'Schuh', correct: 'Handschuh', distract: ['Schuhhand','Fingerschuh','Lederhand'], hint: 'Wärmt die Finger im Winter.' },
  { teil1: 'Brief', teil2: 'Träger', correct: 'Briefträger', distract: ['Postmann','Briefbote','Trägerbrief'], hint: 'Bringt die Post.' },
  { teil1: 'Wasser', teil2: 'Hahn', correct: 'Wasserhahn', distract: ['Hahnwasser','Spülhahn','Rohrhahn'], hint: 'Daraus läuft Wasser in der Küche.' },
  { teil1: 'Kaffee', teil2: 'Tasse', correct: 'Kaffeetasse', distract: ['Tassenkaffee','Heißtasse','Kaffeebecher'], hint: 'Daraus trinkt man morgens.' },
  { teil1: 'Schul', teil2: 'Buch', correct: 'Schulbuch', distract: ['Lesebuch','Bildungsbuch','Buchschule'], hint: 'Wird im Unterricht benutzt.' },
  { teil1: 'Fahr', teil2: 'Rad', correct: 'Fahrrad', distract: ['Radfahr','Tretrad','Drahtesel'], hint: 'Zwei Räder, Pedale.' },
  { teil1: 'Bahn', teil2: 'Hof', correct: 'Bahnhof', distract: ['Hofbahn','Zughaltestelle','Schienenhof'], hint: 'Wo Züge halten.' },
  { teil1: 'Schreib', teil2: 'Tisch', correct: 'Schreibtisch', distract: ['Tischschreib','Bürotisch','Schreibmöbel'], hint: 'Möbel zum Arbeiten.' },
  { teil1: 'Blumen', teil2: 'Topf', correct: 'Blumentopf', distract: ['Topfblume','Pflanzgefäß','Topfpflanze'], hint: 'Behälter für Pflanzen.' },
  { teil1: 'Bilder', teil2: 'Rahmen', correct: 'Bilderrahmen', distract: ['Rahmenbild','Bildhülle','Fotorand'], hint: 'Umfasst ein Bild an der Wand.' },
  { teil1: 'Sonnen', teil2: 'Blume', correct: 'Sonnenblume', distract: ['Goldblume','Strahlenblume','Blumensonne'], hint: 'Gelbe Blume, dreht sich nach der Sonne.' },
  { teil1: 'Kühl', teil2: 'Schrank', correct: 'Kühlschrank', distract: ['Schrankkühl','Eiskasten','Frostbox'], hint: 'Hält Lebensmittel kalt.' },
  { teil1: 'Tisch', teil2: 'Decke', correct: 'Tischdecke', distract: ['Deckentisch','Tafeltuch','Esstuch'], hint: 'Liegt auf dem Esstisch.' },
  { teil1: 'Wein', teil2: 'Glas', correct: 'Weinglas', distract: ['Glaswein','Trinkglas','Sektglas'], hint: 'Daraus trinkt man Wein.' },
  { teil1: 'Bett', teil2: 'Decke', correct: 'Bettdecke', distract: ['Deckenbett','Schlafdecke','Daunenbett'], hint: 'Damit deckt man sich nachts zu.' },
  { teil1: 'Garten', teil2: 'Tor', correct: 'Gartentor', distract: ['Torgarten','Gartentür','Hofzugang'], hint: 'Eingang zum Garten.' },
  { teil1: 'Tee', teil2: 'Löffel', correct: 'Teelöffel', distract: ['Löffeltee','Kleinerlöffel','Rührlöffel'], hint: 'Kleiner Löffel zum Umrühren.' },
  { teil1: 'Schnee', teil2: 'Mann', correct: 'Schneemann', distract: ['Mannschnee','Eismann','Winterling'], hint: 'Baut man im Winter aus Schnee.' },
  { teil1: 'Glüh', teil2: 'Birne', correct: 'Glühbirne', distract: ['Birnenglüh','Lichtbirne','Lampenfrucht'], hint: 'Spendet Licht in der Lampe.' },
  { teil1: 'Brief', teil2: 'Kasten', correct: 'Briefkasten', distract: ['Kastenbrief','Posttruhe','Postkasten'], hint: 'Hier wird die Post hineingeworfen.' },
  { teil1: 'Bade', teil2: 'Wanne', correct: 'Badewanne', distract: ['Wannenbad','Duschwanne','Bade-Tonne'], hint: 'Darin nimmt man ein Vollbad.' },
  { teil1: 'Augen', teil2: 'Arzt', correct: 'Augenarzt', distract: ['Arztauge','Sehmedicus','Augendoktor'], hint: 'Spezialist für die Augen.' },
  { teil1: 'Zahn', teil2: 'Bürste', correct: 'Zahnbürste', distract: ['Bürstenzahn','Mundbürste','Zahnpinsel'], hint: 'Damit putzt man die Zähne.' },
  { teil1: 'Hand', teil2: 'Tuch', correct: 'Handtuch', distract: ['Tuchhand','Wischhand','Trockentuch'], hint: 'Trocknet die Hände nach dem Waschen.' },
  { teil1: 'Tee', teil2: 'Kanne', correct: 'Teekanne', distract: ['Kannentee','Heißkanne','Teekrug'], hint: 'Aus diesem Gefäß wird Tee eingeschenkt.' },
  { teil1: 'Wasch', teil2: 'Maschine', correct: 'Waschmaschine', distract: ['Maschinwasch','Wäschegerät','Spülmaschine'], hint: 'Wäscht die Kleidung.' },
  { teil1: 'Spül', teil2: 'Maschine', correct: 'Spülmaschine', distract: ['Maschinenspül','Geschirrgerät','Tellerwäscher'], hint: 'Reinigt das Geschirr.' },
  { teil1: 'Kinder', teil2: 'Wagen', correct: 'Kinderwagen', distract: ['Wagenkind','Babybahn','Kleinwagen'], hint: 'Darin schiebt man Babys spazieren.' },
  { teil1: 'Buch', teil2: 'Laden', correct: 'Buchladen', distract: ['Ladenbuch','Schreibstube','Lesegeschäft'], hint: 'Hier kauft man Bücher.' },
  { teil1: 'Land', teil2: 'Karte', correct: 'Landkarte', distract: ['Kartenland','Wegeplan','Geokarte'], hint: 'Zeigt Städte und Länder.' },
  { teil1: 'Schul', teil2: 'Hof', correct: 'Schulhof', distract: ['Hofschule','Pausenplatz','Spielfeld'], hint: 'Hier toben Kinder in der Pause.' },
  { teil1: 'Bauern', teil2: 'Hof', correct: 'Bauernhof', distract: ['Hofbauer','Landgut','Feldhof'], hint: 'Wo Tiere und Felder bewirtschaftet werden.' },
  { teil1: 'Fern', teil2: 'Seher', correct: 'Fernseher', distract: ['Seherfern','Bildkasten','Schaukasten'], hint: 'Zeigt bewegte Bilder im Wohnzimmer.' },
  { teil1: 'Kopf', teil2: 'Hörer', correct: 'Kopfhörer', distract: ['Hörerkopf','Ohrenstöpsel','Klangbecher'], hint: 'Damit hört man Musik allein.' },
  { teil1: 'Stand', teil2: 'Uhr', correct: 'Standuhr', distract: ['Uhrstand','Bodenuhr','Pendeluhr'], hint: 'Große Uhr, die im Wohnzimmer steht.' },
  { teil1: 'Wand', teil2: 'Uhr', correct: 'Wanduhr', distract: ['Uhrwand','Hängeuhr','Mauerzeit'], hint: 'Hängt an der Wand.' },
  { teil1: 'Arm', teil2: 'Banduhr', correct: 'Armbanduhr', distract: ['Banduhrarm','Handgelenkuhr','Armzeit'], hint: 'Trägt man am Handgelenk.' },
  { teil1: 'Wein', teil2: 'Trauben', correct: 'Weintrauben', distract: ['Traubenwein','Beerenwein','Süßtrauben'], hint: 'Daraus wird Wein gekeltert.' },
  { teil1: 'Apfel', teil2: 'Saft', correct: 'Apfelsaft', distract: ['Saftapfel','Obstsaft','Süßapfel'], hint: 'Beliebtes Getränk aus Äpfeln.' },
  { teil1: 'Mehl', teil2: 'Speise', correct: 'Mehlspeise', distract: ['Speisemehl','Backwerk','Süßspeise'], hint: 'Süßspeise aus Mehl wie Knödel oder Strudel.' },
  { teil1: 'Brat', teil2: 'Kartoffel', correct: 'Bratkartoffel', distract: ['Kartoffelbrat','Pfannenkartoffel','Knusperkartoffel'], hint: 'In der Pfanne gebratene Kartoffel.' },
  { teil1: 'Kühl', teil2: 'Truhe', correct: 'Kühltruhe', distract: ['Truhekühl','Eistruhe','Kältekiste'], hint: 'Friert Lebensmittel ein.' },
  { teil1: 'Sport', teil2: 'Schuh', correct: 'Sportschuh', distract: ['Schuhsport','Laufschuh','Trainingsschuh'], hint: 'Schuhe zum Joggen oder Turnen.' },
  { teil1: 'Vor', teil2: 'Hang', correct: 'Vorhang', distract: ['Hangvor','Fenstertuch','Wandstoff'], hint: 'Stoff vor dem Fenster.' },
  { teil1: 'Tee', teil2: 'Beutel', correct: 'Teebeutel', distract: ['Beuteltee','Tüten-Tee','Sackerl'], hint: 'Damit zieht man Tee auf.' },
  { teil1: 'Müll', teil2: 'Eimer', correct: 'Mülleimer', distract: ['Eimermüll','Abfallkorb','Müllkasten'], hint: 'Hier wirft man Abfall hinein.' },
  { teil1: 'Schlaf', teil2: 'Zimmer', correct: 'Schlafzimmer', distract: ['Zimmerschlaf','Bettstube','Nachtraum'], hint: 'Wo das Bett steht.' },
  { teil1: 'Wohn', teil2: 'Zimmer', correct: 'Wohnzimmer', distract: ['Zimmerwohn','Salon','Aufenthaltsraum'], hint: 'Größter Raum zum Entspannen.' },
  { teil1: 'Bade', teil2: 'Zimmer', correct: 'Badezimmer', distract: ['Zimmerbad','Toilettenraum','Waschraum'], hint: 'Mit Dusche, Wanne und WC.' },
  { teil1: 'Lese', teil2: 'Brille', correct: 'Lesebrille', distract: ['Brillelese','Augenglas','Buchhilfe'], hint: 'Setzt man auf zum Bücherlesen.' },
  { teil1: 'Schlüssel', teil2: 'Bund', correct: 'Schlüsselbund', distract: ['Bundschlüssel','Schlüsselring','Hausring'], hint: 'Mehrere Schlüssel zusammen.' },
  { teil1: 'Buch', teil2: 'Stütze', correct: 'Buchstütze', distract: ['Stützebuch','Bücherhalter','Regalstütze'], hint: 'Hält Bücher im Regal aufrecht.' },
  { teil1: 'Garten', teil2: 'Zaun', correct: 'Gartenzaun', distract: ['Zaungarten','Hofzaun','Beetgrenze'], hint: 'Grenze um den Garten.' },
  { teil1: 'Holz', teil2: 'Tür', correct: 'Holztür', distract: ['Türholz','Bretterportal','Massivtür'], hint: 'Tür aus dem Material des Baums.' },
  { teil1: 'Spiegel', teil2: 'Ei', correct: 'Spiegelei', distract: ['Eierspiegel','Bratenei','Pfannenei'], hint: 'Gebraten in der Pfanne, Dotter sichtbar.' },
  { teil1: 'Schoko', teil2: 'Riegel', correct: 'Schokoriegel', distract: ['Riegelschoko','Süßstange','Tafelschoko'], hint: 'Süßer Snack zum Mitnehmen.' },
  { teil1: 'Marmel', teil2: 'Glas', correct: 'Marmeladenglas', distract: ['Glasmarmel','Konfitüregefäß','Süßglas'], hint: 'Behälter für süßen Aufstrich.' },
  { teil1: 'Kaffee', teil2: 'Maschine', correct: 'Kaffeemaschine', distract: ['Maschinenkaffee','Brühapparat','Heißbrüher'], hint: 'Macht Kaffee in der Küche.' },
  { teil1: 'Tee', teil2: 'Tasse', correct: 'Teetasse', distract: ['Tassentee','Heißtasse','Ohrenkrug'], hint: 'Daraus trinkt man heißen Tee.' },
  { teil1: 'Wein', teil2: 'Keller', correct: 'Weinkeller', distract: ['Kellerwein','Tropfenraum','Reifekammer'], hint: 'Unten im Haus, kühl, lagert Flaschen.' },
  { teil1: 'Sonnen', teil2: 'Aufgang', correct: 'Sonnenaufgang', distract: ['Aufgangsonne','Tagesbeginn','Lichteinbruch'], hint: 'Wenn die Sonne morgens hochkommt.' },
  { teil1: 'Sonnen', teil2: 'Untergang', correct: 'Sonnenuntergang', distract: ['Untergangsonne','Abendrot','Tagesende'], hint: 'Wenn die Sonne abends verschwindet.' },
  { teil1: 'Mond', teil2: 'Schein', correct: 'Mondschein', distract: ['Scheinmond','Nachtlicht','Lunaschein'], hint: 'Helles Licht des Mondes nachts.' },
  { teil1: 'Tag', teil2: 'Licht', correct: 'Tageslicht', distract: ['Lichttag','Sonnenstrahl','Mittagsschein'], hint: 'Was in einem hellen Zimmer scheint.' },
  { teil1: 'Geld', teil2: 'Beutel', correct: 'Geldbeutel', distract: ['Beutelgeld','Münzhalter','Geldsack'], hint: 'Hier liegen die Münzen und Scheine.' },
  { teil1: 'Geld', teil2: 'Schein', correct: 'Geldschein', distract: ['Scheingeld','Banknote','Wertpapier'], hint: 'Stück Papier mit Wert.' },
  { teil1: 'Bahn', teil2: 'Steig', correct: 'Bahnsteig', distract: ['Steigbahn','Gleisplatform','Wartebahn'], hint: 'Wo man auf den Zug wartet.' },
  { teil1: 'Hand', teil2: 'Werker', correct: 'Handwerker', distract: ['Werkerhand','Bauhelfer','Selbermacher'], hint: 'Repariert oder baut mit den Händen.' },
  { teil1: 'Tag', teil2: 'Buch', correct: 'Tagebuch', distract: ['Buchtag','Notizband','Stundenheft'], hint: 'Hier schreibt man, was man erlebt hat.' },
  { teil1: 'Reise', teil2: 'Pass', correct: 'Reisepass', distract: ['Passreise','Ausweispapier','Grenzdokument'], hint: 'Braucht man im Ausland.' },
  { teil1: 'Wein', teil2: 'Berg', correct: 'Weinberg', distract: ['Bergwein','Rebenhang','Trauben-Hügel'], hint: 'Hügel mit Reben.' },
  { teil1: 'Vogel', teil2: 'Käfig', correct: 'Vogelkäfig', distract: ['Käfigvogel','Federgehege','Tierkasten'], hint: 'Drahtgehege für Wellensittiche.' },
  { teil1: 'Hand', teil2: 'Schuh', correct: 'Handschuh', distract: ['Schuhhand','Fingerschuh','Lederhand'], hint: 'Wärmt die Finger im Winter.' },
  { teil1: 'Kuchen', teil2: 'Form', correct: 'Kuchenform', distract: ['Formkuchen','Backschale','Tortenring'], hint: 'In dieser Backform wird der Teig zum Kuchen.' },
  { teil1: 'Pfann', teil2: 'Kuchen', correct: 'Pfannkuchen', distract: ['Kuchenpfann','Crepe','Eierfladen'], hint: 'Dünner runder Teig in der Pfanne.' },
  { teil1: 'Reise', teil2: 'Tasche', correct: 'Reisetasche', distract: ['Taschenreise','Koffer','Trolley'], hint: 'Trägt man auf eine Reise.' },
  { teil1: 'Wett', teil2: 'Kampf', correct: 'Wettkampf', distract: ['Kampfwett','Sportduell','Konkurrenz'], hint: 'Sportlicher Wettstreit.' },
  { teil1: 'Schlaf', teil2: 'Anzug', correct: 'Schlafanzug', distract: ['Anzugschlaf','Nachthemd','Pyjama-Outfit'], hint: 'Trägt man im Bett.' },
  { teil1: 'Kühl', teil2: 'Tasche', correct: 'Kühltasche', distract: ['Taschenkühl','Eisbox','Frostbeutel'], hint: 'Hält Getränke beim Picknick kalt.' },
  { teil1: 'Sport', teil2: 'Verein', correct: 'Sportverein', distract: ['Vereinsport','Bewegungsclub','Sportbund'], hint: 'Wo man gemeinsam Sport treibt.' },
  { teil1: 'Garten', teil2: 'Schere', correct: 'Gartenschere', distract: ['Scherengarten','Heckenschnitt','Pflanzenscherer'], hint: 'Schneidet Hecken und Sträucher.' },
  { teil1: 'Frucht', teil2: 'Saft', correct: 'Fruchtsaft', distract: ['Saftfrucht','Obstsaft','Süßgetränk'], hint: 'Aus gepresstem Obst.' },
  { teil1: 'Schwimm', teil2: 'Bad', correct: 'Schwimmbad', distract: ['Badschwimm','Wasserbecken','Hallenbad'], hint: 'Hier schwimmt man im Sommer.' },
  { teil1: 'Eis', teil2: 'Becher', correct: 'Eisbecher', distract: ['Becher-Eis','Eis-Glas','Kühlglas'], hint: 'Daraus löffelt man Eis.' },
  { teil1: 'Klein', teil2: 'Geld', correct: 'Kleingeld', distract: ['Geldklein','Wechselgeld','Münzgeld'], hint: 'Münzen in der Hosentasche.' },
  { teil1: 'Tag', teil2: 'Decke', correct: 'Tagesdecke', distract: ['Deckentag','Kuscheltuch','Plaid'], hint: 'Liegt tagsüber auf dem Bett.' },
  { teil1: 'Hoch', teil2: 'Zeit', correct: 'Hochzeit', distract: ['Zeithoch','Heiratstag','Trauung'], hint: 'Tag der Eheschließung.' },
  { teil1: 'Ehe', teil2: 'Frau', correct: 'Ehefrau', distract: ['Frauehe','Heiratsfrau','Gemahlin'], hint: 'Verheiratete Partnerin.' },
  { teil1: 'Kinder', teil2: 'Garten', correct: 'Kindergarten', distract: ['Gartenkinder','Spielhof','Vorschule'], hint: 'Wo Kleinkinder vor der Schule hingehen.' },
  { teil1: 'Heim', teil2: 'Weh', correct: 'Heimweh', distract: ['Wehheim','Sehnsucht','Vermissen'], hint: 'Sehnsucht nach Zuhause.' },
  { teil1: 'Fern', teil2: 'Weh', correct: 'Fernweh', distract: ['Wehfern','Reiselust','Auslandstraum'], hint: 'Lust auf weite Reisen.' },
  { teil1: 'Frei', teil2: 'Tag', correct: 'Freitag', distract: ['Tagfrei','Wochenende','Feiertag'], hint: 'Letzter Werktag der Woche.' },
  { teil1: 'Sonn', teil2: 'Tag', correct: 'Sonntag', distract: ['Tagsonn','Wochenende','Ruhetag'], hint: 'Tag der Kirche und Ruhe.' },
  { teil1: 'Mit', teil2: 'Tag', correct: 'Mittag', distract: ['Tagmit','Hochzeit','Mittagsstunde'], hint: 'Wann man zu Mittag isst.' },
];

// === REIHENFOLGEN — Sortiere nach Größe/Alter/Zeit ===
// Format: { kriterium, items: [in falscher Reihenfolge], correct: 'Antwort die nicht passt' }
// Variante: zwei Paare werden gezeigt, Patient muss das eine wählen das richtig sortiert ist
const POOL_REIHENFOLGE = [
  { prompt: 'Was ist GRÖSSER?', a: 'Elefant', b: 'Maus', correct: 'Elefant', extra: ['Käfer','Wal','Pferd'] },
  { prompt: 'Was ist KLEINER?', a: 'Stadt', b: 'Dorf', correct: 'Dorf', extra: ['Land','Hauptstadt','Reich'] },
  { prompt: 'Was kommt FRÜHER im Jahr?', a: 'März', b: 'September', correct: 'März', extra: ['Dezember','November','Oktober'] },
  { prompt: 'Was ist SCHWERER?', a: 'Stein', b: 'Feder', correct: 'Stein', extra: ['Watte','Blatt','Faden'] },
  { prompt: 'Was ist HEISSER?', a: 'Eis', b: 'Feuer', correct: 'Feuer', extra: ['Schnee','Frost','Wasser'] },
  { prompt: 'Was ist HÖHER?', a: 'Berg', b: 'Hügel', correct: 'Berg', extra: ['Tal','Schlucht','Senke'] },
  { prompt: 'Was kommt FRÜHER am Tag?', a: 'Mittag', b: 'Morgen', correct: 'Morgen', extra: ['Abend','Nacht','Sonntag'] },
  { prompt: 'Was ist LÄNGER?', a: 'Stunde', b: 'Minute', correct: 'Stunde', extra: ['Sekunde','Augenblick','Moment'] },
  { prompt: 'Was ist SCHNELLER?', a: 'Auto', b: 'Fahrrad', correct: 'Auto', extra: ['Fußgänger','Schnecke','Käfer'] },
  { prompt: 'Was ist ÄLTER?', a: 'Großvater', b: 'Enkel', correct: 'Großvater', extra: ['Baby','Kind','Schüler'] },
  { prompt: 'Was kommt SPÄTER im Jahr?', a: 'Januar', b: 'Dezember', correct: 'Dezember', extra: ['Februar','März','April'] },
  { prompt: 'Was ist KÄLTER?', a: 'Frühling', b: 'Winter', correct: 'Winter', extra: ['Sommer','Herbst','August'] },
  { prompt: 'Was ist WERTVOLLER?', a: 'Gold', b: 'Eisen', correct: 'Gold', extra: ['Holz','Stein','Sand'] },
  { prompt: 'Was ist GRÖSSER?', a: 'Berlin', b: 'Konstanz', correct: 'Berlin', extra: ['Singen','Friedrichshafen','Meckenbeuren'] },
  { prompt: 'Was kommt VORHER im Alphabet?', a: 'M', b: 'X', correct: 'M', extra: ['Z','Y','W'] },
  { prompt: 'Was ist NÄHER an der Sonne?', a: 'Erde', b: 'Pluto', correct: 'Erde', extra: ['Saturn','Neptun','Uranus'] },
  { prompt: 'Was ist LEISER?', a: 'Flüstern', b: 'Schreien', correct: 'Flüstern', extra: ['Donnern','Brüllen','Krachen'] },
  { prompt: 'Was ist FRISCHER?', a: 'Heutige Brötchen', b: 'Brötchen von gestern', correct: 'Heutige Brötchen', extra: ['Vorwoche','Letzten Monat','Vorletztes Jahr'] },
  { prompt: 'Was ist TEURER?', a: 'Auto', b: 'Brot', correct: 'Auto', extra: ['Bonbon','Stift','Brötchen'] },
  { prompt: 'Was ist SÜSSER?', a: 'Honig', b: 'Zitrone', correct: 'Honig', extra: ['Essig','Salz','Pfeffer'] },
  { prompt: 'Was ist SAURER?', a: 'Zitrone', b: 'Banane', correct: 'Zitrone', extra: ['Honig','Zucker','Brot'] },
  { prompt: 'Was ist BITTERER?', a: 'Bier', b: 'Limonade', correct: 'Bier', extra: ['Saft','Wasser','Tee'] },
  { prompt: 'Was ist HÄRTER?', a: 'Diamant', b: 'Holz', correct: 'Diamant', extra: ['Watte','Brot','Stoff'] },
  { prompt: 'Was ist WEICHER?', a: 'Watte', b: 'Stein', correct: 'Watte', extra: ['Eisen','Holz','Glas'] },
  { prompt: 'Was ist DÜNNER?', a: 'Faden', b: 'Seil', correct: 'Faden', extra: ['Tau','Kette','Brett'] },
  { prompt: 'Was ist DICKER?', a: 'Baumstamm', b: 'Zweig', correct: 'Baumstamm', extra: ['Halm','Stiel','Stab'] },
  { prompt: 'Was ist HELLER?', a: 'Sonne', b: 'Kerze', correct: 'Sonne', extra: ['Streichholz','Glühwürmchen','Mond'] },
  { prompt: 'Was ist DUNKLER?', a: 'Mitternacht', b: 'Mittag', correct: 'Mitternacht', extra: ['Morgen','Mittag','Vormittag'] },
  { prompt: 'Was ist LAUTER?', a: 'Donner', b: 'Flüstern', correct: 'Donner', extra: ['Atmen','Tropfen','Wind'] },
  { prompt: 'Was ist NÄHER?', a: 'Mond', b: 'Sonne', correct: 'Mond', extra: ['Mars','Jupiter','Saturn'] },
  { prompt: 'Was ist WEITER WEG?', a: 'Mars', b: 'Mond', correct: 'Mars', extra: ['Wolke','Berg','Stadt'] },
  { prompt: 'Was kommt FRÜHER im Leben?', a: 'Kindheit', b: 'Alter', correct: 'Kindheit', extra: ['Rente','Großeltern','Witwer'] },
  { prompt: 'Was kommt SPÄTER im Leben?', a: 'Alter', b: 'Kindheit', correct: 'Alter', extra: ['Geburt','Baby','Kindergarten'] },
  { prompt: 'Was ist STÄRKER?', a: 'Elefant', b: 'Maus', correct: 'Elefant', extra: ['Käfer','Spatz','Schmetterling'] },
  { prompt: 'Was ist SCHWÄCHER?', a: 'Baby', b: 'Mann', correct: 'Baby', extra: ['Riese','Bär','Kraftsportler'] },
  { prompt: 'Was ist HÄUFIGER zu sehen?', a: 'Spatz', b: 'Adler', correct: 'Spatz', extra: ['Pinguin','Strauß','Pelikan'] },
  { prompt: 'Was ist SELTENER zu sehen?', a: 'Tiger', b: 'Hund', correct: 'Tiger', extra: ['Spatz','Taube','Maus'] },
  { prompt: 'Was kommt am ANFANG des Alphabets?', a: 'A', b: 'Z', correct: 'A', extra: ['Y','X','W'] },
  { prompt: 'Was kommt am ENDE des Alphabets?', a: 'Z', b: 'A', correct: 'Z', extra: ['B','C','D'] },
  { prompt: 'Was ist FRÜHER am Tag?', a: 'Frühstück', b: 'Abendessen', correct: 'Frühstück', extra: ['Mitternacht','Schlafenszeit','spät'] },
  { prompt: 'Was ist SPÄTER am Tag?', a: 'Abendessen', b: 'Frühstück', correct: 'Abendessen', extra: ['Sonnenaufgang','Morgen','Vormittag'] },
  { prompt: 'Was ist GIFTIGER?', a: 'Tollkirsche', b: 'Kirsche', correct: 'Tollkirsche', extra: ['Apfel','Banane','Birne'] },
  { prompt: 'Was ist WÄRMER?', a: 'Kaffee', b: 'Eis', correct: 'Kaffee', extra: ['Schnee','Eiswürfel','Kühlschrank'] },
  { prompt: 'Was ist ÄLTER?', a: 'Pyramiden', b: 'Eiffelturm', correct: 'Pyramiden', extra: ['Auto','Computer','Telefon'] },
  { prompt: 'Was ist NEUER?', a: 'Smartphone', b: 'Schreibmaschine', correct: 'Smartphone', extra: ['Faustkeil','Pferdekutsche','Postkarte'] },
  { prompt: 'Was ist GESÜNDER?', a: 'Apfel', b: 'Schokolade', correct: 'Apfel', extra: ['Bonbon','Chips','Kekse'] },
  { prompt: 'Was ist UNGESÜNDER?', a: 'Zigarette', b: 'Wasser', correct: 'Zigarette', extra: ['Salat','Obst','Tee'] },
  { prompt: 'Was ist BEKANNTER?', a: 'Eiffelturm', b: 'Wasserturm in Konstanz', correct: 'Eiffelturm', extra: ['Hecke','Schuppen','Briefkasten'] },
  { prompt: 'Was kommt im Sommer FRÜHER?', a: 'Juni', b: 'August', correct: 'Juni', extra: ['Oktober','November','Dezember'] },
  { prompt: 'Was ist KÜRZER?', a: 'Sekunde', b: 'Minute', correct: 'Sekunde', extra: ['Stunde','Tag','Woche'] },
  { prompt: 'Was ist LÄNGER?', a: 'Jahr', b: 'Monat', correct: 'Jahr', extra: ['Tag','Stunde','Sekunde'] },
  { prompt: 'Was ist BREITER?', a: 'Autobahn', b: 'Fußweg', correct: 'Autobahn', extra: ['Trampelpfad','Trottoir','Bachlauf'] },
  { prompt: 'Was ist SCHMALER?', a: 'Bleistift', b: 'Baumstamm', correct: 'Bleistift', extra: ['Säule','Tonne','Tisch'] },
  { prompt: 'Was kommt VORHER beim Backen?', a: 'Teig kneten', b: 'Brot essen', correct: 'Teig kneten', extra: ['Brot servieren','Brot schneiden','Teller waschen'] },
  { prompt: 'Was kommt VORHER beim Anziehen?', a: 'Socken', b: 'Schuhe', correct: 'Socken', extra: ['Mantel','Hut','Schal'] },
  { prompt: 'Was kommt SPÄTER beim Anziehen?', a: 'Schuhe', b: 'Socken', correct: 'Schuhe', extra: ['Unterhose','Hemd','Hose'] },
  { prompt: 'Was ist TIEFER?', a: 'Meer', b: 'Pfütze', correct: 'Meer', extra: ['Bach','Teich','Brunnen'] },
  { prompt: 'Was ist FLACHER?', a: 'Pfütze', b: 'Ozean', correct: 'Pfütze', extra: ['Brunnen','Tunnel','Schacht'] },
  { prompt: 'Was kommt FRÜHER in der Geschichte?', a: 'Steinzeit', b: 'Internet', correct: 'Steinzeit', extra: ['Computer','Handy','Auto'] },
  { prompt: 'Was kostet MEHR?', a: 'Haus', b: 'Brot', correct: 'Haus', extra: ['Kaugummi','Bonbon','Stift'] },
  { prompt: 'Was kostet WENIGER?', a: 'Brötchen', b: 'Auto', correct: 'Brötchen', extra: ['Haus','Yacht','Schmuck'] },
  { prompt: 'Was ist HEISSER?', a: 'Kochendes Wasser', b: 'Lauwarmes Wasser', correct: 'Kochendes Wasser', extra: ['Eiswasser','Schneematsch','Frostflüssigkeit'] },
  { prompt: 'Was kommt FRÜHER auf dem Kalender?', a: 'Ostern', b: 'Weihnachten', correct: 'Ostern', extra: ['Silvester','Nikolaus','Heiligabend'] },
  { prompt: 'Was ist GRÖSSER?', a: 'Erde', b: 'Mond', correct: 'Erde', extra: ['Sandkorn','Apfel','Tasse'] },
  { prompt: 'Was ist KLEINER?', a: 'Maus', b: 'Pferd', correct: 'Maus', extra: ['Wal','Kuh','Ziege'] },
  { prompt: 'Was kommt FRÜHER beim Essen?', a: 'Vorspeise', b: 'Nachtisch', correct: 'Vorspeise', extra: ['Aperitif','Kaffee','Schnaps'] },
  { prompt: 'Was kommt SPÄTER beim Essen?', a: 'Dessert', b: 'Suppe', correct: 'Dessert', extra: ['Vorspeise','Aperitif','Salat'] },
  { prompt: 'Was ist NÄHER zu Konstanz?', a: 'Bodensee', b: 'Atlantik', correct: 'Bodensee', extra: ['Sahara','Australien','Mond'] },
  { prompt: 'Was ist WEITER ENTFERNT?', a: 'Mars', b: 'Mond', correct: 'Mars', extra: ['Wolke','Berg','Stadt'] },
  { prompt: 'Was kommt FRÜHER im Lebensjahr?', a: 'Geburtstag im Mai', b: 'Geburtstag im November', correct: 'Geburtstag im Mai', extra: ['Geburtstag im Dezember','Silvester','Heiligabend'] },
  { prompt: 'Was ist HELLER beleuchtet?', a: 'Bühne im Theater', b: 'Keller bei Nacht', correct: 'Bühne im Theater', extra: ['Höhle','Schrank','Tunnel'] },
  { prompt: 'Was kommt FRÜHER beim Tag?', a: 'Sonnenaufgang', b: 'Sonnenuntergang', correct: 'Sonnenaufgang', extra: ['Mitternacht','Schlafenszeit','spät'] },
  { prompt: 'Was ist KÄLTER?', a: 'Nordpol', b: 'Sahara', correct: 'Nordpol', extra: ['Tropen','Wüste','Süden'] },
  { prompt: 'Was ist WÄRMER?', a: 'Sommer', b: 'Winter', correct: 'Sommer', extra: ['Herbstanfang','Frühlingsmorgen','Eis'] },
  { prompt: 'Was kommt FRÜHER beim Backen?', a: 'Teig kneten', b: 'Kuchen anschneiden', correct: 'Teig kneten', extra: ['Reste essen','Geschirr spülen','Tisch decken'] },
  { prompt: 'Was kostet MEHR?', a: 'Gold', b: 'Holz', correct: 'Gold', extra: ['Sand','Kies','Stroh'] },
  { prompt: 'Was kostet WENIGER?', a: 'Kaugummi', b: 'Auto', correct: 'Kaugummi', extra: ['Yacht','Villa','Diamant'] },
  { prompt: 'Was ist HÄUFIGER auf einer Wiese?', a: 'Grashalm', b: 'Elefant', correct: 'Grashalm', extra: ['Eisbär','Wal','Pinguin'] },
  { prompt: 'Was ist SELTENER zu finden?', a: 'Diamant', b: 'Sand', correct: 'Diamant', extra: ['Stein','Erde','Lehm'] },
  { prompt: 'Was ist BUNTER?', a: 'Regenbogen', b: 'Aschegrau', correct: 'Regenbogen', extra: ['Schwarzweiß','Nebel','Schatten'] },
  { prompt: 'Was kommt FRÜHER beim Tag?', a: 'Frühstück', b: 'Mittagessen', correct: 'Frühstück', extra: ['Abendessen','Mitternacht','Nachtsnack'] },
  { prompt: 'Was ist HÖHER vom Boden?', a: 'Kirchturm', b: 'Hocker', correct: 'Kirchturm', extra: ['Schwelle','Treppenstufe','Blume'] },
  { prompt: 'Was ist NIEDRIGER?', a: 'Kellergeschoss', b: 'Dachboden', correct: 'Kellergeschoss', extra: ['Sterne','Wolke','Adlerhorst'] },
  { prompt: 'Was ist GRÖSSER an Fläche?', a: 'Bodensee', b: 'Tümpel', correct: 'Bodensee', extra: ['Pfütze','Pool','Brunnen'] },
  { prompt: 'Was ist VOLUMINÖSER?', a: 'Heißluftballon', b: 'Apfel', correct: 'Heißluftballon', extra: ['Erbse','Kichererbse','Korn'] },
  { prompt: 'Was kommt FRÜHER beim Aufwachen?', a: 'Wecker klingelt', b: 'Frühstück fertig', correct: 'Wecker klingelt', extra: ['Mittagessen','Abendessen','Schlafenszeit'] },
  { prompt: 'Was kommt SPÄTER beim Aufstehen?', a: 'Schuhe anziehen', b: 'Pyjama ausziehen', correct: 'Schuhe anziehen', extra: ['Bett liegen','Träumen','Schnarchen'] },
  { prompt: 'Was ist GIFTIGER?', a: 'Tollkirsche', b: 'Heidelbeere', correct: 'Tollkirsche', extra: ['Apfel','Birne','Banane'] },
  { prompt: 'Was ist SICHERER zu essen?', a: 'Champignon vom Markt', b: 'Pilz aus dem Wald (unbekannt)', correct: 'Champignon vom Markt', extra: ['Wurzel ohne Bestimmung','Beere unbekannt','Blatt unbekannt'] },
  { prompt: 'Was ist BEKANNTER weltweit?', a: 'Eiffelturm', b: 'Wasserturm in Singen', correct: 'Eiffelturm', extra: ['Bushaltestelle X','Briefkasten Y','Hauseingang'] },
  { prompt: 'Was ist BERÜHMTER?', a: 'Mona Lisa', b: 'Beliebiges Familienfoto', correct: 'Mona Lisa', extra: ['Selfie','Schnappschuss','Hochzeitsbild'] },
  { prompt: 'Was kommt FRÜHER in der Geschichte?', a: 'Steinzeit', b: 'Internet-Zeitalter', correct: 'Steinzeit', extra: ['Smartphone','Computer','Auto'] },
  { prompt: 'Was kommt SPÄTER in der Geschichte?', a: 'Smartphone', b: 'Faustkeil', correct: 'Smartphone', extra: ['Speer','Pfeil und Bogen','Steinaxt'] },
  { prompt: 'Was ist SCHWÄCHER?', a: 'Babys Griff', b: 'Kraftsportler', correct: 'Babys Griff', extra: ['Bär','Riese','Hercules'] },
  { prompt: 'Was ist STÄRKER?', a: 'Pferd', b: 'Maus', correct: 'Pferd', extra: ['Käfer','Ameise','Wurm'] },
  { prompt: 'Was kommt FRÜHER in der Klassik?', a: 'Mozart', b: 'Beatles', correct: 'Mozart', extra: ['Heutige Popmusik','Modern Jazz','Rap'] },
  { prompt: 'Was ist FRISCHER?', a: 'Heutiges Brot', b: 'Brot von letzter Woche', correct: 'Heutiges Brot', extra: ['Brot vom Vorjahr','Schimmelbrot','Steinbrot'] },
];



// ===========================================================================
// KI-Adaption (Schwierigkeit, Personen-Tracking, Repeat-Queue)
// ===========================================================================
function recordAnswer(typeId, wasCorrect, taskSnapshot) {
  const s = skill[typeId];
  s.history.push(wasCorrect ? 1 : 0);
  if (s.history.length > 10) s.history.shift();
  if (wasCorrect) {
    s.correct++;
    const last2 = s.history.slice(-2);
    if (last2.length === 2 && last2.every(x => x === 1) && s.level < 5) s.level++;
  } else {
    s.wrong++;
    if (s.level > 1) s.level--;
    if (typeId !== 'recognize') {
      const dueIn = 3 + Math.floor(Math.random() * 3);
      repeatQueue.push({ taskId: 'r_' + Date.now(), dueAfterTaskCount: sessionStats.total + dueIn, type: typeId, snapshot: taskSnapshot });
    }
  }
  if (typeId === 'recognize' && taskSnapshot._personName) {
    const name = taskSnapshot._personName;
    if (!personStats[name]) personStats[name] = { correct: 0, wrong: 0, lastAskedAt: 0, lastResult: null };
    personStats[name].lastAskedAt = sessionStats.total;
    personStats[name].lastResult = wasCorrect ? 'correct' : 'wrong';
    if (wasCorrect) personStats[name].correct++; else personStats[name].wrong++;
  }
  sessionStats.total++;
  if (wasCorrect) sessionStats.correct++;
  saveState();
}

function getDueRepeat(activeIds) {
  // Nur Repeats deren Type aktuell aktiv ist
  const idx = repeatQueue.findIndex(r =>
    r.dueAfterTaskCount <= sessionStats.total &&
    (!activeIds || activeIds.includes(r.type))
  );
  if (idx >= 0) {
    const r = repeatQueue[idx];
    repeatQueue.splice(idx, 1);
    return r;
  }
  return null;
}

function aiPickTaskType() {
  // PFLICHT: Wenn ein Memory-Symbol aktiv gemerkt wird, MUSS die Folge-Aufgabe Memory sein
  if (typeof memoryShown !== 'undefined' && memoryShown) return 'memory';

  // Stadium-Filter: Aufgabentypen nur ab ihrer minStage zulassen
  const typesByMinStage = {};
  for (const t of TASK_TYPES) typesByMinStage[t.id] = t.minStage || 1;

  const active = Object.entries(activeTypes || {})
    .filter(([id, v]) => v && (typesByMinStage[id] || 1) <= dementiaStage)
    .map(([k]) => k);
  if (active.length === 0) {
    // Wenn keiner zum Stadium passt, einen schwierigen Default nehmen
    return 'homonyms';
  }
  const t = sessionStats.total;
  const recognizeActive = active.includes('recognize');

  // === STADIUM-BASIERTE PERSONEN-FREQUENZ ===
  // Stadium 1-3: AUSSCHLIESSLICH Gehirnjogging — keine Personen-Aufgaben
  // Stadium 4-5: Personen sehr selten — etwa jede 15. Aufgabe
  // Stadium 6-7: Personen mittel — etwa jede 12. Aufgabe
  // Stadium 8-10: Personen häufig — etwa jede 10. Aufgabe
  // Bei jedem Stadium: keine direkte Wiederholung von Personen
  let forceRecognize = false, blockRecognize = false;
  if (recognizeActive && people.length >= 2 && dementiaStage >= 4) {
    const sinceLastRecognize = t - lastRecognizeAt;
    // Ziel-Abstand pro Stadium
    let targetGap;
    if (dementiaStage <= 5) targetGap = 15;
    else if (dementiaStage <= 7) targetGap = 12;
    else targetGap = 10;
    // Mindest-Abstand: nie zwei Personen direkt hintereinander
    const minGap = Math.max(2, Math.floor(targetGap * 0.7));
    if (sinceLastRecognize < minGap) {
      blockRecognize = true;
    } else if (sinceLastRecognize >= targetGap) {
      // Erzwingen, wenn der Abstand erreicht ist
      forceRecognize = true;
    }
    // Bei Schwächen: gezielt wiederholen wenn Mindestabstand erreicht
    const hasWeakPerson = Object.values(personStats).some(s =>
      s.lastResult === 'wrong' && (t - s.lastAskedAt) >= targetGap
    );
    if (hasWeakPerson && sinceLastRecognize >= minGap) forceRecognize = true;
  } else if (recognizeActive && dementiaStage <= 3) {
    // Stadium 1-3: Personen-Aufgaben komplett blockieren
    blockRecognize = true;
  }

  if (forceRecognize) return 'recognize';
  let pool = active;
  if (blockRecognize) pool = active.filter(a => a !== 'recognize');
  if (pool.length === 0) pool = active;

  // Gewichtungs-Map: bestimmte Aufgabentypen kommen seltener oder häufiger
  const weights = {
    whereIsThis: 0.25,  // Wahrzeichen: selten
    memory:      0.5,
    allgemein:   1.5,   // Allgemeinwissen (Hauptstädte, Automarken etc.) öfter
  };

  // Gewichtetes Pool: jeden Typ entsprechend oft eintragen
  const weightedPool = [];
  for (const id of pool) {
    const w = weights[id] !== undefined ? weights[id] : 1;
    // Mindestens 1× drin (für Round-Robin), aber gewichtet erhöht
    const count = Math.max(1, Math.round(w * 4));
    for (let i = 0; i < count; i++) weightedPool.push(id);
  }

  // Bevorzuge schwache Typen, sonst zufällig aus gewichtetem Pool
  const sorted = [...pool].sort((a, b) => {
    const sa = skill[a], sb = skill[b];
    const rateA = sa.correct + sa.wrong > 0 ? sa.correct / (sa.correct + sa.wrong) : 0.5;
    const rateB = sb.correct + sb.wrong > 0 ? sb.correct / (sb.correct + sb.wrong) : 0.5;
    return rateA - rateB;
  });
  // 30% Schwächen-fokussiert, 70% gewichtet zufällig
  if (Math.random() < 0.3 && sorted.length > 0) {
    // Auch hier auf Gewichtung achten — wenn schwächste Aufgabe whereIsThis, mit Wahrscheinlichkeit überspringen
    const candidate = sorted[0];
    const w = weights[candidate] !== undefined ? weights[candidate] : 1;
    if (Math.random() < w) return candidate;
  }
  return weightedPool[Math.floor(Math.random() * weightedPool.length)];
}

// ===========================================================================
// AUFGABEN-GENERATOREN
// ===========================================================================
function makeRecognize(level) {
  if (people.length < 2) return null;
  const t = sessionStats.total;
  let target;
  const weakPersons = people.filter(p => {
    const ps = personStats[p.name];
    return ps && ps.lastResult === 'wrong' && (t - ps.lastAskedAt) >= 18 && (t - ps.lastAskedAt) <= 30;
  });
  if (weakPersons.length > 0) {
    target = pickRandom(weakPersons);
  } else {
    // Lieber Personen wählen, die nicht in den letzten Aufgaben drankamen
    const fresh = people.filter(p => !isRecent('recognize', p.name));
    const pool = fresh.length > 0 ? fresh : people;
    const ranked = [...pool].sort((a, b) => {
      const psa = personStats[a.name] || { lastAskedAt: -999 };
      const psb = personStats[b.name] || { lastAskedAt: -999 };
      return psa.lastAskedAt - psb.lastAskedAt;
    });
    target = Math.random() < 0.7 ? ranked[0] : pickRandom(pool);
  }
  rememberRecent('recognize', target.name, people.length);
  lastRecognizeAt = t;
  const numOptions = Math.min(2 + level, 4);
  const distractors = shuffle(people.filter(p => p.name !== target.name)).slice(0, numOptions - 1);
  const opts = shuffle([target, ...distractors]);
  let prompt = `Wer ist das?`;
  if (level <= 2) prompt += ` (${target.relation})`;
  let hint = null;
  if (target.note) hint = target.note;
  else if (level > 2) hint = `Diese Person ist Karls ${target.relation}.`;
  return { prompt, image: target.initial, options: opts.map(o => o.name), correct: target.name, hint, _personName: target.name };
}

// "Was ist das?" / "Welches Essen?" / "Wo ist das?" — generischer Bild-Aufgabe-Generator
// Hilfsfunktion: prüft ob ein Item ein "faires" Bild-Quiz ergibt.
// Das Emoji der richtigen Antwort darf nicht das gleiche sein wie das eines Distractors,
// sonst sieht die Frage so aus als hätte man mehrere richtige Antworten.
function hasUniqueEmoji(item) {
  const correctEmoji = getEmoji(item.keyword);
  if (!correctEmoji) return false;
  // Distractors prüfen: keiner darf das gleiche Emoji haben
  for (const dk of (item.distractKeys || [])) {
    if (getEmoji(dk) === correctEmoji) return false;
    // Auch der Begriff selbst darf nicht das gleiche Emoji haben (etwa weil ein
    // Distractor-Wort und ein anderes synonym auf das gleiche Emoji zeigen)
    if (getEmoji(item.word) === getEmoji(dk)) return false;
  }
  return true;
}

// Generiert 3 Distractors für ein Item, deren Emoji sich vom Hauptbild unterscheidet.
// Pool = Liste aller Items im selben Aufgabentyp (Wer/Wo/Was/Welches Essen).
function smartDistractors(item, pool) {
  const correctEmoji = getEmoji(item.keyword);
  const usedEmojis = new Set([correctEmoji]);
  const result = [];
  // 1) Bestehende distractKeys nutzen, wenn deren Emoji unique ist
  for (const dk of (item.distractKeys || [])) {
    const e = getEmoji(dk);
    if (e && !usedEmojis.has(e)) {
      result.push(dk);
      usedEmojis.add(e);
      if (result.length === 3) return result;
    }
  }
  // 2) Aus dem gleichen Pool weitere Distractors holen
  const candidates = shuffle(pool.filter(p => p.word !== item.word && hasEmoji(p.word)));
  for (const cand of candidates) {
    const e = getEmoji(cand.word);
    if (!usedEmojis.has(e)) {
      result.push(cand.word);
      usedEmojis.add(e);
      if (result.length === 3) return result;
    }
  }
  return result;  // ggf. weniger als 3 — wird vom Caller behandelt
}

function makeBigImageTask(typeId, pool, promptText) {
  // Pool von KI-generierten Aufgaben bevorzugen
  const aiPoolKey = typeId;
  if (aiPool[aiPoolKey] && aiPool[aiPoolKey].length > 0) {
    const idx = aiPool[aiPoolKey].findIndex(t => {
      const kw = (t.bigImage || '').replace('__WIKI__:', '');
      if (!hasEmoji(kw)) return false;
      // Wenn als 'failed' bekannt → überspringen
      if (imageStatus[kw] === 'failed') return false;
      const correctEmoji = getEmoji(kw);
      for (const opt of (t.options || [])) {
        if (opt !== t.correct && getEmoji(opt) === correctEmoji) return false;
      }
      return true;
    });
    if (idx >= 0) {
      const t = aiPool[aiPoolKey].splice(idx, 1)[0];
      rememberRecent(typeId, t.correct, pool.length);
      saveState();
      return t;
    }
  }
  // Aus festem Pool — Items mit Bild-Mapping, aber bekannt-fehlgeschlagene rausfiltern
  const validPool = pool.filter(it => hasEmoji(it.keyword) && imageStatus[it.keyword] !== 'failed');
  if (validPool.length === 0) return null;
  const fresh = validPool.filter(it => !isRecent(typeId, it.word));
  const trial = shuffle(fresh.length > 0 ? fresh : validPool);
  let item = null, distract = null;
  for (const candidate of trial) {
    const d = smartDistractors(candidate, validPool);
    if (d.length === 3) { item = candidate; distract = d; break; }
  }
  if (!item) return null;
  rememberRecent(typeId, item.word, validPool.length);
  const opts = shuffle([item.word, ...distract]);
  return {
    prompt: promptText,
    bigImage: imgUrl(item.keyword),
    options: opts,
    correct: item.word,
    hint: `Es beginnt mit dem Buchstaben „${item.word.charAt(0)}".`,
  };
}

function makeWhatIsIt(level) {
  return makeBigImageTask('whatIsIt', POOL_WHAT_IS_IT, 'Was sehen Sie auf dem Bild?');
}
function makeWhatFood(level) {
  return makeBigImageTask('whatFood', POOL_WHAT_FOOD, 'Welches Essen ist das?');
}
function makeWhereIsThis(level) {
  return makeBigImageTask('whereIsThis', POOL_WHERE_IS_THIS, 'Welches Wahrzeichen ist das?');
}

// "Was passt nicht?" — dynamisch aus Pool-Kombinationen
function makeCategory(level) {
  const poolKeys = Object.keys(POOL_CATEGORIES);
  let mainKey, oddKey, mainItems, oddItem, comboKey;
  let foundCombo = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    mainKey = pickRandom(poolKeys);
    oddKey = pickRandom(poolKeys.filter(k => k !== mainKey));
    const mainPool = POOL_CATEGORIES[mainKey];
    const oddPool = POOL_CATEGORIES[oddKey];
    // Nur Items mit Bild-Mapping verwenden, bekannt-fehlgeschlagene rausfiltern
    const mainCandidates = mainPool.items.filter(it => hasEmoji(it) && imageStatus[it] !== 'failed');
    const oddCandidates = oddPool.items.filter(it => hasEmoji(it) && imageStatus[it] !== 'failed');
    if (mainCandidates.length < 3 || oddCandidates.length < 1) continue;

    // 3 Items aus Hauptkategorie auswählen mit UNTERSCHIEDLICHEN Emojis
    const usedEmojis = new Set();
    const shuffledMain = shuffle([...mainCandidates]);
    const candidate = [];
    for (const name of shuffledMain) {
      const e = getEmoji(name);
      if (!usedEmojis.has(e)) {
        usedEmojis.add(e);
        candidate.push(name);
        if (candidate.length === 3) break;
      }
    }
    if (candidate.length < 3) continue;
    mainItems = candidate;

    // Eindringling: muss ANDERES Emoji haben als alle 3 Hauptitems
    const oddPossible = oddCandidates.filter(name => !usedEmojis.has(getEmoji(name)));
    if (oddPossible.length === 0) continue;
    oddItem = pickRandom(oddPossible);

    comboKey = [...mainItems, oddItem].sort().join('|');
    foundCombo = true;
    if (!isRecent('category', comboKey)) break;
  }
  if (!foundCombo) return null;
  rememberRecent('category', comboKey, 60);
  const allItems = shuffle([...mainItems, oddItem]).map(name => ({
    label: name,
    img: imgUrl(name),
  }));
  return {
    prompt: 'Was passt nicht dazu?',
    imageGrid: allItems,
    correct: oddItem,
    hint: `Drei davon sind ${POOL_CATEGORIES[mainKey].label}.`,
  };
}

function makeProverb(level) {
  if (aiPool.proverb.length > 0) { const t = aiPool.proverb.shift(); rememberRecent('proverb', t.correct, POOL_PROVERBS.length); saveState(); return t; }
  const fresh = POOL_PROVERBS.filter(p => !isRecent('proverb', p.prompt));
  const p = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_PROVERBS);
  rememberRecent('proverb', p.prompt, POOL_PROVERBS.length);
  const numOpts = level <= 2 ? 3 : 4;
  return { prompt: p.prompt, image: '"', options: shuffle([p.correct, ...p.distract.slice(0, numOpts - 1)]), correct: p.correct, hint: p.hint };
}

function makeOpposites(level) {
  if (aiPool.opposites.length > 0) { const t = aiPool.opposites.shift(); rememberRecent('opposites', t.correct, POOL_OPPOSITES.length); saveState(); return t; }
  const fresh = POOL_OPPOSITES.filter(p => !isRecent('opposites', p[0]));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_OPPOSITES);
  rememberRecent('opposites', item[0], POOL_OPPOSITES.length);
  const [word, opp, distract, hint] = item;
  const numOpts = level <= 2 ? 3 : 4;
  return { prompt: `Was ist das Gegenteil von „${word}"?`, image: '⇄', options: shuffle([opp, ...distract.slice(0, numOpts - 1)]), correct: opp, hint };
}

function makeRhymes(level) {
  const fresh = POOL_RHYMES.filter(p => !isRecent('rhymes', p[0]));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_RHYMES);
  rememberRecent('rhymes', item[0], POOL_RHYMES.length);
  const [word, rhyme, distract, hint, kw] = item;
  // Reim-Aufgaben funktionieren ohne Bild — Bild ist nur Beigabe
  return { prompt: `Welches Wort reimt sich auf „${word}"?`, image: '♪',
    options: shuffle([rhyme, ...distract.slice(0,3)]), correct: rhyme, hint };
}

function makeWordpair(level) {
  const fresh = POOL_WORDPAIRS.filter(p => !isRecent('wordpair', p[0]));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_WORDPAIRS);
  rememberRecent('wordpair', item[0], POOL_WORDPAIRS.length);
  const [a, partner, distract, hint, kw] = item;
  return { prompt: `Was gehört zu „${a}"?`, image: '↔',
    options: shuffle([partner, ...distract.slice(0,3)]), correct: partner, hint };
}

function makeSynonyms(level) {
  const fresh = POOL_SYNONYMS.filter(p => !isRecent('synonyms', p[0]));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_SYNONYMS);
  rememberRecent('synonyms', item[0], POOL_SYNONYMS.length);
  const [word, syn, distract, hint] = item;
  const numOpts = level <= 2 ? 3 : 4;
  // Bei Level 5: andere Synonyme als Distractors → alle Optionen sind Synonyme von irgendwas,
  // nur eines passt zum gefragten Wort
  let distractors = distract.slice();
  if (level >= 5) {
    const otherSyns = shuffle(POOL_SYNONYMS
      .filter(p => p[0] !== word)
      .map(p => p[1]));
    if (otherSyns.length >= numOpts - 1) distractors = otherSyns.slice(0, numOpts - 1);
  }
  return {
    prompt: `Was bedeutet dasselbe wie „${word}"?`,
    image: '≡',
    options: shuffle([syn, ...distractors.slice(0, numOpts - 1)]),
    correct: syn,
    hint: level >= 5 ? null : hint
  };
}

function makeWordfind(level) {
  const fresh = POOL_WORDFIND.filter(p => !isRecent('wordfind', p.correct + p.kategorie));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_WORDFIND);
  rememberRecent('wordfind', item.correct + item.kategorie, POOL_WORDFIND.length);
  // Schwierigkeits-Stufen:
  // Level 5: ALLE 3 Distractors aus gleicher Kategorie aber falscher Buchstabe
  //   (sehr schwer — alles plausibel, nur Buchstabe entscheidet)
  // Level 4: 1 Distractor aus gleicher Kategorie
  // Level <=3: zufällige Distractors
  let distractors = item.distract.slice();
  if (level >= 4) {
    const sameCategory = shuffle(POOL_WORDFIND
      .filter(w => w.kategorie === item.kategorie && w.correct !== item.correct)
      .map(w => w.correct));
    if (level >= 5 && sameCategory.length >= 3) {
      distractors = sameCategory.slice(0, 3);
    } else if (sameCategory.length >= 1) {
      distractors[0] = sameCategory[0];
    }
  }
  const numOpts = level <= 2 ? 3 : 4;
  return {
    prompt: `Welches ist ein ${item.kategorie} mit dem Buchstaben „${item.buchstabe}"?`,
    image: item.buchstabe,
    options: shuffle([item.correct, ...distractors.slice(0, numOpts - 1)]),
    correct: item.correct,
    hint: level >= 5 ? null : `Ein ${item.kategorie}, beginnt mit ${item.buchstabe}.`,
  };
}

function makeAnimalKids(level) {
  const fresh = POOL_ANIMAL_KIDS.filter(p => !isRecent('animalKids', p[0]));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_ANIMAL_KIDS);
  rememberRecent('animalKids', item[0], POOL_ANIMAL_KIDS.length);
  const [parent, kid, distract, hint] = item;
  const numOpts = level <= 2 ? 3 : 4;
  // Bei Level 5: alle Distractors sind echte Tierjunge-Bezeichnungen aus dem Pool
  let distractors = distract.slice();
  if (level >= 5) {
    const otherKids = shuffle(POOL_ANIMAL_KIDS
      .filter(p => p[0] !== parent)
      .map(p => p[1]));
    if (otherKids.length >= 3) distractors = otherKids.slice(0, 3);
  }
  const skipImage = !hasImage(parent) || imageStatus[parent] === 'failed';
  const finalHint = level >= 5 ? null : hint;
  const opts = shuffle([kid, ...distractors.slice(0, numOpts - 1)]);
  return skipImage
    ? { prompt: `Wie heißt das Junge vom ${parent}?`, image: '🐾', options: opts, correct: kid, hint: finalHint }
    : { prompt: `Wie heißt das Junge vom ${parent}?`, bigImage: imgUrl(parent), options: opts, correct: kid, hint: finalHint };
}

function makeProfessions(level) {
  const fresh = POOL_PROFESSIONS.filter(p => !isRecent('professions', p[0]));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_PROFESSIONS);
  rememberRecent('professions', item[0], POOL_PROFESSIONS.length);
  const [werkzeug, beruf, distract, hint] = item;
  const numOpts = level <= 2 ? 3 : 4;
  // Bei Level 5: alle Distractors sind andere Berufe aus dem Pool
  let distractors = distract.slice();
  if (level >= 5) {
    const otherJobs = shuffle(POOL_PROFESSIONS
      .filter(p => p[1] !== beruf)
      .map(p => p[1]));
    if (otherJobs.length >= 3) distractors = otherJobs.slice(0, 3);
  }
  return {
    prompt: `Wer arbeitet mit „${werkzeug}"?`,
    image: '🔧',
    options: shuffle([beruf, ...distractors.slice(0, numOpts - 1)]),
    correct: beruf,
    hint: level >= 5 ? null : hint
  };
}

// === DOPPELDEUTIGE WÖRTER ===
// Konzept: "Welches Wort hat diese beiden Bedeutungen: 1) X, 2) Y?"
// Bei höherem Level: schwierigere Distractors aus anderen Homonymen
function makeHomonyms(level) {
  const fresh = POOL_HOMONYMS.filter(p => !isRecent('homonyms', p.word));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_HOMONYMS);
  rememberRecent('homonyms', item.word, POOL_HOMONYMS.length);
  const numOpts = level <= 2 ? 3 : 4;

  // Schwierigkeits-Stufen:
  // Level 5: ALLE Distractors sind andere Homonyme → der Patient muss richtig nachdenken
  // Level 4: 1 anderes Homonym als Distractor
  // Level <=3: normale themen-bezogene Distractors
  let allDistractors = item.distract.slice();
  if (level >= 4) {
    const otherHomonyms = shuffle(POOL_HOMONYMS
      .filter(h => h.word !== item.word)
      .map(h => h.word));
    if (level >= 5 && otherHomonyms.length >= 3) {
      allDistractors = otherHomonyms.slice(0, 3);
    } else if (otherHomonyms.length > 0) {
      allDistractors[0] = otherHomonyms[0];
    }
  }

  return {
    prompt: `Welches Wort hat beide Bedeutungen?\n1) ${item.hint1}\n2) ${item.hint2}`,
    image: '⚖',
    options: shuffle([item.word, ...allDistractors.slice(0, numOpts - 1)]),
    correct: item.word,
    hint: level >= 5 ? null : item.explanation,
  };
}

// === WORTREIHEN: Welches passt nicht? ===
function makeSemantic(level) {
  const fresh = POOL_SEMANTIC.filter(it => !isRecent('semantic', it[1]));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_SEMANTIC);
  rememberRecent('semantic', item[1], POOL_SEMANTIC.length);
  const [words, oddOne, hint] = item;
  return {
    prompt: 'Welches Wort passt nicht zu den anderen?',
    image: '⚆',
    options: shuffle(words.slice()),
    correct: oddOne,
    hint: level >= 5 ? null : hint,
  };
}

// === LÜCKENTEXTE ===
function makeLueckentext(level) {
  const fresh = POOL_LUECKENTEXT.filter(it => !isRecent('lueckentext', it.missing));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_LUECKENTEXT);
  rememberRecent('lueckentext', item.missing, POOL_LUECKENTEXT.length);
  const numOpts = level <= 2 ? 3 : 4;
  return {
    prompt: `Wie geht der Satz weiter?\n${item.sentence}`,
    image: '✎',
    options: shuffle([item.missing, ...item.distract.slice(0, numOpts - 1)]),
    correct: item.missing,
    hint: level >= 5 ? null : item.hint,
  };
}

// === ALLGEMEINWISSEN ===
function makeAllgemein(level) {
  const fresh = POOL_ALLGEMEIN.filter(it => !isRecent('allgemein', it.q));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_ALLGEMEIN);
  rememberRecent('allgemein', item.q, POOL_ALLGEMEIN.length);
  const numOpts = level <= 2 ? 3 : 4;
  return {
    prompt: item.q,
    image: '?',
    options: shuffle([item.a, ...item.distract.slice(0, numOpts - 1)]),
    correct: item.a,
    hint: null,
  };
}

// === ANALOGIEN ===
function makeAnalogien(level) {
  const fresh = POOL_ANALOGIEN.filter(it => !isRecent('analogien', it.a + it.c));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_ANALOGIEN);
  rememberRecent('analogien', item.a + item.c, POOL_ANALOGIEN.length);
  const numOpts = level <= 2 ? 3 : 4;
  // Bei hohem Level: harte Distractors aus anderen Analogien
  let distractors = item.distract.slice();
  if (level >= 5) {
    const otherAnswers = shuffle(POOL_ANALOGIEN.filter(it => it.d !== item.d).map(it => it.d));
    if (otherAnswers.length >= 3) distractors = otherAnswers.slice(0, 3);
  }
  return {
    prompt: `${item.a} verhält sich zu ${item.b} wie ${item.c} zu …?`,
    image: '⇄',
    options: shuffle([item.d, ...distractors.slice(0, numOpts - 1)]),
    correct: item.d,
    hint: level >= 5 ? null : item.hint,
  };
}

// === ZUSAMMENGESETZTE WÖRTER ===
function makeKomposita(level) {
  const fresh = POOL_KOMPOSITA.filter(it => !isRecent('komposita', it.correct));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_KOMPOSITA);
  rememberRecent('komposita', item.correct, POOL_KOMPOSITA.length);
  const numOpts = level <= 2 ? 3 : 4;
  return {
    prompt: `Welches Wort entsteht aus „${item.teil1}" + „${item.teil2}"?`,
    image: '＋',
    options: shuffle([item.correct, ...item.distract.slice(0, numOpts - 1)]),
    correct: item.correct,
    hint: level >= 5 ? null : item.hint,
  };
}

// === REIHENFOLGE / VERGLEICH ===
function makeReihenfolge(level) {
  const fresh = POOL_REIHENFOLGE.filter(it => !isRecent('reihenfolge', it.prompt + it.a));
  const item = fresh.length > 0 ? pickRandom(fresh) : pickRandom(POOL_REIHENFOLGE);
  rememberRecent('reihenfolge', item.prompt + item.a, POOL_REIHENFOLGE.length);
  const numOpts = level <= 2 ? 3 : 4;
  // Bei hohem Level: schwerere Vergleiche durch ähnliche Distractors
  let opts = [item.a, item.b];
  if (numOpts >= 3 && item.extra && item.extra.length >= 1) opts.push(item.extra[0]);
  if (numOpts >= 4 && item.extra && item.extra.length >= 2) opts.push(item.extra[1]);
  return {
    prompt: item.prompt + `\n${item.a} oder ${item.b}?`,
    image: '⇕',
    options: shuffle(opts),
    correct: item.correct,
    hint: null,
  };
}

function makeNumbers(level) {
  let task;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (level <= 2) {
      // Einfach: arithmetische Folge
      const start = rndInt(1, 10);
      const step = pickRandom([2, 3, 5, 10]);
      const seq = [start, start+step, start+2*step, start+3*step];
      const correct = String(start + 4*step);
      task = { prompt: `Welche Zahl folgt? ${seq.join(', ')}, …`, image: '#',
        options: shuffle([correct, String(parseInt(correct)+1), String(parseInt(correct)+step), String(parseInt(correct)-2)]),
        correct, hint: `Es wird immer um ${step} größer.`, _key: seq.join(',') };
    } else if (level <= 4) {
      const variants = [
        // Arithmetisch +/-
        () => { const s = rndInt(1,5); const d = rndInt(3,8); return { seq:[s, s+d, s+2*d, s+3*d], correct: String(s+4*d), hint: `Es wird um ${d} größer.` }; },
        // Geometrisch ×2
        () => { const s = rndInt(2,5); return { seq:[s, s*2, s*4, s*8], correct: String(s*16), hint: 'Jede Zahl ist doppelt so groß.' }; },
        // Geometrisch ×3
        () => { const s = rndInt(1,3); return { seq:[s, s*3, s*9, s*27], correct: String(s*81), hint: 'Jede Zahl ist dreimal so groß.' }; },
        // Absteigend
        () => { const s = rndInt(50,99); const d = rndInt(3,8); return { seq:[s, s-d, s-2*d, s-3*d], correct: String(s-4*d), hint: `Es wird um ${d} kleiner.` }; },
        // Quadratzahlen
        () => { return { seq:[1, 4, 9, 16], correct: '25', hint: '1, 4, 9, 16 — das sind Quadratzahlen (1², 2², 3², 4²).' }; },
      ];
      const v = pickRandom(variants)();
      const correctNum = parseInt(v.correct);
      task = { prompt: `Welche Zahl folgt? ${v.seq.join(', ')}, …`, image: '#',
        options: shuffle([v.correct, String(correctNum + 1), String(correctNum - 2), String(correctNum + 3)]),
        correct: v.correct, hint: v.hint, _key: v.seq.join(',') };
    } else {
      // Stadium 1-3: sehr schwer
      const variants = [
        // Fibonacci (verschiedene Startpunkte)
        () => {
          const seq = [1, 1, 2, 3, 5, 8, 13, 21];
          const start = rndInt(0, 3);
          const sub = seq.slice(start, start+4);
          return { seq: sub, correct: String(sub[2] + sub[3]),
            hint: `Tipp: Summe der beiden vorigen (${sub[2]} + ${sub[3]}).` };
        },
        // Wechselnde Schritte
        () => {
          const s = rndInt(2,6);
          const seq = [s, s+2, s+5, s+9, s+14];
          return { seq: seq.slice(0,4), correct: String(s+14),
            hint: 'Die Differenz wächst: +2, +3, +4, +5…' };
        },
        // Primzahlen
        () => {
          const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23];
          const start = rndInt(0, 4);
          const sub = primes.slice(start, start+4);
          return { seq: sub, correct: String(primes[start+4]),
            hint: 'Tipp: Diese Zahlen sind nur durch 1 und sich selbst teilbar.' };
        },
        // Doppelt minus eins
        () => {
          const s = rndInt(2, 4);
          const seq = [s, 2*s-1, 4*s-3, 8*s-7];
          return { seq, correct: String(16*s-15),
            hint: 'Jede Zahl wird verdoppelt und 1 abgezogen.' };
        },
      ];
      const v = pickRandom(variants)();
      const correctNum = parseInt(v.correct);
      task = { prompt: `Welche Zahl folgt? ${v.seq.join(', ')}, …`, image: '#',
        options: shuffle([v.correct, String(correctNum + 1), String(correctNum - 1), String(correctNum + 3)]),
        correct: v.correct, hint: level >= 5 ? null : v.hint, _key: v.seq.join(',') };
    }
    if (!isRecent('numbers', task._key)) break;
  }
  rememberRecent('numbers', task._key, 200);
  return task;
}

function makeOrientation(level) {
  const days = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const seasons = ['Frühling','Sommer','Herbst','Winter'];
  const d = new Date();
  const variants = [
    { id: 'day', fn: () => ({ prompt: 'Welcher Wochentag ist heute?', correct: days[d.getDay()], pool: days, image: '🗓', hint: 'Werktag oder Wochenende?' }) },
    { id: 'month', fn: () => ({ prompt: 'Welcher Monat ist gerade?', correct: months[d.getMonth()], pool: months, image: '📅', hint: `Der ${d.getMonth()+1}. Monat.` }) },
    { id: 'season', fn: () => {
      const m = d.getMonth();
      const season = m<=1||m===11 ? 'Winter' : m<=4 ? 'Frühling' : m<=7 ? 'Sommer' : 'Herbst';
      const hints = { 'Winter': 'Kalt, mit Schnee.', 'Frühling': 'Blumen blühen.', 'Sommer': 'Warm, lange Tage.', 'Herbst': 'Bunte Blätter fallen.' };
      return { prompt: 'Welche Jahreszeit ist gerade?', correct: season, pool: seasons, image: '🍂', hint: hints[season] };
    } },
    { id: 'year', fn: () => ({ prompt: 'In welchem Jahr leben wir?', correct: String(d.getFullYear()), pool: [String(d.getFullYear()), String(d.getFullYear()-1), String(d.getFullYear()-2), String(d.getFullYear()+1)], image: '✦', hint: `Beginnt mit ${String(d.getFullYear()).slice(0,3)}…` }) },
  ];
  // Wähle Variante die zuletzt nicht drankam
  const fresh = variants.filter(v => !isRecent('orientation', v.id));
  const chosen = fresh.length > 0 ? pickRandom(fresh) : pickRandom(variants);
  rememberRecent('orientation', chosen.id, variants.length);
  const v = chosen.fn();
  let opts = [v.correct];
  while (opts.length < 4) {
    const c = pickRandom(v.pool);
    if (!opts.includes(c)) opts.push(c);
  }
  return { prompt: v.prompt, image: v.image, options: shuffle(opts), correct: v.correct, hint: v.hint };
}

function makeMath(level) {
  let a, b, c, op, op2, correct, key, prompt;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (level <= 2) {
      // Einfach: einstellige Plus/Minus
      a = rndInt(1, 10); b = rndInt(1, 10);
      op = pickRandom(['+', '−']);
      if (op === '−' && b > a) [a, b] = [b, a];
      correct = op === '+' ? a + b : a - b;
      prompt = `${a} ${op} ${b} = ?`;
      key = `${a}${op}${b}`;
    } else if (level <= 4) {
      const variants = [
        () => {
          a = rndInt(10, 99); b = rndInt(5, 30);
          op = pickRandom(['+', '−']);
          if (op === '−' && b > a) [a, b] = [b, a];
          correct = op === '+' ? a + b : a - b;
          return { prompt: `${a} ${op} ${b} = ?`, key: `${a}${op}${b}` };
        },
        () => {
          a = rndInt(2, 12); b = rndInt(2, 9);
          correct = a * b;
          return { prompt: `${a} × ${b} = ?`, key: `${a}x${b}` };
        },
        () => {
          // Geteilt durch — sauberes Ergebnis
          b = rndInt(2, 9);
          const result = rndInt(2, 10);
          a = b * result;
          correct = result;
          return { prompt: `${a} ÷ ${b} = ?`, key: `${a}/${b}` };
        },
      ];
      const v = pickRandom(variants)();
      prompt = v.prompt; key = v.key;
    } else {
      // Stadium 1-3: schwer
      const variants = [
        // Zweistellige Multiplikation
        () => {
          a = rndInt(11, 19); b = rndInt(11, 19);
          correct = a * b;
          return { prompt: `${a} × ${b} = ?`, key: `${a}x${b}` };
        },
        // Drei Zahlen
        () => {
          a = rndInt(10, 50); b = rndInt(5, 30); c = rndInt(5, 25);
          correct = a + b - c;
          return { prompt: `${a} + ${b} − ${c} = ?`, key: `${a}+${b}-${c}` };
        },
        // Punkt-vor-Strich
        () => {
          a = rndInt(2, 12); b = rndInt(2, 9); c = rndInt(5, 30);
          correct = a * b + c;
          return { prompt: `${a} × ${b} + ${c} = ?`, key: `${a}x${b}+${c}` };
        },
        // Dreistellige Subtraktion
        () => {
          a = rndInt(100, 500); b = rndInt(50, 99);
          correct = a - b;
          return { prompt: `${a} − ${b} = ?`, key: `${a}-${b}` };
        },
        // Geteilt mit Rest (sauberes Ergebnis)
        () => {
          b = rndInt(3, 9);
          const result = rndInt(8, 15);
          a = b * result;
          correct = result;
          return { prompt: `${a} ÷ ${b} = ?`, key: `${a}/${b}` };
        },
        // Prozent (einfach)
        () => {
          const base = pickRandom([100, 200, 50, 80, 150]);
          const pct = pickRandom([10, 20, 25, 50, 75]);
          correct = (base * pct) / 100;
          return { prompt: `Wie viel sind ${pct}% von ${base}?`, key: `${pct}%${base}` };
        },
      ];
      const v = pickRandom(variants)();
      prompt = v.prompt; key = v.key;
    }
    if (!isRecent('math', key)) break;
  }
  rememberRecent('math', key, 500);
  const correctStr = String(correct);
  // Plausible Distractors
  const dist = level >= 5
    ? [String(correct + 1), String(correct - 1), String(Math.abs(correct + (a||10)))]
    : [String(correct + 1), String(correct - 1), String(correct + 2)];
  let hint = null;
  if (level < 5) {
    if (prompt.includes('+')) hint = 'Tipp: erst die ganzen Zehner, dann den Rest.';
    else if (prompt.includes('−')) hint = 'Tipp: was muss man dazuzählen?';
    else if (prompt.includes('×')) hint = 'Tipp: das Einmaleins.';
    else if (prompt.includes('÷')) hint = 'Tipp: wie oft passt die kleine Zahl in die große?';
    else if (prompt.includes('%')) hint = 'Tipp: 10% sind ein Zehntel.';
  }
  return { prompt, image: '∑', options: shuffle([correctStr, ...dist.slice(0,3)]), correct: correctStr, hint };
}

let memoryShown = null;
let memoryRecent = []; // letzte 5 Memory-Symbole
function makeMemory(level) {
  const symbols = ['★','♥','◆','✿','☀','☂','♛','✈','⚓','♪'];
  if (!memoryShown) {
    // Vermeide zuletzt verwendete Symbole
    const fresh = symbols.filter(s => !memoryRecent.includes(s));
    const sym = fresh.length > 0 ? pickRandom(fresh) : pickRandom(symbols);
    memoryShown = sym;
    memoryRecent.push(sym);
    if (memoryRecent.length > 5) memoryRecent.shift();
    return { prompt: 'Merken Sie sich dieses Symbol gut!', image: sym, options: ['Weiter →'], correct: 'Weiter →', special: 'memory-show' };
  } else {
    const sym = memoryShown;
    memoryShown = null;
    const distract = shuffle(symbols.filter(s => s !== sym)).slice(0,3);
    return { prompt: 'Welches Symbol haben Sie eben gesehen?', image: '?', options: shuffle([sym, ...distract]), correct: sym };
  }
}

const GENERATORS = {
  recognize: makeRecognize, whatIsIt: makeWhatIsIt, whatFood: makeWhatFood, whereIsThis: makeWhereIsThis,
  category: makeCategory, proverb: makeProverb, numbers: makeNumbers, orientation: makeOrientation,
  math: makeMath, opposites: makeOpposites, rhymes: makeRhymes, wordpair: makeWordpair, memory: makeMemory,
  synonyms: makeSynonyms, wordfind: makeWordfind, animalKids: makeAnimalKids, professions: makeProfessions,
  homonyms: makeHomonyms,
  semantic: makeSemantic, lueckentext: makeLueckentext, allgemein: makeAllgemein,
  analogien: makeAnalogien, komposita: makeKomposita, reihenfolge: makeReihenfolge,
};

// Berechnet den effektiven Schwierigkeitsgrad basierend auf Stadium und Lerntempo
function effectiveLevel(typeId) {
  const baseLevel = skill[typeId].level;
  // Stadium → fester Schwierigkeits-Level (überschreibt den persönlichen Lernfortschritt):
  // 1-3: extrem schwer (Level 5)
  // 4-5: schwer (Level 4)
  // 6-7: moderat (Level 3)
  // 8-9: leicht (Level 2)
  // 10:  sehr leicht (Level 1)
  if (dementiaStage <= 3) return 5;
  if (dementiaStage <= 5) return 4;
  if (dementiaStage <= 7) return 3;
  if (dementiaStage <= 9) return 2;
  return 1;
}

// Bei sehr niedrigem Stadium gibt es einen "extra harten" Modus
function isExtremeMode() {
  return dementiaStage <= 3;
}

function buildTaskOfType(typeId) {
  const level = effectiveLevel(typeId);
  const gen = GENERATORS[typeId];
  if (!gen) return null;
  return gen(level);
}


// ===========================================================================
// KI-GENERATOR (Anthropic API)
// ===========================================================================
async function callAnthropic(prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
  });
  const data = await response.json();
  const text = data.content.filter(c => c.type === 'text').map(c => c.text).join('');
  return text.replace(/```json|```/g, '').trim();
}

function setGenStatus(active, mainText, subText) {
  const dot = document.getElementById('genStatusDot');
  const main = document.getElementById('genStatusText');
  const sub = document.getElementById('genStatusSub');
  if (dot) dot.classList.toggle('idle', !active);
  if (main) main.textContent = mainText;
  if (sub) sub.textContent = subText;
}

async function generateAITasks() {
  if (aiGenerating) return;
  aiGenerating = true;
  setGenStatus(true, 'KI generiert Fragen…', 'Bitte einen Moment.');

  const prompt = `Du erstellst Gehirnjogging-Aufgaben für deutsche Demenzpatienten. Generiere ein JSON-Objekt mit neuen Aufgaben. Wichtig: alltagsnah, kultureller Bezug zu Deutschland, lösbar für ältere Menschen.

Antworte NUR mit gültigem JSON:
{
  "proverb": [{"prompt": "Spruch mit … als Lücke.", "correct": "Wort", "distract": ["a","b","c"], "hint": "Umschreibung"}],
  "opposites": [{"word": "groß", "opposite": "klein", "distract": ["mittel","weit","hoch"], "hint": "Beispiel"}],
  "whatIsIt": [{"word": "Banane", "keyword": "Banane", "distractKeys": ["Apfel","Mango","Zitrone"]}],
  "whatFood": [{"word": "Spätzle", "keyword": "Spätzle", "distractKeys": ["Nudeln","Knödel","Reis"]}],
  "whereIsThis": [{"word": "Eiffelturm", "keyword": "Eiffelturm", "distractKeys": ["Big Ben","Tour Montparnasse","Empire State Building"]}]
}

Generiere 4 neue Aufgaben pro Kategorie. Keine Wiederholung typischer Beispiele wie "Morgenstund hat Gold im Mund".

Wichtig für whatIsIt/whatFood/whereIsThis: keyword muss ein deutscher Wikipedia-Artikelname sein (z.B. "Banane", "Wiener Schnitzel", "Brandenburger Tor"). Wahrzeichen: nur weltweit bekannte (Eiffelturm, Brandenburger Tor, Kolosseum, Big Ben, Schloss Neuschwanstein, Akropolis, Freiheitsstatue, Schiefer Turm von Pisa, Olympiastadion München, Kölner Dom). Essen: deutsche/europäische Küche.`;

  try {
    const text = await callAnthropic(prompt);
    const parsed = JSON.parse(text);
    if (parsed.proverb) parsed.proverb.forEach(p => {
      if (p.prompt && p.correct && p.distract) aiPool.proverb.push({ prompt: p.prompt, image: '"', options: shuffle([p.correct, ...p.distract.slice(0,3)]), correct: p.correct, hint: p.hint || null });
    });
    if (parsed.opposites) parsed.opposites.forEach(o => {
      if (o.word && o.opposite && o.distract) aiPool.opposites.push({ prompt: `Was ist das Gegenteil von „${o.word}"?`, image: '⇄', options: shuffle([o.opposite, ...o.distract.slice(0,3)]), correct: o.opposite, hint: o.hint || null });
    });
    if (parsed.whatIsIt) parsed.whatIsIt.forEach(w => {
      if (w.word && w.keyword && w.distractKeys) aiPool.whatIsIt.push({ prompt: 'Was sehen Sie auf dem Bild?', bigImage: imgUrl(w.keyword), options: shuffle([w.word, ...w.distractKeys.slice(0,3)]), correct: w.word, hint: `Beginnt mit „${w.word.charAt(0)}".` });
    });
    if (parsed.whatFood) parsed.whatFood.forEach(w => {
      if (w.word && w.keyword && w.distractKeys) aiPool.whatFood.push({ prompt: 'Welches Essen ist das?', bigImage: imgUrl(w.keyword), options: shuffle([w.word, ...w.distractKeys.slice(0,3)]), correct: w.word, hint: `Beginnt mit „${w.word.charAt(0)}".` });
    });
    if (parsed.whereIsThis) parsed.whereIsThis.forEach(w => {
      if (w.word && w.keyword && w.distractKeys) aiPool.whereIsThis.push({ prompt: 'Welches Wahrzeichen ist das?', bigImage: imgUrl(w.keyword), options: shuffle([w.word, ...w.distractKeys.slice(0,3)]), correct: w.word, hint: `Beginnt mit „${w.word.charAt(0)}".` });
    });
    const total = Object.values(aiPool).reduce((s, a) => s + a.length, 0);
    setGenStatus(false, `${total} KI-Fragen im Pool`, 'Karl bekommt diese Fragen automatisch.');
    saveState();
  } catch (err) {
    setGenStatus(false, 'KI-Generierung nicht möglich', 'Standard-Fragen werden genutzt.');
  } finally {
    aiGenerating = false;
  }
}

function checkAutoRefill() {
  const total = Object.values(aiPool).reduce((s, a) => s + a.length, 0);
  if (total < 3 && !aiGenerating && sessionStats.total > 2) generateAITasks();
}

// ===========================================================================
// RENDERING (Family-View)
// ===========================================================================
function renderTaskTypes() {
  const c = document.getElementById('taskTypes');
  c.innerHTML = '';
  TASK_TYPES.forEach(t => {
    const isActive = activeTypes ? activeTypes[t.id] : t.defaultActive;
    const el = document.createElement('div');
    el.className = 'task-type' + (isActive ? ' active' : '');
    el.dataset.type = t.id;
    el.innerHTML = `<div class="task-type-level">L${skill[t.id].level}</div><div class="task-type-name">${t.name}</div><div class="task-type-desc">${t.desc}</div>`;
    el.onclick = () => {
      el.classList.toggle('active');
      // Sofort persistieren — geht nie verloren
      activeTypes[t.id] = el.classList.contains('active');
      saveState();
    };
    c.appendChild(el);
  });
}
function renderSkillBars() {
  const c = document.getElementById('skillBars');
  c.innerHTML = '';
  TASK_TYPES.forEach(t => {
    const s = skill[t.id];
    const total = s.correct + s.wrong;
    const rate = total > 0 ? Math.round((s.correct / total) * 100) : 0;
    const w = (s.level / 5) * 100;
    c.innerHTML += `<div class="skill-bar"><div class="skill-bar-header"><span class="skill-bar-name">${t.name}</span><span class="skill-bar-val">Stufe ${s.level}/5 · ${total > 0 ? rate + '%' : '–'}</span></div><div class="skill-bar-track"><div class="skill-bar-fill" style="width: ${w}%"></div></div></div>`;
  });
}
function renderInsight() {
  const el = document.getElementById('aiInsight');
  if (sessionStats.total < 3) {
    el.textContent = 'Noch wenige Daten — sobald Karl ein paar Aufgaben gelöst hat, erscheint hier eine Empfehlung.';
    return;
  }
  const ranked = TASK_TYPES.map(t => {
    const s = skill[t.id];
    const total = s.correct + s.wrong;
    return { name: t.name, rate: total > 0 ? s.correct / total : 1, total };
  }).filter(x => x.total >= 2).sort((a,b) => a.rate - b.rate);
  if (ranked.length === 0) { el.textContent = 'Karl macht das gut — KI sammelt weiter Daten.'; return; }
  const weakest = ranked[0];
  const strongest = ranked[ranked.length - 1];
  const overall = Math.round((sessionStats.correct / sessionStats.total) * 100);
  let msg = `<strong>Empfehlung:</strong> Karl löst aktuell <strong>${overall}%</strong> der Aufgaben richtig. `;
  if (weakest.rate < 0.5) msg += `Bei „${weakest.name}" zeigt sich Schwierigkeit (${Math.round(weakest.rate*100)}%) — die KI hat die Stufe automatisch reduziert.`;
  else if (strongest.rate > 0.85) msg += `„${strongest.name}" läuft sehr stark — die Aufgaben werden nun anspruchsvoller.`;
  else msg += `Das Niveau passt gut — Karl wird angemessen gefordert.`;
  el.innerHTML = msg;
}
function renderRepeatQueue() {
  const span = document.getElementById('repeatList');
  if (repeatQueue.length === 0) span.textContent = 'Aktuell keine Aufgaben in der Warteschleife.';
  else span.textContent = `${repeatQueue.length} Aufgabe(n) wartet/n auf Wiederholung`;
}
function renderStats() {
  document.getElementById('statPhotos').textContent = people.length;
  document.getElementById('statSessions').textContent = sessionStats.total;
  document.getElementById('statRate').textContent = sessionStats.total > 0 ? Math.round((sessionStats.correct/sessionStats.total)*100) + '%' : '–';
}
function renderPhotos() {
  const grid = document.getElementById('photoGrid');
  grid.innerHTML = '';
  people.forEach((p, idx) => {
    const tile = document.createElement('div');
    tile.className = 'photo-tile';
    tile.innerHTML = `<div class="placeholder">${p.initial}</div><div class="label">${p.name} · ${p.relation}</div><button class="delete-btn" onclick="event.stopPropagation(); removePerson(${idx})">×</button>`;
    grid.appendChild(tile);
  });
}
function renderStage() {
  const slider = document.getElementById('stageSlider');
  const valueEl = document.getElementById('stageValue');
  const explainer = document.getElementById('stageExplainer');
  if (!slider || !valueEl || !explainer) return;
  slider.value = String(dementiaStage);
  valueEl.textContent = dementiaStage;
  let text;
  if (dementiaStage <= 3) {
    text = `<strong>Frühstadium (${dementiaStage}/10):</strong> Nur Gehirnjogging — keine Personen-Aufgaben. Karl bekommt ausschließlich Denkübungen wie Sprichwörter, Kopfrechnen, Wortspiele und Bilder-Quiz.`;
  } else if (dementiaStage <= 5) {
    text = `<strong>Leichtes Stadium (${dementiaStage}/10):</strong> Schwerpunkt Gehirnjogging — Personen-Bilder erscheinen sehr selten, etwa jede 15. Aufgabe.`;
  } else if (dementiaStage <= 7) {
    text = `<strong>Mittleres Stadium (${dementiaStage}/10):</strong> Personen-Bilder etwa jede 12. Aufgabe — Mischung aus Erinnerungsarbeit und Denkaufgaben.`;
  } else {
    text = `<strong>Fortgeschrittenes Stadium (${dementiaStage}/10):</strong> Schwerpunkt liegt auf Personen-Wiedererkennen — etwa jede 10. Aufgabe ist ein vertrautes Gesicht. Personen werden möglichst nicht wiederholt.`;
  }
  explainer.innerHTML = text;
}

function setStage(value) {
  dementiaStage = parseInt(value, 10) || 3;
  renderStage();
  saveState();
}

function refreshFamilyView() { renderTaskTypes(); renderSkillBars(); renderInsight(); renderRepeatQueue(); renderStats(); renderPhotos(); renderStage(); }

function addPerson() {
  const name = document.getElementById('newName').value.trim();
  const relation = document.getElementById('newRelation').value;
  let initial = document.getElementById('newInitial').value.trim();
  const note = document.getElementById('newNote').value.trim();
  if (!name) { alert('Bitte Name eingeben'); return; }
  if (!initial) initial = name.charAt(0).toUpperCase();
  people.push({ name, relation, initial: initial.toUpperCase(), note });
  document.getElementById('newName').value = '';
  document.getElementById('newInitial').value = '';
  document.getElementById('newNote').value = '';
  saveState();
  refreshFamilyView();
}
function removePerson(idx) {
  if (confirm(`"${people[idx].name}" wirklich entfernen?`)) {
    people.splice(idx, 1); saveState(); refreshFamilyView();
  }
}
async function resetLearning() {
  if (!confirm('Lernfortschritt wirklich zurücksetzen?')) return;
  skill = {}; repeatQueue = []; sessionStats = { total: 0, correct: 0 };
  aiPool = { proverb: [], opposites: [], whatIsIt: [], whatFood: [], whereIsThis: [] };
  personStats = {}; lastRecognizeAt = -999;
  Object.keys(recentItems).forEach(k => recentItems[k] = []);
  activeTypes = Object.fromEntries(TASK_TYPES.map(t => [t.id, t.defaultActive]));
  TASK_TYPES.forEach(t => { skill[t.id] = { level: 2, correct: 0, wrong: 0, history: [] }; });
  await saveState();
  refreshFamilyView();
  setGenStatus(false, 'KI-Fragengenerator bereit', 'Aufgaben werden im Hintergrund automatisch nachgeladen.');
}


// ===========================================================================
// PATIENT-VIEW: TASK RENDERING
// ===========================================================================
function renderDate() {
  const dateEl = document.getElementById('dateLine');
  if (!dateEl) return;  // Datum-Zeile wurde aus dem UI entfernt
  const days = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const d = new Date();
  dateEl.textContent = `${days[d.getDay()]}, ${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
}
function renderProgress() {
  const row = document.getElementById('progressRow');
  row.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const dot = document.createElement('div');
    dot.className = 'progress-dot' + (i < progressIndex ? ' done' : i === progressIndex ? ' current' : '');
    row.appendChild(dot);
  }
}
function renderDifficulty(level) {
  const c = document.getElementById('difficultyDots');
  c.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const d = document.createElement('div');
    d.className = 'dot' + (i <= level ? ' on' : '');
    c.appendChild(d);
  }
}

// Versucht mehrere URLs der Reihe nach. Liefert die erste, die erfolgreich lädt.
// onLoaded(url, imgElement) wird bei Erfolg aufgerufen, onAllFailed() bei Misserfolg.
function tryLoadImageUrls(urls, onLoaded, onAllFailed, perTryTimeoutMs = 6000) {
  let cancelled = false;
  let idx = 0;

  function tryNext() {
    if (cancelled) return;
    if (idx >= urls.length) { onAllFailed(); return; }
    const url = urls[idx++];
    const img = new Image();
    // KEIN referrerPolicy='no-referrer' — Wikimedia liefert dann oft 403
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      tryNext();  // nächste URL
    }, perTryTimeoutMs);
    img.onload = () => {
      if (done || cancelled) return;
      // naturalWidth = 0 bedeutet, dass das Bild nicht wirklich geladen ist
      if (img.naturalWidth === 0) {
        done = true;
        clearTimeout(t);
        tryNext();
        return;
      }
      done = true;
      clearTimeout(t);
      onLoaded(url, img);
    };
    img.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      tryNext();
    };
    img.src = url;
  }

  tryNext();
  return { cancel: () => { cancelled = true; } };
}

async function loadBigImage(container, src, task) {
  container.classList.add('loading');
  container.innerHTML = '';

  let keyword = null;
  if (src.startsWith('__WIKI__:')) {
    keyword = src.substring(9);
  }
  if (currentTask !== task) return;

  const showFallback = () => {
    if (currentTask !== task) return;
    container.classList.remove('loading');
    container.innerHTML = '';
    const fallbackImg = new Image();
    fallbackImg.src = keyword ? getWordSvg(keyword) : getWordSvg('?');
    container.appendChild(fallbackImg);
  };

  // Alle möglichen URLs für diesen Begriff sammeln
  const urls = keyword ? getImageUrls(keyword) : [];
  if (urls.length === 0) { showFallback(); return; }

  tryLoadImageUrls(urls,
    (url, img) => {
      if (keyword) imageStatus[keyword] = 'ok';
      if (currentTask !== task) return;
      container.classList.remove('loading');
      container.innerHTML = '';
      container.appendChild(img);
      skipCount = 0;
    },
    () => {
      if (keyword) { imageStatus[keyword] = 'failed'; saveState(); }
      if (currentTask !== task) return;
      showFallback();
    },
    6000
  );
}

async function loadTileImage(tile, src, label) {
  let keyword = null;
  if (src.startsWith('__WIKI__:')) {
    keyword = src.substring(9);
  }

  const showFallback = () => {
    const fallback = new Image();
    fallback.src = keyword ? getWordSvg(keyword) : getWordSvg(label || '?');
    fallback.alt = label;
    [...tile.querySelectorAll('img')].forEach(el => el.remove());
    tile.insertBefore(fallback, tile.firstChild);
    // Kein doppeltes Label: das Wort steht schon im SVG → Label unter der Kachel verstecken
    const labelEl = tile.querySelector('.label');
    if (labelEl) labelEl.style.display = 'none';
  };

  const urls = keyword ? getImageUrls(keyword) : [];
  if (urls.length === 0) { showFallback(); return; }

  tryLoadImageUrls(urls,
    (url, img) => {
      if (keyword) imageStatus[keyword] = 'ok';
      img.alt = label;
      [...tile.querySelectorAll('img')].forEach(el => el.remove());
      tile.insertBefore(img, tile.firstChild);
      // Echtes Bild → Label sichtbar lassen (falls vorher versteckt war)
      const labelEl = tile.querySelector('.label');
      if (labelEl) labelEl.style.display = '';
    },
    () => {
      if (keyword) { imageStatus[keyword] = 'failed'; saveState(); }
      showFallback();
    },
    6000
  );
}

let skipCount = 0;
function skipBrokenTask() {
  // Skip wird nicht mehr gebraucht — Bilder bekommen immer einen Wort-Fallback
  // Funktion bleibt nur für Rückwärtskompatibilität
}

// Sammelt alle Wikimedia-Bild-URLs einer Aufgabe.
// Liefert leeres Array wenn die Aufgabe gar keine Bilder braucht.
function collectImageKeywords(task) {
  if (!task) return [];
  const keywords = [];
  if (task.bigImage && task.bigImage.startsWith('__WIKI__:')) {
    keywords.push(task.bigImage.substring(9));
  }
  if (task.imageGrid) {
    for (const item of task.imageGrid) {
      if (item.img && item.img.startsWith('__WIKI__:')) {
        keywords.push(item.img.substring(9));
      }
    }
  }
  return keywords;
}

// Prüft im Browser ob ein einzelnes Wikimedia-Bild lädt (mit allen Alternativen).
// Liefert true sobald irgendeine URL erfolgreich lädt.
function verifyKeywordLoadable(keyword, perTryTimeoutMs = 4000) {
  return new Promise((resolve) => {
    const urls = getImageUrls(keyword);
    if (urls.length === 0) { resolve(false); return; }
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) { resolve(false); return; }
      const img = new Image();
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true; i++; tryNext();
      }, perTryTimeoutMs);
      img.onload = () => {
        if (done) return;
        if (img.naturalWidth === 0) {
          done = true; clearTimeout(t); i++; tryNext(); return;
        }
        done = true; clearTimeout(t); resolve(true);
      };
      img.onerror = () => {
        if (done) return;
        done = true; clearTimeout(t); i++; tryNext();
      };
      img.src = urls[i];
    };
    tryNext();
  });
}

// Prüft ob ALLE Bilder einer Aufgabe verfügbar sind.
// Cached die Ergebnisse, damit dasselbe Bild nicht immer wieder getestet wird.
async function verifyTaskImages(task) {
  const keywords = collectImageKeywords(task);
  if (keywords.length === 0) return true;  // keine Bilder nötig → OK
  // KEIN blockierender Test mehr — wir vertrauen darauf dass Bilder funktionieren,
  // außer sie sind explizit als 'failed' bekannt. Der Loader markiert beim Fehler
  // den Status für die Zukunft, sodass das Bild dann nicht wieder ausgewählt wird.
  for (const kw of keywords) {
    if (imageStatus[kw] === 'failed') return false;
  }
  return true;
}

async function nextTask() {
  answered = false;
  document.getElementById('taskFeedback').textContent = '\u00A0';
  document.getElementById('taskFeedback').className = 'feedback';
  document.getElementById('repeatTag').classList.add('hidden');
  const hintBtn = document.getElementById('hintBtn');
  const hintBubble = document.getElementById('hintBubble');
  hintBtn.classList.add('hidden');
  hintBtn.classList.remove('used');
  hintBtn.textContent = '💡 Hinweis anzeigen';
  hintBubble.classList.add('hidden');
  hintBubble.textContent = '';

  // Loading-Anzeige während Bild-Verifizierung
  const taskImage = document.getElementById('taskImage');
  taskImage.classList.add('loading');
  taskImage.classList.remove('hidden');
  taskImage.innerHTML = '';
  document.getElementById('taskImageGrid').classList.add('hidden');
  document.getElementById('taskOptions').innerHTML = '';
  document.getElementById('taskPrompt').textContent = 'Lade Aufgabe…';

  let task = null, typeId = null, isRepeat = false;
  const stageMap = {};
  for (const t of TASK_TYPES) stageMap[t.id] = t.minStage || 1;
  const activeIds = Object.entries(activeTypes || {})
    .filter(([id, v]) => v && (stageMap[id] || 1) <= dementiaStage)
    .map(([k]) => k);

  // Versuche bis zu 15 mal eine Aufgabe mit funktionierenden Bildern zu finden
  for (let attempt = 0; attempt < 15; attempt++) {
    let candidate = null, candidateType = null, candidateRepeat = false;

    // Pending-Tracking aus vorigem Versuch verwerfen — sonst markieren wir Items
    // als gesehen, die wir nie zeigen werden
    discardPendingTracking();

    // Erstmal Repeats versuchen (nur beim ersten Versuch)
    if (attempt === 0) {
      const due = getDueRepeat(activeIds);
      if (due) { candidate = due.snapshot; candidateType = due.type; candidateRepeat = true; }
    }

    if (!candidate) {
      candidateType = aiPickTaskType();
      candidate = buildTaskOfType(candidateType);
      // Wenn der gewählte Typ keine Aufgabe liefert, andere aktive Typen probieren
      if (!candidate) {
        for (const id of activeIds) {
          if (id === candidateType) continue;
          candidate = buildTaskOfType(id);
          if (candidate) { candidateType = id; break; }
        }
      }
    }
    if (!candidate) { discardPendingTracking(); continue; }

    // Bilder verifizieren — wenn alle laden, nehmen wir die Aufgabe
    const ok = await verifyTaskImages(candidate);
    if (ok) {
      task = candidate;
      typeId = candidateType;
      isRepeat = candidateRepeat;
      // JETZT erst committen — die Aufgabe wird wirklich angezeigt
      commitPendingTracking();
      break;
    }
    // sonst: pending verwerfen und nächster Versuch
    discardPendingTracking();
  }

  if (!task) {
    // Notfall: keine Aufgabe mit ladenden Bildern gefunden
    discardPendingTracking();
    taskImage.classList.remove('loading');
    document.getElementById('taskPrompt').textContent = 'Keine Aufgaben verfügbar — bitte später erneut versuchen.';
    return;
  }

  currentTask = task;
  currentTaskMeta = { type: typeId, isRepeat };

  if (isRepeat) document.getElementById('repeatTag').classList.remove('hidden');
  document.getElementById('taskPrompt').textContent = task.prompt;

  const taskImageGrid = document.getElementById('taskImageGrid');

  if (task.imageGrid) {
    taskImage.classList.add('hidden');
    taskImageGrid.classList.remove('hidden');
    taskImageGrid.innerHTML = '';
    task.imageGrid.forEach(item => {
      const tile = document.createElement('div');
      tile.className = 'img-tile';
      tile.innerHTML = `<div class="label">${item.label}</div>`;
      loadTileImage(tile, item.img, item.label);
      tile.onclick = () => answerTask(tile, item.label);
      taskImageGrid.appendChild(tile);
    });
  } else {
    taskImageGrid.classList.add('hidden');
    taskImage.classList.remove('hidden');
    if (task.bigImage) loadBigImage(taskImage, task.bigImage, task);
    else { taskImage.classList.remove('loading'); taskImage.innerHTML = ''; taskImage.textContent = task.image || '?'; }
  }

  if (task.hint && task.special !== 'memory-show') hintBtn.classList.remove('hidden');
  renderDifficulty(effectiveLevel(typeId));

  // Bild-Melde-Button nur sichtbar wenn die Aufgabe Wikimedia-Bilder hat
  const reportBtn = document.getElementById('reportImageBtn');
  if (reportBtn) {
    const hasWikiImage = collectImageKeywords(task).length > 0;
    reportBtn.classList.toggle('hidden', !hasWikiImage);
  }

  const optsEl = document.getElementById('taskOptions');
  if (task.imageGrid) { optsEl.classList.add('hidden'); optsEl.innerHTML = ''; }
  else {
    optsEl.classList.remove('hidden');
    optsEl.innerHTML = '';
    task.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.onclick = () => answerTask(btn, opt);
      optsEl.appendChild(btn);
    });
  }
  renderProgress();
  checkAutoRefill();
}

function showHint() {
  if (!currentTask || !currentTask.hint) return;
  const btn = document.getElementById('hintBtn');
  const bubble = document.getElementById('hintBubble');
  if (btn.classList.contains('used')) return;
  bubble.textContent = currentTask.hint;
  bubble.classList.remove('hidden');
  btn.classList.add('used');
  btn.textContent = '✓ Hinweis verwendet';
}

// Patient meldet, dass das Bild nicht zur Frage passt.
// Wir markieren alle Wikimedia-Begriffe der Aufgabe als 'failed' und holen neue Aufgabe.
function reportBadImage() {
  if (!currentTask) return;
  const keywords = collectImageKeywords(currentTask);
  for (const kw of keywords) {
    imageStatus[kw] = 'failed';
  }
  saveState();
  // Sofort nächste Aufgabe holen — diese hier wird nicht weiter angezeigt
  nextTask();
}

function answerTask(btn, choice) {
  if (answered) return;
  answered = true;
  const fb = document.getElementById('taskFeedback');
  const isCorrect = choice === currentTask.correct;
  const isMemoryShow = currentTask.special === 'memory-show';
  if (isCorrect || isMemoryShow) {
    btn.classList.add('correct');
    if (!isMemoryShow) {
      fb.textContent = pickRandom(['Wunderbar — das stimmt.','Sehr gut!','Genau richtig.','Bravo, Karl!']);
      fb.className = 'feedback good';
      recordAnswer(currentTaskMeta.type, true, currentTask);
    }
  } else {
    btn.classList.add('wrong');
    [...document.querySelectorAll('.option-btn, .img-tile')].forEach(b => {
      const lbl = b.querySelector ? (b.querySelector('.label')?.textContent || b.textContent) : b.textContent;
      if (lbl && lbl.trim() === currentTask.correct) b.classList.add('correct');
    });
    fb.textContent = `Kein Problem. Es war: ${currentTask.correct}.`;
    fb.className = 'feedback bad';
    recordAnswer(currentTaskMeta.type, false, currentTask);
  }
  progressIndex = (progressIndex + 1) % 5;
  setTimeout(() => { if (answered) nextTask(); }, isMemoryShow ? 1800 : 2800);
}


// ===========================================================================
// SPIELE — gemeinsame Helfer
// ===========================================================================
function showGameOver(containerId, emoji, title, text, restartFn) {
  const c = document.getElementById(containerId);
  c.classList.remove('hidden');
  c.innerHTML = `
    <div class="game-over-overlay">
      <div class="game-over">
        <div class="game-over-emoji">${emoji}</div>
        <h3>${title}</h3>
        <p>${text}</p>
        <div class="game-over-actions">
          <button class="btn btn-accent" onclick="${restartFn}()">🔄 Neue Runde</button>
          <button class="btn btn-secondary" onclick="exitGame()">← Zurück zum Menü</button>
        </div>
      </div>
    </div>`;
}
function hideGameOver(containerId) {
  const c = document.getElementById(containerId);
  c.classList.add('hidden');
  c.innerHTML = '';
}

function exitGame() {
  ['memoryGame','unoGame','connect4Game','tttGame','wordChainGame','crosswordGame','checkersGame','kniffelGame'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  ['memOver','unoOver','c4Over','tttOver','wsOver','cwOver','ckOver','knOver'].forEach(hideGameOver);
  document.getElementById('gameMenu').classList.remove('hidden');
}

// ===========================================================================
// MEMORY (KI deutlich langsamer beim Aufdecken)
// ===========================================================================
let memState = null;
function startMemory() {
  document.getElementById('gameMenu').classList.add('hidden');
  document.getElementById('memoryGame').classList.remove('hidden');
  hideGameOver('memOver');
  const symbols = ['🌻','🐱','🍎','⭐','🌙','🎵','🐝','🦋'];
  const cards = shuffle([...symbols, ...symbols]).map((sym, i) => ({ id: i, sym, flipped: false, matched: false }));
  memState = { cards, youScore: 0, aiScore: 0, turn: 'you', firstPick: null, secondPick: null, locked: false, aiKnowledge: {} };
  renderMemoryBoard();
  updateMemoryStatus();
}

function renderMemoryBoard() {
  const board = document.getElementById('memoryBoard');
  board.innerHTML = '';
  memState.cards.forEach(card => {
    const el = document.createElement('div');
    el.className = 'memory-card' + (card.matched ? ' matched' : card.flipped ? ' flipped' : ' hidden-symbol');
    el.textContent = card.flipped || card.matched ? card.sym : '';
    el.onclick = () => memCardClick(card);
    board.appendChild(el);
  });
}
function updateMemoryStatus() {
  document.getElementById('memYouScore').textContent = memState.youScore;
  document.getElementById('memAiScore').textContent = memState.aiScore;
  document.getElementById('memTurn').textContent = memState.turn === 'you' ? 'Sie' : 'PC';
  const ind = document.getElementById('memTurnIndicator');
  if (memState.turn === 'you') {
    ind.className = 'memory-turn-indicator you';
    ind.textContent = 'Sie sind dran — wählen Sie eine Karte.';
  } else {
    ind.className = 'memory-turn-indicator ai';
    ind.textContent = 'Der Computer ist dran…';
  }
}

function memCardClick(card) {
  if (memState.turn !== 'you' || memState.locked || card.matched || card.flipped) return;
  card.flipped = true;
  // KI merkt sich aufgedeckte Karten
  memState.aiKnowledge[card.id] = card.sym;
  renderMemoryBoard();
  if (!memState.firstPick) { memState.firstPick = card; return; }
  memState.secondPick = card;
  memState.locked = true;
  setTimeout(() => evaluateMemoryPick('you'), 1100);
}

function evaluateMemoryPick(who) {
  const a = memState.firstPick, b = memState.secondPick;
  if (a.sym === b.sym) {
    a.matched = true; b.matched = true;
    if (who === 'you') memState.youScore++; else memState.aiScore++;
    renderMemoryBoard();
    memState.firstPick = null; memState.secondPick = null; memState.locked = false;
    if (memState.cards.every(c => c.matched)) {
      const won = memState.youScore > memState.aiScore;
      const tied = memState.youScore === memState.aiScore;
      showGameOver('memOver',
        won ? '🎉' : tied ? '🤝' : '😊',
        won ? 'Gewonnen!' : tied ? 'Unentschieden!' : 'Gut gespielt!',
        `Endstand: Sie ${memState.youScore} : ${memState.aiScore} Computer`,
        'startMemory');
      return;
    }
    updateMemoryStatus();
    if (who === 'ai') setTimeout(memAiTurn, 1500); // <- KI darf nochmal
  } else {
    setTimeout(() => {
      a.flipped = false; b.flipped = false;
      memState.firstPick = null; memState.secondPick = null; memState.locked = false;
      memState.turn = memState.turn === 'you' ? 'ai' : 'you';
      renderMemoryBoard();
      updateMemoryStatus();
      if (memState.turn === 'ai') setTimeout(memAiTurn, 1200);
    }, 1500); // länger sichtbar
  }
}

function memAiTurn() {
  if (!memState || memState.cards.every(c => c.matched)) return;
  const remaining = memState.cards.filter(c => !c.matched);
  // 1) Bekannte Paare ausnutzen
  const knownIds = Object.keys(memState.aiKnowledge).filter(id => {
    const c = memState.cards.find(x => x.id == id);
    return c && !c.matched;
  });
  let first = null, second = null;
  for (const id1 of knownIds) {
    for (const id2 of knownIds) {
      if (id1 !== id2 && memState.aiKnowledge[id1] === memState.aiKnowledge[id2]) {
        first = memState.cards.find(c => c.id == id1);
        second = memState.cards.find(c => c.id == id2);
        break;
      }
    }
    if (first) break;
  }
  // 2) Sonst zufällig
  if (!first) {
    const unknown = remaining.filter(c => !memState.aiKnowledge[c.id]);
    first = unknown.length > 0 ? pickRandom(unknown) : pickRandom(remaining);
    // Zweite: prüfen ob erste mit bekannter passt
    const matchKnown = knownIds.find(id => {
      const c = memState.cards.find(x => x.id == id);
      return c && c.id !== first.id && memState.aiKnowledge[id] === first.sym;
    });
    if (matchKnown) second = memState.cards.find(c => c.id == matchKnown);
    else {
      const restUnknown = remaining.filter(c => c.id !== first.id && !memState.aiKnowledge[c.id]);
      second = restUnknown.length > 0 ? pickRandom(restUnknown) : pickRandom(remaining.filter(c => c.id !== first.id));
    }
  }

  // KI deckt erste Karte langsam auf — Patient soll's verfolgen können
  setTimeout(() => {
    if (!memState) return;
    first.flipped = true;
    memState.aiKnowledge[first.id] = first.sym;
    memState.firstPick = first;
    renderMemoryBoard();
    setTimeout(() => {
      if (!memState) return;
      second.flipped = true;
      memState.aiKnowledge[second.id] = second.sym;
      memState.secondPick = second;
      renderMemoryBoard();
      setTimeout(() => evaluateMemoryPick('ai'), 1500);
    }, 1500);
  }, 800);
}


// ===========================================================================
// UNO (Karten ablegen)
// ===========================================================================
let unoState = null;

function startUno() {
  document.getElementById('gameMenu').classList.add('hidden');
  document.getElementById('unoGame').classList.remove('hidden');
  hideGameOver('unoOver');
  document.getElementById('unoColorPicker').classList.add('hidden');

  const colors = ['red','blue','green','yellow'];
  const deck = [];
  colors.forEach(c => {
    deck.push({ color: c, value: '0' });
    for (let v = 1; v <= 9; v++) { deck.push({ color: c, value: String(v) }); deck.push({ color: c, value: String(v) }); }
    deck.push({ color: c, value: 'skip' }); deck.push({ color: c, value: 'skip' });
    deck.push({ color: c, value: 'reverse' });
    deck.push({ color: c, value: '+2' });
  });
  for (let i = 0; i < 4; i++) { deck.push({ color: 'wild', value: 'wild' }); deck.push({ color: 'wild', value: '+4' }); }
  // Wichtig: shuffle gibt neues Array zurück — wir müssen es ZUWEISEN
  const shuffled = shuffle(deck);
  let topIdx = shuffled.findIndex(c => c.color !== 'wild' && !['skip','reverse','+2'].includes(c.value));
  if (topIdx < 0) topIdx = 0;
  const top = shuffled.splice(topIdx, 1)[0];
  unoState = {
    deck: shuffled, discard: [top], activeColor: top.color,
    playerHand: shuffled.splice(0, 7), aiHand: shuffled.splice(0, 7),
    turn: 'player', pendingDraw: 0, awaitingColorChoice: false,
  };
  renderUno();
}
function renderUno() {
  if (!unoState) return;
  const top = unoState.discard[unoState.discard.length - 1];
  document.getElementById('unoDiscard').innerHTML = renderUnoCard(top, false);
  document.getElementById('unoActiveColor').style.background = colorOf(unoState.activeColor);
  document.getElementById('unoAiCount').textContent = unoState.aiHand.length;
  document.getElementById('unoPlayerCount').textContent = unoState.playerHand.length;
  const aiHand = document.getElementById('unoAiHand');
  aiHand.innerHTML = '';
  unoState.aiHand.forEach(() => { aiHand.innerHTML += `<div class="uno-card back"><span class="center">M</span></div>`; });
  const ph = document.getElementById('unoPlayerHand');
  ph.innerHTML = '';
  unoState.playerHand.forEach((c, i) => {
    const playable = unoState.turn === 'player' && canPlay(c) && !unoState.awaitingColorChoice;
    const el = document.createElement('div');
    el.innerHTML = renderUnoCard(c, playable);
    const cardEl = el.firstElementChild;
    if (playable) cardEl.onclick = () => unoPlayerPlay(i);
    ph.appendChild(cardEl);
  });
  document.getElementById('unoDrawBtn').disabled = unoState.turn !== 'player' || unoState.awaitingColorChoice;
}
function renderUnoCard(c, playable) {
  const v = c.value === '+2' ? '+2' : c.value === '+4' ? '+4' : c.value === 'skip' ? '⊘' : c.value === 'reverse' ? '↺' : c.value === 'wild' ? '✦' : c.value;
  return `<div class="uno-card ${c.color}${playable ? ' playable' : ''}"><span class="corner-top">${v}</span><span class="center">${v}</span><span class="corner-bottom">${v}</span></div>`;
}
function colorOf(c) {
  return c === 'red' ? '#c8553d' : c === 'blue' ? '#3d6ec8' : c === 'green' ? '#588157' : c === 'yellow' ? '#d4a017' : 'linear-gradient(135deg, #c8553d, #d4a017, #588157, #3d6ec8)';
}
function canPlay(card) {
  if (card.color === 'wild') return true;
  const top = unoState.discard[unoState.discard.length - 1];
  if (card.color === unoState.activeColor) return true;
  if (top.value === card.value) return true;
  return false;
}
function unoPlayerPlay(idx) {
  if (unoState.turn !== 'player' || unoState.awaitingColorChoice) return;
  const card = unoState.playerHand[idx];
  if (!canPlay(card)) return;
  unoState.playerHand.splice(idx, 1);
  unoState.discard.push(card);
  if (card.color === 'wild') {
    unoState.awaitingColorChoice = true;
    document.getElementById('unoColorPicker').classList.remove('hidden');
    if (card.value === '+4') unoState.pendingDraw += 4;
    renderUno();
    return;
  }
  unoState.activeColor = card.color;
  applyCardEffects(card, 'player');
  if (unoState.playerHand.length === 0) { renderUno(); showGameOver('unoOver','🎉','Gewonnen!','Sie haben alle Karten abgelegt!','startUno'); return; }
  if (unoState.turn === 'player') { document.getElementById('unoMessage').textContent = 'Sie sind nochmal dran!'; }
  renderUno();
  if (unoState.turn === 'ai') setTimeout(unoAiTurn, 1000);
}
function unoPickColor(color) {
  unoState.activeColor = color;
  unoState.awaitingColorChoice = false;
  document.getElementById('unoColorPicker').classList.add('hidden');
  const card = unoState.discard[unoState.discard.length - 1];
  applyCardEffects(card, 'player');
  if (unoState.playerHand.length === 0) { renderUno(); showGameOver('unoOver','🎉','Gewonnen!','Sie haben alle Karten abgelegt!','startUno'); return; }
  renderUno();
  if (unoState.turn === 'ai') setTimeout(unoAiTurn, 1000);
}
function applyCardEffects(card, who) {
  const opponent = who === 'player' ? 'ai' : 'player';
  if (card.value === 'skip' || card.value === 'reverse') unoState.turn = who;
  else if (card.value === '+2') {
    drawN(opponent, 2); unoState.turn = who;
    document.getElementById('unoMessage').textContent = `${opponent === 'ai' ? 'Computer' : 'Sie'} zieht 2 Karten.`;
  } else if (card.value === '+4') {
    drawN(opponent, 4); unoState.turn = who;
    document.getElementById('unoMessage').textContent = `${opponent === 'ai' ? 'Computer' : 'Sie'} zieht 4 Karten.`;
  } else { unoState.turn = opponent; }
}
function drawN(who, n) {
  const hand = who === 'player' ? unoState.playerHand : unoState.aiHand;
  for (let i = 0; i < n; i++) { if (unoState.deck.length === 0) reshuffle(); if (unoState.deck.length > 0) hand.push(unoState.deck.shift()); }
}
function reshuffle() {
  const top = unoState.discard.pop();
  unoState.deck = shuffle(unoState.discard);
  unoState.discard = [top];
}
function unoDraw() {
  if (unoState.turn !== 'player' || unoState.awaitingColorChoice) return;
  drawN('player', 1);
  unoState.turn = 'ai';
  document.getElementById('unoMessage').textContent = 'Sie haben eine Karte gezogen — Computer ist dran.';
  renderUno();
  setTimeout(unoAiTurn, 1200);
}
function unoAiTurn() {
  if (!unoState || unoState.turn !== 'ai') return;
  const playable = unoState.aiHand.filter(c => canPlay(c));
  if (playable.length === 0) {
    drawN('ai', 1);
    const after = unoState.aiHand[unoState.aiHand.length - 1];
    if (after && canPlay(after)) {
      // schwache KI: spielt direkt, falls möglich
      const idx = unoState.aiHand.length - 1;
      const card = unoState.aiHand.splice(idx, 1)[0];
      unoState.discard.push(card);
      if (card.color === 'wild') {
        const colors = ['red','blue','green','yellow'];
        unoState.activeColor = pickRandom(colors);
      } else unoState.activeColor = card.color;
      applyCardEffects(card, 'ai');
      document.getElementById('unoMessage').textContent = 'Computer hat gezogen und gespielt.';
      renderUno();
      if (unoState.aiHand.length === 0) { showGameOver('unoOver','😊','Schade!','Der Computer hat alle Karten abgelegt.','startUno'); return; }
      if (unoState.turn === 'ai') setTimeout(unoAiTurn, 1200);
      return;
    }
    document.getElementById('unoMessage').textContent = 'Computer hat gezogen — Sie sind dran.';
    unoState.turn = 'player';
    renderUno();
    return;
  }
  const card = pickRandom(playable);
  const idx = unoState.aiHand.indexOf(card);
  unoState.aiHand.splice(idx, 1);
  unoState.discard.push(card);
  if (card.color === 'wild') { const colors = ['red','blue','green','yellow']; unoState.activeColor = pickRandom(colors); }
  else unoState.activeColor = card.color;
  applyCardEffects(card, 'ai');
  document.getElementById('unoMessage').textContent = 'Computer hat gespielt.';
  renderUno();
  if (unoState.aiHand.length === 0) { showGameOver('unoOver','😊','Schade!','Der Computer hat alle Karten abgelegt.','startUno'); return; }
  if (unoState.turn === 'ai') setTimeout(unoAiTurn, 1200);
  else document.getElementById('unoMessage').textContent = 'Sie sind am Zug.';
}


// ===========================================================================
// VIER GEWINNT
// ===========================================================================
let c4State = null;
function startConnect4() {
  document.getElementById('gameMenu').classList.add('hidden');
  document.getElementById('connect4Game').classList.remove('hidden');
  hideGameOver('c4Over');
  c4State = { board: Array(6).fill(0).map(() => Array(7).fill(null)), turn: 'you', over: false };
  renderC4();
}
function renderC4() {
  const board = document.getElementById('c4Board');
  board.innerHTML = '';
  for (let r = 0; r < 6; r++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.createElement('div');
      const v = c4State.board[r][col];
      cell.className = 'c4-cell' + (v === 'r' ? ' red' : v === 'y' ? ' yellow' : '') + (!c4State.over && c4State.turn === 'you' ? ' hint' : '');
      if (!c4State.over && c4State.turn === 'you') cell.onclick = () => c4Click(col);
      board.appendChild(cell);
    }
  }
  const ind = document.getElementById('c4Turn');
  if (c4State.over) ind.textContent = '';
  else if (c4State.turn === 'you') { ind.className = 'memory-turn-indicator you'; ind.textContent = 'Sie sind dran — wählen Sie eine Spalte.'; }
  else { ind.className = 'memory-turn-indicator ai'; ind.textContent = 'Computer überlegt…'; }
}
function c4DropRow(board, col) {
  for (let r = 5; r >= 0; r--) if (board[r][col] === null) return r;
  return -1;
}
function c4CheckWin(board, sym) {
  // horizontal
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++)
    if (board[r][c] === sym && board[r][c+1] === sym && board[r][c+2] === sym && board[r][c+3] === sym) return true;
  // vertikal
  for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++)
    if (board[r][c] === sym && board[r+1][c] === sym && board[r+2][c] === sym && board[r+3][c] === sym) return true;
  // diagonal ↘
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++)
    if (board[r][c] === sym && board[r+1][c+1] === sym && board[r+2][c+2] === sym && board[r+3][c+3] === sym) return true;
  // diagonal ↗
  for (let r = 3; r < 6; r++) for (let c = 0; c < 4; c++)
    if (board[r][c] === sym && board[r-1][c+1] === sym && board[r-2][c+2] === sym && board[r-3][c+3] === sym) return true;
  return false;
}
function c4IsFull(board) { return board[0].every(v => v !== null); }
function c4Click(col) {
  if (c4State.over || c4State.turn !== 'you') return;
  const r = c4DropRow(c4State.board, col);
  if (r < 0) return;
  c4State.board[r][col] = 'r';
  if (c4CheckWin(c4State.board, 'r')) { c4State.over = true; renderC4(); showGameOver('c4Over','🎉','Gewonnen!','Sie haben vier in einer Reihe!','startConnect4'); return; }
  if (c4IsFull(c4State.board)) { c4State.over = true; renderC4(); showGameOver('c4Over','🤝','Unentschieden','Das Brett ist voll.','startConnect4'); return; }
  c4State.turn = 'ai';
  renderC4();
  setTimeout(c4AiMove, 900);
}
function c4AiMove() {
  if (!c4State || c4State.over) return;
  // 1) Selbst gewinnen?
  for (let col = 0; col < 7; col++) {
    const r = c4DropRow(c4State.board, col);
    if (r < 0) continue;
    c4State.board[r][col] = 'y';
    if (c4CheckWin(c4State.board, 'y')) { c4State.over = true; renderC4(); showGameOver('c4Over','😊','Schade!','Der Computer hat gewonnen.','startConnect4'); return; }
    c4State.board[r][col] = null;
  }
  // 2) Spieler-Sieg blockieren?
  let blockCol = -1;
  for (let col = 0; col < 7; col++) {
    const r = c4DropRow(c4State.board, col);
    if (r < 0) continue;
    c4State.board[r][col] = 'r';
    if (c4CheckWin(c4State.board, 'r')) blockCol = col;
    c4State.board[r][col] = null;
    if (blockCol >= 0) break;
  }
  let chosenCol;
  if (blockCol >= 0) chosenCol = blockCol;
  else {
    // 3) Mitte bevorzugen
    const prefs = [3, 2, 4, 1, 5, 0, 6];
    chosenCol = prefs.find(col => c4DropRow(c4State.board, col) >= 0);
  }
  const r = c4DropRow(c4State.board, chosenCol);
  c4State.board[r][chosenCol] = 'y';
  if (c4CheckWin(c4State.board, 'y')) { c4State.over = true; renderC4(); showGameOver('c4Over','😊','Schade!','Der Computer hat gewonnen.','startConnect4'); return; }
  if (c4IsFull(c4State.board)) { c4State.over = true; renderC4(); showGameOver('c4Over','🤝','Unentschieden','Das Brett ist voll.','startConnect4'); return; }
  c4State.turn = 'you';
  renderC4();
}

// ===========================================================================
// TIC TAC TOE
// ===========================================================================
let tttState = null;
function startTicTacToe() {
  document.getElementById('gameMenu').classList.add('hidden');
  document.getElementById('tttGame').classList.remove('hidden');
  hideGameOver('tttOver');
  tttState = { board: Array(9).fill(null), turn: 'you', over: false };
  renderTtt();
}
function renderTtt() {
  const board = document.getElementById('tttBoard');
  board.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const v = tttState.board[i];
    const cell = document.createElement('div');
    cell.className = 'ttt-cell' + (v === 'x' ? ' x taken' : v === 'o' ? ' o taken' : '');
    cell.textContent = v === 'x' ? '×' : v === 'o' ? '○' : '';
    if (!v && !tttState.over && tttState.turn === 'you') cell.onclick = () => tttClick(i);
    board.appendChild(cell);
  }
  const ind = document.getElementById('tttTurn');
  if (tttState.over) ind.textContent = '';
  else if (tttState.turn === 'you') { ind.className = 'memory-turn-indicator you'; ind.textContent = 'Sie sind dran — wählen Sie ein Feld.'; }
  else { ind.className = 'memory-turn-indicator ai'; ind.textContent = 'Computer überlegt…'; }
}
function tttCheckWin(board, sym) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  return lines.some(([a,b,c]) => board[a]===sym && board[b]===sym && board[c]===sym);
}
function tttClick(i) {
  if (tttState.over || tttState.board[i] || tttState.turn !== 'you') return;
  tttState.board[i] = 'x';
  if (tttCheckWin(tttState.board, 'x')) { tttState.over = true; renderTtt(); showGameOver('tttOver','🎉','Gewonnen!','Drei in einer Reihe!','startTicTacToe'); return; }
  if (tttState.board.every(v => v)) { tttState.over = true; renderTtt(); showGameOver('tttOver','🤝','Unentschieden','Das Brett ist voll.','startTicTacToe'); return; }
  tttState.turn = 'ai';
  renderTtt();
  setTimeout(tttAiMove, 800);
}
function tttAiMove() {
  if (!tttState || tttState.over) return;
  const empty = tttState.board.map((v,i) => v === null ? i : null).filter(i => i !== null);
  // 1) Selbst gewinnen
  for (const i of empty) { tttState.board[i] = 'o'; if (tttCheckWin(tttState.board, 'o')) { tttState.over = true; renderTtt(); showGameOver('tttOver','😊','Schade!','Der Computer hat gewonnen.','startTicTacToe'); return; } tttState.board[i] = null; }
  // 2) Blocken — aber nur in 70% der Fälle (suboptimal, damit es spielbar bleibt)
  if (Math.random() < 0.7) {
    for (const i of empty) { tttState.board[i] = 'x'; if (tttCheckWin(tttState.board, 'x')) { tttState.board[i] = 'o'; renderTtt(); finishTttIfDone(); return; } tttState.board[i] = null; }
  }
  // 3) Mitte > Ecken > Kanten
  let chosen = empty.includes(4) ? 4 : (empty.find(i => [0,2,6,8].includes(i)) ?? pickRandom(empty));
  tttState.board[chosen] = 'o';
  renderTtt();
  finishTttIfDone();
}
function finishTttIfDone() {
  if (tttCheckWin(tttState.board, 'o')) { tttState.over = true; showGameOver('tttOver','😊','Schade!','Der Computer hat gewonnen.','startTicTacToe'); return; }
  if (tttState.board.every(v => v)) { tttState.over = true; showGameOver('tttOver','🤝','Unentschieden','Das Brett ist voll.','startTicTacToe'); return; }
  tttState.turn = 'you';
  renderTtt();
}

// ===========================================================================
// WORTKETTE
// ===========================================================================
const WS_DICTIONARY = [
  'Apfel','Auto','Affe','Ananas','Ampel','Anker','Berg','Banane','Brot','Birne','Brille','Buch','Blume','Baum','Brücke',
  'Computer','Dach','Datum','Eis','Esel','Erde','Eimer','Fenster','Fisch','Fußball','Frosch','Feder','Familie',
  'Garten','Glas','Gabel','Hund','Haus','Hut','Hand','Himmel','Hose','Igel','Insel','Jacke','Kaffee','Katze','Kuchen',
  'Kerze','Kuh','Kind','Lampe','Löffel','Löwe','Maus','Mond','Mantel','Milch','Nacht','Nase','Nadel','Obst','Ofen',
  'Ohr','Pferd','Pilz','Post','Quelle','Rose','Regen','Radio','Rind','Sonne','Stuhl','Schule','Stein','Schiff','See',
  'Tasse','Tisch','Tomate','Tag','Tanne','Uhr','Ufer','Vogel','Vase','Wasser','Wolke','Wagen','Wald','Yacht','Zebra',
  'Zucker','Zug','Zahn','Eichhörnchen','Erdbeere','Engel','Auge','Garten','Banane','Limonade','Salat','Teller',
];
let wsState = null;
function startWordChain() {
  document.getElementById('gameMenu').classList.add('hidden');
  document.getElementById('wordChainGame').classList.remove('hidden');
  hideGameOver('wsOver');
  const start = pickRandom(['Sonne','Banane','Apfel','Garten','Kaffee','Wolke','Tisch']);
  wsState = { lastWord: start, used: [start.toLowerCase()], history: [] };
  document.getElementById('wsLastWord').textContent = start;
  document.getElementById('wsStartLetter').textContent = lastValidLetter(start).toUpperCase();
  document.getElementById('wsInput').value = '';
  document.getElementById('wsMessage').textContent = '';
  document.getElementById('wsHistory').innerHTML = '';
  document.getElementById('wsInput').onkeydown = (e) => { if (e.key === 'Enter') wsSubmit(); };
  setTimeout(() => document.getElementById('wsInput').focus(), 100);
}
function lastValidLetter(word) {
  const w = word.toLowerCase().replace(/[^a-zäöüß]/g,'');
  const last = w.slice(-1);
  // ß und Umlaute → einfache Buchstaben
  return ({'ß':'s','ä':'a','ö':'o','ü':'u'}[last]) || last;
}
function wsSubmit() {
  if (!wsState) return;
  const inp = document.getElementById('wsInput');
  const word = inp.value.trim();
  if (!word) return;
  const msg = document.getElementById('wsMessage');
  const need = lastValidLetter(wsState.lastWord);
  const first = word.toLowerCase().charAt(0);
  if (first !== need) { msg.textContent = `Das Wort muss mit „${need.toUpperCase()}" beginnen.`; return; }
  if (wsState.used.includes(word.toLowerCase())) { msg.textContent = 'Dieses Wort hatten wir schon.'; return; }
  if (word.length < 3) { msg.textContent = 'Bitte ein längeres Wort.'; return; }
  // akzeptieren
  wsState.used.push(word.toLowerCase());
  wsState.history.push({ who: 'you', word });
  wsState.lastWord = word;
  inp.value = '';
  msg.textContent = '✓ Akzeptiert.';
  updateWsHistory();
  // KI dran
  setTimeout(() => {
    if (!wsState) return;
    const need2 = lastValidLetter(wsState.lastWord);
    const candidates = WS_DICTIONARY.filter(w => w.toLowerCase().charAt(0) === need2 && !wsState.used.includes(w.toLowerCase()));
    if (candidates.length === 0) {
      showGameOver('wsOver','🎉','Gewonnen!',`Der Computer fällt kein Wort mit „${need2.toUpperCase()}" mehr ein!`,'startWordChain');
      return;
    }
    const aiWord = pickRandom(candidates);
    wsState.used.push(aiWord.toLowerCase());
    wsState.history.push({ who: 'ai', word: aiWord });
    wsState.lastWord = aiWord;
    document.getElementById('wsLastWord').textContent = aiWord;
    document.getElementById('wsStartLetter').textContent = lastValidLetter(aiWord).toUpperCase();
    msg.textContent = `Computer: „${aiWord}". Sie sind dran.`;
    updateWsHistory();
  }, 800);
}
function updateWsHistory() {
  const c = document.getElementById('wsHistory');
  c.innerHTML = wsState.history.slice(-8).map(h =>
    `<div class="${h.who}">${h.who === 'you' ? 'Sie' : 'PC'}: ${h.word}</div>`
  ).join('');
}

// ===========================================================================
// KREUZWORTRÄTSEL — vereinfachtes Wort-Auswahl-Rätsel
// Patient klickt auf einen Hinweis und wählt aus 4 Wörtern das richtige.
// Das Wort wird ins Gitter eingetragen, alle Wörter zusammen ergeben das Rätsel.
// ===========================================================================
const CROSSWORDS = [
  {
    rows: 11, cols: 11,
    words: [
      { word: 'BLUME', row: 1, col: 1, dir: 'across', clue: 'Wächst im Garten, hat Blütenblätter' },
      { word: 'BUCH',  row: 1, col: 1, dir: 'down',   clue: 'Mit Seiten zum Lesen' },
      { word: 'LAMPE', row: 1, col: 2, dir: 'down',   clue: 'Spendet Licht im Zimmer' },
      { word: 'UFER',  row: 1, col: 3, dir: 'down',   clue: 'Rand eines Flusses' },
      { word: 'MUTTER',row: 1, col: 4, dir: 'down',   clue: 'Frau mit Kindern' },
      { word: 'ENGEL', row: 1, col: 5, dir: 'down',   clue: 'Himmlischer Bote mit Flügeln' },
      { word: 'EHE',   row: 5, col: 2, dir: 'across', clue: 'Heirat zwischen zwei Menschen' },
      { word: 'ROSE',  row: 8, col: 1, dir: 'across', clue: 'Stachelige rote Blume' },
      { word: 'RAD',   row: 8, col: 1, dir: 'down',   clue: 'Dreht sich am Fahrrad' },
      { word: 'OST',   row: 8, col: 2, dir: 'down',   clue: 'Himmelsrichtung der aufgehenden Sonne' },
      { word: 'EIS',   row: 8, col: 4, dir: 'down',   clue: 'Gefrorenes Wasser' },
    ]
  },
  {
    rows: 11, cols: 11,
    words: [
      { word: 'WALD',  row: 2, col: 1, dir: 'across', clue: 'Viele Bäume zusammen' },
      { word: 'WIESE', row: 2, col: 1, dir: 'down',   clue: 'Grasfläche mit Blumen' },
      { word: 'HASE',  row: 1, col: 2, dir: 'down',   clue: 'Tier mit langen Ohren, hoppelt' },
      { word: 'BLATT', row: 1, col: 3, dir: 'down',   clue: 'Wächst am Baum' },
      { word: 'ADLER', row: 1, col: 4, dir: 'down',   clue: 'Großer Greifvogel, Symbol Deutschlands' },
      { word: 'ESEL',  row: 6, col: 1, dir: 'across', clue: 'Graues Tier mit langen Ohren' },
      { word: 'LACHS', row: 6, col: 4, dir: 'down',   clue: 'Rosafarbener Fisch' },
      { word: 'MILCH', row: 8, col: 1, dir: 'across', clue: 'Weiß, von der Kuh' },
      { word: 'HUT',   row: 8, col: 5, dir: 'down',   clue: 'Kopfbedeckung' },
    ]
  },
];

let cwState = null;

function startCrossword() {
  document.getElementById('gameMenu').classList.add('hidden');
  document.getElementById('crosswordGame').classList.remove('hidden');
  hideGameOver('cwOver');
  const puzzle = pickRandom(CROSSWORDS);
  cwState = {
    puzzle,
    grid: Array.from({length: puzzle.rows}, () => Array(puzzle.cols).fill(null)),
    solved: new Set(),
    activeIdx: null,
  };
  // Alle Zellen-Positionen aller Wörter markieren als 'belegt'
  for (const w of puzzle.words) {
    for (let i = 0; i < w.word.length; i++) {
      const r = w.dir === 'down' ? w.row + i : w.row;
      const c = w.dir === 'across' ? w.col + i : w.col;
      if (cwState.grid[r][c] === null) cwState.grid[r][c] = '';
    }
  }
  renderCrossword();
}

function renderCrossword() {
  const grid = document.getElementById('cwGrid');
  const { puzzle } = cwState;
  grid.innerHTML = '';
  // Spalten-Anzahl ans CSS übergeben
  grid.style.setProperty('--cw-cols', puzzle.cols);

  // Numerierungs-Map: erstes Feld jedes Worts kriegt Nummer
  const startNumbers = {};
  puzzle.words.forEach((w, idx) => {
    const key = `${w.row},${w.col}`;
    if (!startNumbers[key]) startNumbers[key] = idx + 1;
  });

  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      const cell = document.createElement('div');
      const val = cwState.grid[r][c];
      if (val === null) {
        cell.className = 'cw-cell empty';
      } else {
        cell.className = 'cw-cell filled';
        const numKey = `${r},${c}`;
        if (startNumbers[numKey]) {
          const numEl = document.createElement('span');
          numEl.className = 'cw-num';
          numEl.textContent = startNumbers[numKey];
          cell.appendChild(numEl);
        }
        // Buchstabe als Text
        if (val) {
          const txt = document.createElement('span');
          txt.className = 'cw-letter';
          txt.textContent = val;
          cell.appendChild(txt);
        }
        // Highlight aktives Wort
        if (cwState.activeIdx !== null) {
          const aw = puzzle.words[cwState.activeIdx];
          for (let i = 0; i < aw.word.length; i++) {
            const ar = aw.dir === 'down' ? aw.row + i : aw.row;
            const ac = aw.dir === 'across' ? aw.col + i : aw.col;
            if (ar === r && ac === c) cell.classList.add('active');
          }
        }
        // Gelöste Felder grün
        for (const idx of cwState.solved) {
          const sw = puzzle.words[idx];
          for (let i = 0; i < sw.word.length; i++) {
            const ar = sw.dir === 'down' ? sw.row + i : sw.row;
            const ac = sw.dir === 'across' ? sw.col + i : sw.col;
            if (ar === r && ac === c) cell.classList.add('solved');
          }
        }
      }
      grid.appendChild(cell);
    }
  }

  // Hinweise nach Richtung gruppiert
  const cluesEl = document.getElementById('cwClues');
  const across = puzzle.words.map((w, i) => ({...w, idx: i})).filter(w => w.dir === 'across');
  const down   = puzzle.words.map((w, i) => ({...w, idx: i})).filter(w => w.dir === 'down');
  const renderList = (list, title) => `
    <div class="cw-clue-list">
      <h4>${title}</h4>
      ${list.map(w => `
        <div class="cw-clue ${cwState.solved.has(w.idx) ? 'solved' : ''} ${cwState.activeIdx === w.idx ? 'active' : ''}"
             onclick="cwSelectClue(${w.idx})">
          ${w.idx + 1}. ${w.clue} <small style="color: var(--ink-soft);">(${w.word.length} Buchstaben)</small>${cwState.solved.has(w.idx) ? ' ✓' : ''}
        </div>
      `).join('')}
    </div>`;
  cluesEl.innerHTML = renderList(across, 'Waagrecht') + renderList(down, 'Senkrecht');

  // Eingabefeld wenn aktives Wort nicht gelöst
  if (cwState.activeIdx !== null && !cwState.solved.has(cwState.activeIdx)) {
    const aw = puzzle.words[cwState.activeIdx];
    const inputHtml = `
      <div class="cw-input-area">
        <div class="cw-input-prompt">${aw.idx + 1}. ${aw.clue}</div>
        <div class="cw-input-row">
          <input type="text" id="cwInput" maxlength="${aw.word.length}"
                 placeholder="Lösung eintragen (${aw.word.length} Buchstaben)"
                 autocomplete="off" autocapitalize="characters" spellcheck="false"
                 onkeydown="if(event.key==='Enter') cwSubmitWord()">
          <button class="btn btn-accent" onclick="cwSubmitWord()">Eintragen</button>
        </div>
        <div id="cwInputFeedback" class="cw-input-feedback">&nbsp;</div>
      </div>`;
    cluesEl.insertAdjacentHTML('beforeend', inputHtml);
    // Eingabefeld direkt fokussieren, dann groß schreiben
    setTimeout(() => {
      const inp = document.getElementById('cwInput');
      if (inp) {
        inp.focus();
        inp.addEventListener('input', () => {
          inp.value = inp.value.toUpperCase().replace(/[^A-ZÄÖÜß]/g, '');
        });
      }
    }, 50);
  }

  // Gewonnen?
  if (cwState.solved.size === puzzle.words.length) {
    showGameOver('cwOver','🎉','Gelöst!','Sie haben alle Wörter gefunden!','startCrossword');
  }
}

function cwSelectClue(idx) {
  if (cwState.solved.has(idx)) return;
  cwState.activeIdx = idx;
  renderCrossword();
}

function cwSubmitWord() {
  const inp = document.getElementById('cwInput');
  const fb = document.getElementById('cwInputFeedback');
  if (!inp || cwState.activeIdx === null) return;
  const guess = inp.value.toUpperCase().trim();
  const aw = cwState.puzzle.words[cwState.activeIdx];

  if (guess.length === 0) {
    fb.textContent = 'Bitte ein Wort eingeben.';
    fb.className = 'cw-input-feedback bad';
    return;
  }
  if (guess.length !== aw.word.length) {
    fb.textContent = `Das Wort braucht genau ${aw.word.length} Buchstaben.`;
    fb.className = 'cw-input-feedback bad';
    return;
  }

  if (guess === aw.word) {
    // Korrekt — Buchstaben ins Gitter eintragen
    for (let i = 0; i < aw.word.length; i++) {
      const r = aw.dir === 'down' ? aw.row + i : aw.row;
      const c = aw.dir === 'across' ? aw.col + i : aw.col;
      cwState.grid[r][c] = aw.word[i];
    }
    cwState.solved.add(cwState.activeIdx);
    cwState.activeIdx = null;
    renderCrossword();
  } else {
    // Falsch — Hinweis anzeigen, Eingabe leeren, NICHTS in den Kacheln eintragen
    fb.innerHTML = '✗ Leider falsch — versuchen Sie es noch einmal.';
    fb.className = 'cw-input-feedback bad';
    inp.value = '';
    inp.focus();
  }
}

// Alte Funktion behalten falls Code anderswo darauf referenziert
function cwAnswer(choice) {
  // Legacy: nicht mehr verwendet, nur falls etwas darauf zugreift
}

// ===========================================================================
// DAME — klassisches Brettspiel mit KI
// 'w' = weißer Stein (Spieler), 'W' = weiße Dame
// 'b' = schwarzer Stein (Computer), 'B' = schwarze Dame
// ===========================================================================
let ckState = null;

function startCheckers() {
  document.getElementById('gameMenu').classList.add('hidden');
  document.getElementById('checkersGame').classList.remove('hidden');
  hideGameOver('ckOver');
  // Brett initialisieren — Steine nur auf dunklen Feldern (r+c ungerade)
  const board = Array.from({length: 8}, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = 'b';
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) board[r][c] = 'w';
    }
  }
  ckState = {
    board,
    turn: 'w',  // Spieler beginnt
    selected: null,
    validTargets: [],
    mustChain: null,  // bei Kettenschlag: { r, c }
  };
  renderCheckers();
}

function ckIsWhite(p) { return p === 'w' || p === 'W'; }
function ckIsBlack(p) { return p === 'b' || p === 'B'; }
function ckIsKing(p)  { return p === 'W' || p === 'B'; }
function ckOpponent(t) { return t === 'w' ? 'b' : 'w'; }
function ckSamePlayer(p1, p2) {
  if (!p1 || !p2) return false;
  return (ckIsWhite(p1) && ckIsWhite(p2)) || (ckIsBlack(p1) && ckIsBlack(p2));
}
function ckIsOpponentPiece(p, turn) {
  if (!p) return false;
  return turn === 'w' ? ckIsBlack(p) : ckIsWhite(p);
}

// Liefert alle möglichen Züge für einen Stein an (r,c)
// Schlag-Züge haben Priorität — wenn ein Schlag möglich ist, müssen einfache Züge ignoriert werden
function ckMovesFrom(board, r, c, onlyJumps = false) {
  const piece = board[r][c];
  if (!piece) return [];
  const isKing = ckIsKing(piece);
  const directions = isKing ? [[-1,-1],[-1,1],[1,-1],[1,1]]
    : (ckIsWhite(piece) ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]]);
  const moves = [];
  // Schlag-Züge zuerst
  for (const [dr, dc] of directions) {
    const er = r + dr * 2, ec = c + dc * 2;
    const mr = r + dr, mc = c + dc;
    if (er < 0 || er > 7 || ec < 0 || ec > 7) continue;
    if (board[er][ec]) continue;
    const middle = board[mr][mc];
    if (middle && !ckSamePlayer(piece, middle)) {
      moves.push({ to: [er, ec], capture: [mr, mc], isJump: true });
    }
  }
  if (moves.length > 0 || onlyJumps) return moves;
  // Einfache Züge
  for (const [dr, dc] of directions) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
    if (board[nr][nc]) continue;
    moves.push({ to: [nr, nc], capture: null, isJump: false });
  }
  return moves;
}

// Liefert alle Züge eines Spielers (mit Schlag-Priorität)
function ckAllMoves(board, turn) {
  const allJumps = [];
  const allRegular = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      if (turn === 'w' && !ckIsWhite(p)) continue;
      if (turn === 'b' && !ckIsBlack(p)) continue;
      const moves = ckMovesFrom(board, r, c);
      for (const m of moves) {
        if (m.isJump) allJumps.push({ from: [r, c], ...m });
        else allRegular.push({ from: [r, c], ...m });
      }
    }
  }
  return allJumps.length > 0 ? allJumps : allRegular;
}

function renderCheckers() {
  const boardEl = document.getElementById('checkersBoard');
  boardEl.innerHTML = '';
  let whiteCount = 0, blackCount = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      const isDark = (r + c) % 2 === 1;
      cell.className = 'ck-cell ' + (isDark ? 'dark' : 'light');
      const piece = ckState.board[r][c];
      if (piece) {
        const pe = document.createElement('div');
        pe.className = 'ck-piece ' + (ckIsWhite(piece) ? 'white' : 'black');
        if (ckIsKing(piece)) pe.textContent = '♛';
        cell.appendChild(pe);
        if (ckIsWhite(piece)) whiteCount++; else blackCount++;
      }
      // Markierungen
      if (ckState.selected && ckState.selected[0] === r && ckState.selected[1] === c) {
        cell.classList.add('selected');
      }
      if (ckState.validTargets.some(t => t.to[0] === r && t.to[1] === c)) {
        cell.classList.add('target');
      }
      cell.onclick = () => ckCellClick(r, c);
      boardEl.appendChild(cell);
    }
  }

  document.getElementById('ckYouLeft').textContent = whiteCount;
  document.getElementById('ckAiLeft').textContent = blackCount;
  document.getElementById('ckTurn').textContent = ckState.turn === 'w' ? 'Sie' : 'Computer';

  // Sieg-Bedingungen
  if (whiteCount === 0) {
    showGameOver('ckOver', '😔', 'Verloren', 'Der Computer hat alle Ihre Steine geschlagen.', 'startCheckers');
    return;
  }
  if (blackCount === 0) {
    showGameOver('ckOver', '🎉', 'Gewonnen!', 'Sie haben alle Computer-Steine geschlagen!', 'startCheckers');
    return;
  }
  // Wenn der Spieler dran ist und keine Züge mehr hat → verloren
  if (ckState.turn === 'w' && ckAllMoves(ckState.board, 'w').length === 0) {
    showGameOver('ckOver', '😔', 'Verloren', 'Sie können keinen Zug mehr machen.', 'startCheckers');
    return;
  }
  if (ckState.turn === 'b' && ckAllMoves(ckState.board, 'b').length === 0) {
    showGameOver('ckOver', '🎉', 'Gewonnen!', 'Der Computer kann keinen Zug mehr machen.', 'startCheckers');
    return;
  }
}

function ckCellClick(r, c) {
  if (ckState.turn !== 'w') return;
  const piece = ckState.board[r][c];

  // Wenn ein Stein ausgewählt ist und der Klick auf ein Zielfeld geht
  if (ckState.selected) {
    const target = ckState.validTargets.find(t => t.to[0] === r && t.to[1] === c);
    if (target) {
      ckExecuteMove(ckState.selected[0], ckState.selected[1], target);
      return;
    }
  }

  // Im Kettenschlag-Modus darf nur der gleiche Stein bewegt werden
  if (ckState.mustChain) {
    if (r === ckState.mustChain[0] && c === ckState.mustChain[1]) {
      const moves = ckMovesFrom(ckState.board, r, c, true);  // nur Sprünge
      ckState.selected = [r, c];
      ckState.validTargets = moves;
      renderCheckers();
    }
    return;
  }

  // Eigenen Stein auswählen
  if (piece && ckIsWhite(piece)) {
    const allMoves = ckAllMoves(ckState.board, 'w');
    const myMoves = allMoves.filter(m => m.from[0] === r && m.from[1] === c);
    if (myMoves.length > 0) {
      ckState.selected = [r, c];
      ckState.validTargets = myMoves.map(m => ({ to: m.to, capture: m.capture, isJump: m.isJump }));
      renderCheckers();
    } else {
      // Falls Schlagzwang besteht
      const hasJumps = allMoves.some(m => m.isJump);
      if (hasJumps) {
        document.getElementById('ckMessage').textContent = 'Sie müssen schlagen! Wählen Sie einen Stein, der schlagen kann.';
      }
    }
  }
}

function ckExecuteMove(fr, fc, move) {
  const [tr, tc] = move.to;
  const piece = ckState.board[fr][fc];
  ckState.board[tr][tc] = piece;
  ckState.board[fr][fc] = null;
  if (move.capture) {
    ckState.board[move.capture[0]][move.capture[1]] = null;
  }
  // Damen-Beförderung
  if (piece === 'w' && tr === 0) ckState.board[tr][tc] = 'W';
  if (piece === 'b' && tr === 7) ckState.board[tr][tc] = 'B';

  // Kettenschlag prüfen — nur wenn dieser Zug ein Sprung war und es weitere Sprünge gibt
  if (move.isJump) {
    const followups = ckMovesFrom(ckState.board, tr, tc, true);
    if (followups.length > 0) {
      ckState.selected = [tr, tc];
      ckState.validTargets = followups;
      ckState.mustChain = [tr, tc];
      document.getElementById('ckMessage').textContent = 'Kettenschlag! Sie müssen erneut schlagen.';
      renderCheckers();
      return;
    }
  }

  // Normaler Zug-Abschluss
  ckState.selected = null;
  ckState.validTargets = [];
  ckState.mustChain = null;
  ckState.turn = ckOpponent(ckState.turn);
  document.getElementById('ckMessage').textContent = ckState.turn === 'w' ? 'Sie sind am Zug.' : 'Computer denkt nach…';
  renderCheckers();

  if (ckState.turn === 'b') {
    setTimeout(ckAiTurn, 800);
  }
}

// Einfache KI: bewertet jeden Zug, bevorzugt Schläge und Damen-Beförderungen
function ckEvaluateBoard(board) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      let v = ckIsKing(p) ? 3 : 1;
      // Vorrücken belohnen
      if (p === 'b') v += r * 0.1;
      if (p === 'w') v += (7 - r) * 0.1;
      score += ckIsBlack(p) ? v : -v;
    }
  }
  return score;
}

function ckAiTurn() {
  const moves = ckAllMoves(ckState.board, 'b');
  if (moves.length === 0) { renderCheckers(); return; }
  // Jeder Zug wird simuliert, bestes Ergebnis gewählt
  let bestMove = null, bestScore = -Infinity;
  for (const m of moves) {
    const cloned = ckState.board.map(row => row.slice());
    const piece = cloned[m.from[0]][m.from[1]];
    cloned[m.to[0]][m.to[1]] = piece;
    cloned[m.from[0]][m.from[1]] = null;
    if (m.capture) cloned[m.capture[0]][m.capture[1]] = null;
    if (piece === 'b' && m.to[0] === 7) cloned[m.to[0]][m.to[1]] = 'B';
    const score = ckEvaluateBoard(cloned) + (m.isJump ? 2 : 0) + Math.random() * 0.3;
    if (score > bestScore) { bestScore = score; bestMove = m; }
  }
  ckExecuteAiMove(bestMove);
}

function ckExecuteAiMove(move) {
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = ckState.board[fr][fc];
  ckState.board[tr][tc] = piece;
  ckState.board[fr][fc] = null;
  if (move.capture) {
    ckState.board[move.capture[0]][move.capture[1]] = null;
  }
  if (piece === 'b' && tr === 7) ckState.board[tr][tc] = 'B';

  // Kettenschlag der KI
  if (move.isJump) {
    const followups = ckMovesFrom(ckState.board, tr, tc, true);
    if (followups.length > 0) {
      // Besten Folge-Sprung wählen
      let best = null, bestScore = -Infinity;
      for (const f of followups) {
        const cloned = ckState.board.map(row => row.slice());
        const p = cloned[tr][tc];
        cloned[f.to[0]][f.to[1]] = p;
        cloned[tr][tc] = null;
        if (f.capture) cloned[f.capture[0]][f.capture[1]] = null;
        if (p === 'b' && f.to[0] === 7) cloned[f.to[0]][f.to[1]] = 'B';
        const sc = ckEvaluateBoard(cloned) + 2 + Math.random() * 0.3;
        if (sc > bestScore) { bestScore = sc; best = f; }
      }
      renderCheckers();
      setTimeout(() => ckExecuteAiMove({ from: [tr, tc], ...best }), 700);
      return;
    }
  }

  ckState.turn = 'w';
  document.getElementById('ckMessage').textContent = 'Sie sind am Zug.';
  renderCheckers();
}

// ===========================================================================
// KNIFFEL — Würfelspiel mit 13 Runden
// Pro Runde: bis zu 3 Würfe, dazwischen darf man Würfel "sperren"
// Am Ende: für eine der 13 Kategorien eintragen
// ===========================================================================
let knState = null;

const KNIFFEL_CATEGORIES = [
  { id: 'einser',  name: 'Einser',  desc: 'Summe aller Einser', group: 'oben' },
  { id: 'zweier',  name: 'Zweier',  desc: 'Summe aller Zweier', group: 'oben' },
  { id: 'dreier',  name: 'Dreier',  desc: 'Summe aller Dreier', group: 'oben' },
  { id: 'vierer',  name: 'Vierer',  desc: 'Summe aller Vierer', group: 'oben' },
  { id: 'fuenfer', name: 'Fünfer',  desc: 'Summe aller Fünfer', group: 'oben' },
  { id: 'sechser', name: 'Sechser', desc: 'Summe aller Sechser', group: 'oben' },
  { id: 'dreierpasch', name: 'Dreierpasch', desc: '3 gleiche → Summe aller Würfel', group: 'unten' },
  { id: 'viererpasch', name: 'Viererpasch', desc: '4 gleiche → Summe aller Würfel', group: 'unten' },
  { id: 'fullhouse',   name: 'Full House',  desc: '3+2 gleiche → 25 Punkte', group: 'unten' },
  { id: 'kleinestrasse', name: 'Kleine Straße', desc: '4 aufeinander folgend → 30 Punkte', group: 'unten' },
  { id: 'grossestrasse', name: 'Große Straße', desc: '5 aufeinander folgend → 40 Punkte', group: 'unten' },
  { id: 'kniffel', name: 'Kniffel', desc: '5 gleiche → 50 Punkte', group: 'unten' },
  { id: 'chance',  name: 'Chance',  desc: 'Summe aller Würfel', group: 'unten' },
];

function startKniffel() {
  document.getElementById('gameMenu').classList.add('hidden');
  document.getElementById('kniffelGame').classList.remove('hidden');
  hideGameOver('knOver');
  knState = {
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    rollsLeft: 3,
    round: 1,           // 1-13, beide Spieler haben je eine Runde
    activePlayer: 'you',  // 'you' oder 'ai'
    scores: { you: {}, ai: {} },  // pro Spieler die Kategorien
    hasRolled: false,
    rolling: false,
    aiThinking: false,
  };
  renderKniffel();
}

function knCalcPoints(dice, catId) {
  const counts = [0, 0, 0, 0, 0, 0, 0]; // Index 1-6
  for (const d of dice) counts[d]++;
  const sum = dice.reduce((a, b) => a + b, 0);
  switch (catId) {
    case 'einser':  return counts[1] * 1;
    case 'zweier':  return counts[2] * 2;
    case 'dreier':  return counts[3] * 3;
    case 'vierer':  return counts[4] * 4;
    case 'fuenfer': return counts[5] * 5;
    case 'sechser': return counts[6] * 6;
    case 'dreierpasch': return counts.some(c => c >= 3) ? sum : 0;
    case 'viererpasch': return counts.some(c => c >= 4) ? sum : 0;
    case 'fullhouse': {
      const has3 = counts.some(c => c === 3);
      const has2 = counts.some(c => c === 2);
      // Auch 5 gleiche zählen als Full House (manche Regeln)
      const has5 = counts.some(c => c === 5);
      return (has3 && has2) || has5 ? 25 : 0;
    }
    case 'kleinestrasse': {
      const u = [...new Set(dice)].sort((a, b) => a - b);
      // 4 aufeinander folgende
      const seqs = [[1,2,3,4],[2,3,4,5],[3,4,5,6]];
      return seqs.some(s => s.every(n => u.includes(n))) ? 30 : 0;
    }
    case 'grossestrasse': {
      const u = [...new Set(dice)].sort((a, b) => a - b);
      const seqs = [[1,2,3,4,5],[2,3,4,5,6]];
      return seqs.some(s => s.every(n => u.includes(n))) ? 40 : 0;
    }
    case 'kniffel': return counts.some(c => c === 5) ? 50 : 0;
    case 'chance': return sum;
  }
  return 0;
}

function knRoll() {
  if (knState.activePlayer !== 'you') return;  // nur Spieler darf manuell würfeln
  if (knState.rollsLeft <= 0) return;
  if (knState.rolling) return;  // verhindert Doppel-Klick während Animation
  knState.rolling = true;

  // Becher schütteln
  const cup = document.getElementById('knCup');
  cup.classList.remove('shaking');
  // Trick um Animation neu zu starten
  void cup.offsetWidth;
  cup.classList.add('shaking');

  // Während der Animation zufällige Zwischen-Augenzahlen anzeigen (für "Rollen"-Effekt)
  const tickInterval = setInterval(() => {
    for (let i = 0; i < 5; i++) {
      if (!knState.held[i]) knState.dice[i] = rndInt(1, 6);
    }
    renderKniffelDiceOnly();
  }, 90);

  // Würfel-Wackel-Animation an den Würfeln selbst
  setTimeout(() => {
    const dice = document.querySelectorAll('.kn-die');
    dice.forEach((die, i) => {
      if (!knState.held[i]) {
        die.classList.remove('rolling');
        void die.offsetWidth;
        die.classList.add('rolling');
      }
    });
  }, 100);

  // Nach 700ms: finales Ergebnis festlegen + Animation stoppen
  setTimeout(() => {
    clearInterval(tickInterval);
    for (let i = 0; i < 5; i++) {
      if (!knState.held[i]) knState.dice[i] = rndInt(1, 6);
    }
    knState.rollsLeft--;
    knState.hasRolled = true;
    knState.rolling = false;
    cup.classList.remove('shaking');
    renderKniffel();
  }, 700);
}

function knToggleHold(i) {
  if (knState.activePlayer !== 'you') return;
  if (!knState.hasRolled || knState.rollsLeft === 0 || knState.rolling) return;
  knState.held[i] = !knState.held[i];
  renderKniffel();
}

function knChooseCategory(catId) {
  if (knState.activePlayer !== 'you') return;  // nur Spieler darf manuell wählen
  if (!knState.hasRolled) return;
  if (knState.scores.you[catId] !== undefined) return;
  if (knState.rolling) return;
  const points = knCalcPoints(knState.dice, catId);
  const cat = KNIFFEL_CATEGORIES.find(c => c.id === catId);
  const confirmEl = document.getElementById('knConfirm');
  confirmEl.classList.remove('hidden');
  confirmEl.innerHTML = `
    <div class="kn-confirm-overlay">
      <div class="kn-confirm-modal">
        <h3>${cat.name}</h3>
        <p>${cat.desc}</p>
        <div class="kn-confirm-points ${points === 0 ? 'zero' : ''}">${points}</div>
        <p style="font-size: 14px;">${points === 0 ? 'Diese Kategorie würde mit 0 Punkten gestrichen.' : `Sie bekommen <strong>${points} Punkte</strong> für diese Kategorie.`}</p>
        <div class="kn-confirm-actions">
          <button class="btn btn-accent" onclick="knConfirmCategory('${catId}')">✓ Eintragen</button>
          <button class="btn btn-secondary" onclick="knCancelConfirm()">Doch nicht</button>
        </div>
      </div>
    </div>`;
}

function knCancelConfirm() {
  const confirmEl = document.getElementById('knConfirm');
  confirmEl.classList.add('hidden');
  confirmEl.innerHTML = '';
}

function knConfirmCategory(catId) {
  knCancelConfirm();
  const points = knCalcPoints(knState.dice, catId);
  knState.scores.you[catId] = points;
  knNextTurn();
}

// Wechsel zum nächsten Spieler (oder neue Runde / Spielende)
function knNextTurn() {
  // Würfel zurücksetzen
  knState.dice = [1, 2, 3, 4, 5];
  knState.held = [false, false, false, false, false];
  knState.rollsLeft = 3;
  knState.hasRolled = false;

  if (knState.activePlayer === 'you') {
    knState.activePlayer = 'ai';
  } else {
    knState.activePlayer = 'you';
    knState.round++;
  }
  // Spielende?
  if (knState.round > 13) {
    renderKniffel();
    return;
  }
  renderKniffel();
  // Wenn KI dran ist, sie automatisch spielen lassen
  if (knState.activePlayer === 'ai') {
    setTimeout(knAiPlayTurn, 900);
  }
}

// === KI-Spielzug ===
// Die KI würfelt animiert (Würfel + Becher), entscheidet was zu halten
// und wählt am Ende eine Kategorie. Sie macht manchmal absichtlich Fehler.
function knAiPlayTurn() {
  if (knState.activePlayer !== 'ai') return;
  knState.aiThinking = true;
  // Erster Wurf
  knAiRollAnimated(() => {
    // Nach 1. Wurf: entscheiden was zu halten
    knAiDecideHolds();
    renderKniffel();
    setTimeout(() => {
      // Zweiter Wurf
      knAiRollAnimated(() => {
        knAiDecideHolds();
        renderKniffel();
        setTimeout(() => {
          // Dritter Wurf
          knAiRollAnimated(() => {
            // Jetzt Kategorie wählen
            setTimeout(() => {
              const catId = knAiPickCategory();
              const points = knCalcPoints(knState.dice, catId);
              knState.scores.ai[catId] = points;
              knState.aiThinking = false;
              // Kurz Bestätigungs-Modal mit KI-Wahl
              knShowAiChoice(catId, points, () => {
                knNextTurn();
              });
            }, 600);
          });
        }, 800);
      });
    }, 800);
  });
}

// Würfeln-Animation für KI (sehr ähnlich knRoll aber ohne Spieler-Check)
function knAiRollAnimated(onDone) {
  if (knState.rollsLeft <= 0) { onDone(); return; }
  knState.rolling = true;
  const cup = document.getElementById('knCup');
  if (cup) {
    cup.classList.remove('shaking');
    void cup.offsetWidth;
    cup.classList.add('shaking');
  }
  const tickInterval = setInterval(() => {
    for (let i = 0; i < 5; i++) {
      if (!knState.held[i]) knState.dice[i] = rndInt(1, 6);
    }
    renderKniffelDiceOnly();
  }, 90);
  setTimeout(() => {
    const dice = document.querySelectorAll('.kn-die');
    dice.forEach((die, i) => {
      if (!knState.held[i]) {
        die.classList.remove('rolling');
        void die.offsetWidth;
        die.classList.add('rolling');
      }
    });
  }, 100);
  setTimeout(() => {
    clearInterval(tickInterval);
    for (let i = 0; i < 5; i++) {
      if (!knState.held[i]) knState.dice[i] = rndInt(1, 6);
    }
    knState.rollsLeft--;
    knState.hasRolled = true;
    knState.rolling = false;
    if (cup) cup.classList.remove('shaking');
    renderKniffel();
    onDone();
  }, 700);
}

// KI entscheidet welche Würfel zu halten
// Heuristik: das häufigste Auge behalten, Straßen erkennen, manchmal "vergisst" sie etwas
function knAiDecideHolds() {
  const counts = [0,0,0,0,0,0,0];
  for (const d of knState.dice) counts[d]++;
  const maxCount = Math.max(...counts.slice(1));
  const bestFace = counts.indexOf(maxCount);
  const aiScores = knState.scores.ai;

  // Mit 25% Wahrscheinlichkeit "vergisst" die KI etwas Sinnvolles zu behalten
  // (= echter Fehler, macht das Spiel menschlicher)
  const makesMistake = Math.random() < 0.25;

  // Was haben wir? Prüfen auf interessante Konstellationen
  const unique = [...new Set(knState.dice)].sort((a,b) => a-b);
  const hasStrasseChance = unique.length >= 3 &&
    (unique.includes(3) && unique.includes(4) || unique.includes(4) && unique.includes(5));

  // Schon viel von einer Seite? (Pasch-Strategie)
  if (maxCount >= 3 && !makesMistake) {
    // Drillinge, Vierlinge, Kniffel: alle gleichen behalten
    for (let i = 0; i < 5; i++) {
      knState.held[i] = (knState.dice[i] === bestFace);
    }
  } else if (maxCount >= 2 && !makesMistake) {
    // Paar — behalten, vielleicht versuchen mehr zu sammeln
    // Bonus: wenn Paar von hohen Zahlen, lieber behalten
    if (bestFace >= 4 || aiScores[knFaceToCategory(bestFace)] === undefined) {
      for (let i = 0; i < 5; i++) {
        knState.held[i] = (knState.dice[i] === bestFace);
      }
    } else {
      // Kleines Paar — vielleicht doch nicht
      for (let i = 0; i < 5; i++) {
        knState.held[i] = false;
      }
    }
  } else if (hasStrasseChance && !makesMistake) {
    // Versucht Straße zu sammeln — alle einzigartigen behalten
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      if (!seen.has(knState.dice[i])) {
        knState.held[i] = true;
        seen.add(knState.dice[i]);
      } else {
        knState.held[i] = false;
      }
    }
  } else {
    // Nichts Spannendes oder Fehler — alles neu würfeln,
    // außer hohen Einzelwürfeln (5, 6)
    for (let i = 0; i < 5; i++) {
      knState.held[i] = !makesMistake && knState.dice[i] >= 5;
    }
  }
}

function knFaceToCategory(face) {
  return ['einser','zweier','dreier','vierer','fuenfer','sechser'][face-1];
}

// KI wählt Kategorie — meistens beste, manchmal suboptimal
function knAiPickCategory() {
  const aiScores = knState.scores.ai;
  const available = KNIFFEL_CATEGORIES.filter(c => aiScores[c.id] === undefined);

  // Punkte für jede freie Kategorie berechnen
  const options = available.map(c => ({
    id: c.id,
    points: knCalcPoints(knState.dice, c.id),
    cat: c
  }));
  // Nach Punkten absteigend
  options.sort((a, b) => b.points - a.points);

  // 25% Chance auf suboptimale Wahl: nicht die beste, sondern eine zufällige
  // aus den top 3 Kategorien (oder zufällig wenn alle 0 Punkte geben)
  const makesMistake = Math.random() < 0.25;
  if (makesMistake && options.length >= 2) {
    // Zufällig aus den Top 3 wählen — aber nicht wenn der Verlust zu groß wäre
    const top3 = options.slice(0, Math.min(3, options.length));
    const picked = top3[rndInt(0, top3.length - 1)];
    // Schutz: wenn die beste 30+ Punkte hat und die zufällige 0, lieber doch beste
    if (options[0].points >= 30 && picked.points === 0) {
      return options[0].id;
    }
    return picked.id;
  }
  return options[0].id;
}

// Zeigt der Spielerin/dem Spieler welche Kategorie die KI gewählt hat
function knShowAiChoice(catId, points, onContinue) {
  const cat = KNIFFEL_CATEGORIES.find(c => c.id === catId);
  const confirmEl = document.getElementById('knConfirm');
  confirmEl.classList.remove('hidden');
  confirmEl.innerHTML = `
    <div class="kn-confirm-overlay">
      <div class="kn-confirm-modal">
        <h3>🤖 Computer wählt</h3>
        <p><strong>${cat.name}</strong></p>
        <div class="kn-confirm-points ${points === 0 ? 'zero' : ''}">${points}</div>
        <p style="font-size: 14px;">${points === 0 ? 'Der Computer streicht diese Kategorie.' : `Der Computer bekommt <strong>${points} Punkte</strong>.`}</p>
        <div class="kn-confirm-actions">
          <button class="btn btn-accent" id="knAiOkBtn">Weiter</button>
        </div>
      </div>
    </div>`;
  document.getElementById('knAiOkBtn').onclick = () => {
    knCancelConfirm();
    onContinue();
  };
}

function knTotalPoints(player) {
  player = player || 'you';
  const scores = knState.scores[player];
  let sum = 0;
  for (const id in scores) sum += scores[id];
  const oben = ['einser','zweier','dreier','vierer','fuenfer','sechser'];
  let obenSum = 0;
  for (const id of oben) if (scores[id] !== undefined) obenSum += scores[id];
  if (obenSum >= 63) sum += 35;
  return sum;
}

// Erstellt einen Würfel mit Pip-Darstellung
function knBuildDie(value, held, disabled, idx) {
  const die = document.createElement('div');
  die.className = 'kn-die';
  if (held) die.classList.add('held');
  if (disabled) die.classList.add('disabled');
  die.setAttribute('data-value', value);
  // Pips als Kinder
  for (let i = 0; i < value; i++) {
    const pip = document.createElement('div');
    pip.className = 'kn-pip';
    die.appendChild(pip);
  }
  if (idx !== undefined && !disabled) {
    die.onclick = () => knToggleHold(idx);
  }
  return die;
}

// Nur die Würfel neu zeichnen (für Animations-Ticks ohne Volltext-Refresh)
function renderKniffelDiceOnly() {
  const diceEl = document.getElementById('knDice');
  if (!diceEl) return;
  diceEl.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const die = knBuildDie(knState.dice[i], knState.held[i], true);
    diceEl.appendChild(die);
  }
}

function renderKniffel() {
  document.getElementById('knRound').textContent = Math.min(knState.round, 13);
  document.getElementById('knRolls').textContent = knState.rollsLeft;
  // Status-Bar zeigt jetzt beide Punktzahlen
  const yourTotal = knTotalPoints('you');
  const aiTotal = knTotalPoints('ai');
  document.getElementById('knTotal').textContent = `${yourTotal} : ${aiTotal}`;

  // Aktiver-Spieler-Badge ganz oben
  let badgeEl = document.getElementById('knPlayerBadge');
  if (!badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.id = 'knPlayerBadge';
    badgeEl.className = 'kn-player-badge';
    const statusEl = document.querySelector('#kniffelGame .kn-status');
    if (statusEl) statusEl.parentNode.insertBefore(badgeEl, statusEl);
  }
  const isYou = knState.activePlayer === 'you';
  badgeEl.className = 'kn-player-badge ' + (isYou ? 'you' : 'ai');
  badgeEl.innerHTML = isYou
    ? '👤 <strong>Sie sind dran</strong>'
    : '🤖 <strong>Computer ist dran</strong>' + (knState.aiThinking ? ' — denkt nach…' : '');

  // Würfel
  const diceEl = document.getElementById('knDice');
  diceEl.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const disabled = !knState.hasRolled || knState.rollsLeft === 0 || !isYou;
    const die = knBuildDie(knState.dice[i], knState.held[i], disabled, isYou ? i : undefined);
    diceEl.appendChild(die);
  }

  // Becher und Würfel-Button
  const cup = document.getElementById('knCup');
  const cupLabel = document.getElementById('knCupLabel');
  const rollBtn = document.getElementById('knRollBtn');
  const help = document.getElementById('knHelp');

  if (!isYou) {
    // KI dran: Würfel zeigen, Becher verstecken
    diceEl.style.display = '';
    cup.style.display = 'none';
    cupLabel.style.display = 'none';
    rollBtn.style.display = 'none';
    help.textContent = '🤖 Computer würfelt und entscheidet selbst.';
  } else if (knState.rollsLeft > 0 && !knState.hasRolled) {
    diceEl.style.display = 'none';
    cup.style.display = '';
    cupLabel.style.display = '';
    cupLabel.textContent = `Runde ${knState.round} von 13 — Tippen Sie auf den Becher 🥃`;
    rollBtn.style.display = 'none';
    help.textContent = '';
  } else if (knState.rollsLeft > 0 && knState.hasRolled) {
    diceEl.style.display = '';
    cup.style.display = 'none';
    cupLabel.style.display = 'none';
    rollBtn.style.display = '';
    rollBtn.textContent = `🥃 Nochmal würfeln (${knState.rollsLeft} übrig)`;
    help.textContent = 'Tippen Sie Würfel an um sie zu behalten (📌). Oder wählen Sie unten eine Kategorie.';
  } else {
    diceEl.style.display = '';
    cup.style.display = 'none';
    cupLabel.style.display = 'none';
    rollBtn.style.display = 'none';
    help.textContent = 'Keine Würfe mehr — wählen Sie unten eine Kategorie.';
  }

  // Wertungsblatt — zeigt BEIDE Spalten
  const card = document.getElementById('knCard');
  const renderRow = (cat) => {
    const yourLocked = knState.scores.you[cat.id] !== undefined;
    const aiLocked   = knState.scores.ai[cat.id] !== undefined;
    const yourFinal  = yourLocked ? knState.scores.you[cat.id] : null;
    const aiFinal    = aiLocked ? knState.scores.ai[cat.id] : null;
    // Vorschau nur für aktiven Spieler
    const previewYou = (isYou && !yourLocked && knState.hasRolled) ? knCalcPoints(knState.dice, cat.id) : null;

    const yourCell = yourLocked
      ? `<span class="kn-points-final ${yourFinal === 0 ? 'zero' : ''}">${yourFinal}</span>`
      : (previewYou !== null
          ? `<span class="kn-points-input">${previewYou}</span>`
          : `<span class="kn-points-input" style="opacity: 0.3;">—</span>`);
    const aiCell = aiLocked
      ? `<span class="kn-points-final ${aiFinal === 0 ? 'zero' : ''}">${aiFinal}</span>`
      : `<span class="kn-points-input" style="opacity: 0.3;">—</span>`;

    const clickable = isYou && !yourLocked && knState.hasRolled;
    return `<div class="kn-row-2col ${yourLocked ? 'kn-locked' : ''} ${clickable ? 'kn-clickable' : ''}"
                 ${clickable ? `onclick="knChooseCategory('${cat.id}')"` : ''}>
      <div class="kn-name-col">
        <div class="kn-name">${cat.name}</div>
        <small style="color: var(--ink-soft); font-size: 11px;">${cat.desc}</small>
      </div>
      <div class="kn-score-col">${yourCell}</div>
      <div class="kn-score-col">${aiCell}</div>
    </div>`;
  };

  const oberer = KNIFFEL_CATEGORIES.filter(c => c.group === 'oben');
  const unterer = KNIFFEL_CATEGORIES.filter(c => c.group === 'unten');
  let yourObenSum = 0, aiObenSum = 0;
  for (const c of oberer) {
    if (knState.scores.you[c.id] !== undefined) yourObenSum += knState.scores.you[c.id];
    if (knState.scores.ai[c.id]  !== undefined) aiObenSum  += knState.scores.ai[c.id];
  }

  const headerHtml = `<div class="kn-row-2col kn-header">
    <div class="kn-name-col"><strong>Kategorie</strong></div>
    <div class="kn-score-col"><strong>👤 Sie</strong></div>
    <div class="kn-score-col"><strong>🤖 KI</strong></div>
  </div>`;

  const groupHtml = (title, items) =>
    `<h4>${title}</h4>` + items.map(renderRow).join('');

  const summaryHtml = `<div class="kn-row-2col kn-summary-row">
    <div class="kn-name-col">Obere Summe (Bonus bei ≥63)</div>
    <div class="kn-score-col ${yourObenSum >= 63 ? 'bonus' : ''}">${yourObenSum}${yourObenSum >= 63 ? '+35' : ''}</div>
    <div class="kn-score-col ${aiObenSum >= 63 ? 'bonus' : ''}">${aiObenSum}${aiObenSum >= 63 ? '+35' : ''}</div>
  </div>`;

  const totalsHtml = `<div class="kn-row-2col kn-totals">
    <div class="kn-name-col"><strong>Gesamtpunkte</strong></div>
    <div class="kn-score-col"><strong>${yourTotal}</strong></div>
    <div class="kn-score-col"><strong>${aiTotal}</strong></div>
  </div>`;

  card.innerHTML =
    headerHtml +
    groupHtml('↑ Oberer Block', oberer) +
    summaryHtml +
    groupHtml('↓ Unterer Block', unterer) +
    totalsHtml;

  // Spiel zu Ende?
  if (knState.round > 13) {
    let title, emoji, msg;
    if (yourTotal > aiTotal) {
      title = 'Sie haben gewonnen!'; emoji = '🏆';
      msg = `Endstand: <strong>${yourTotal}</strong> zu ${aiTotal} — Glückwunsch!`;
    } else if (yourTotal < aiTotal) {
      title = 'Der Computer gewinnt'; emoji = '🤖';
      msg = `Endstand: ${yourTotal} zu <strong>${aiTotal}</strong>. Beim nächsten Mal!`;
    } else {
      title = 'Unentschieden!'; emoji = '🤝';
      msg = `Beide haben <strong>${yourTotal}</strong> Punkte erreicht.`;
    }
    showGameOver('knOver', emoji, title, msg, 'startKniffel');
  }
}


function switchMode(mode) {
  document.getElementById('homeView').classList.toggle('hidden', mode !== 'home');
  document.getElementById('familyView').classList.toggle('hidden', mode !== 'family');
  document.getElementById('patientView').classList.toggle('hidden', mode !== 'patient');
  document.getElementById('gamesView').classList.toggle('hidden', mode !== 'games');
  document.getElementById('modeHome').classList.toggle('active', mode === 'home');
  document.getElementById('modeFamily').classList.toggle('active', mode === 'family');
  document.getElementById('modePatient').classList.toggle('active', mode === 'patient');
  document.getElementById('modeGames').classList.toggle('active', mode === 'games');
  if (mode === 'family') refreshFamilyView();
  if (mode === 'patient' && !currentTask) { renderDate(); nextTask(); }
  if (mode === 'patient') renderDate();
  if (mode === 'games') exitGame();
  // Nach oben scrollen — sonst landet man bei tieferen Views mittendrin
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.getElementById('modeHome').onclick = () => switchMode('home');
document.getElementById('modeFamily').onclick = () => switchMode('family');
document.getElementById('modePatient').onclick = () => switchMode('patient');
document.getElementById('modeGames').onclick = () => switchMode('games');

// ===========================================================================
// INIT
// ===========================================================================

// Wird aufgerufen sobald ein User eingeloggt ist (sei es durch Auto-Login
// oder nach erfolgreichem Login/Registrieren).
async function initApp() {
  // Jeder Schritt darf fehlschlagen — die App soll trotzdem laden
  try { await loadState(); } catch(e) { console.error('[Memovia] loadState:', e); }
  try { refreshFamilyView(); } catch(e) { console.error('[Memovia] refreshFamilyView:', e); }
  try { renderDate(); } catch(e) { console.error('[Memovia] renderDate:', e); }
  try {
    if (currentUser) {
      const nameEl = document.getElementById('accountName');
      if (nameEl) nameEl.textContent = currentUser.name;
    }
  } catch(e) { console.error('[Memovia] accountName:', e); }
  try { switchMode('home'); } catch(e) { console.error('[Memovia] switchMode:', e); }
  // Hintergrund-KI nach kurzer Wartezeit (läuft still im Hintergrund)
  setTimeout(() => {
    try {
      const total = Object.values(aiPool || {}).reduce((s, a) => s + (a?.length || 0), 0);
      if (total < 5 && typeof generateAITasks === 'function') generateAITasks();
    } catch(e) { console.error('[Memovia] aiPool:', e); }
  }, 2000);
}

// Beim ersten Laden: prüfen ob jemand eingeloggt ist
(async () => {
  let existingUser = null;
  try {
    existingUser = await authGetCurrentUser();
  } catch(e) {
    console.error('[Memovia] authGetCurrentUser:', e);
  }
  if (existingUser && existingUser.id) {
    currentUser = existingUser;
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = '';
    try {
      await initApp();
    } catch(e) {
      console.error('[Memovia] initApp Auto-Login:', e);
    }
  } else {
    // Auth-Screen sichtbar lassen, Enter-Submit hinzufügen
    try {
      document.getElementById('authForm').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          authSubmit();
        }
      });
    } catch(e) {
      console.error('[Memovia] authForm listener:', e);
    }
  }
})();

// ===========================================================================
// EXPLIZITE WINDOW-BINDINGS
// In manchen Browsern werden top-level Funktionen nicht automatisch an window
// gebunden. Hier erzwingen wir das damit data-action Handler sie sicher finden.
// ===========================================================================
window.authSubmit = authSubmit;
window.authToggleMode = authToggleMode;
window.authResetEverything = authResetEverything;
window.authSkipLogin = authSkipLogin;
window.authLogout = authLogout;
window.authRegister = authRegister;
window.authLogin = authLogin;

// ===========================================================================
// DIREKTER CLICK-LISTENER für Auth-Buttons (Fallback)
// Wird hier in app.js eingebaut, falls der Inline-Handler aus HTML nicht greift.
// ===========================================================================
(function attachAuthClickHandlers() {
  function attach() {
    // Direkt an jeden Auth-Button binden — robuster als data-action
    const btn1 = document.getElementById('authSubmit');
    if (btn1 && !btn1._hasHandler) {
      btn1._hasHandler = true;
      btn1.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('[Memovia] Submit-Button geklickt');
        authSubmit();
      });
    }
    const btn2 = document.getElementById('authToggleMode');
    if (btn2 && !btn2._hasHandler) {
      btn2._hasHandler = true;
      btn2.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('[Memovia] Toggle-Button geklickt');
        authToggleMode();
      });
    }
    // Skip + Reset Buttons über data-action
    document.querySelectorAll('[data-action]').forEach(function(btn) {
      if (btn._hasHandler) return;
      btn._hasHandler = true;
      btn.addEventListener('click', function(e) {
        const action = btn.getAttribute('data-action');
        console.log('[Memovia] data-action geklickt:', action);
        e.preventDefault();
        if (action === 'submit') authSubmit();
        else if (action === 'toggle') authToggleMode();
        else if (action === 'reset') authResetEverything();
        else if (action === 'skip') authSkipLogin();
        else if (action === 'logout') authLogout();
      });
    });
  }
  // Sofort versuchen, plus nach DOMContentLoaded, plus mit kleiner Verzögerung
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }
  setTimeout(attach, 100);
  setTimeout(attach, 500);
})();
