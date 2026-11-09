/* prime era — хранение в Firebase: вход через Google, база Firestore, резервная копия. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBe5RAek4b4dTK-V3zvWS7nr5iAh7dj3vE",
  authDomain: "prime-era-9f3b2.firebaseapp.com",
  projectId: "prime-era-9f3b2",
  storageBucket: "prime-era-9f3b2.firebasestorage.app",
  messagingSenderId: "1019727952161",
  appId: "1:1019727952161:web:df1ee5733b403098de6660"
};
/* Все коллекции приложения — для резервной копии и восстановления */
const COLLS = ["days","measures","workouts","finance","topics","wish","dopa","dlog","money","plan","sec","txh","tx","config","hair","img","sum"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let fs;
try { fs = initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { fs = initializeFirestore(app, { ignoreUndefinedProperties: true }); }

/* Firestore не хранит массивы внутри массивов (история операций такая) — такие документы кладём строкой JSON */
const nested = v => Array.isArray(v) ? v.some(x => Array.isArray(x) || nested(x)) : (v && typeof v === "object") ? Object.values(v).some(nested) : false;
const enc = b => nested(b) ? { __j: JSON.stringify(b) } : b;
const dec = d => d && typeof d.__j === "string" ? JSON.parse(d.__j) : d;

let uid = null, isSynced = false;
/* Пока база впервые скачивается на устройство — показываем это вместо «Сохранено» */
function synced() { if (isSynced) return; isSynced = true; const c = document.getElementById("saveState"); if (c && /Загружаю/.test(c.textContent)) { c.textContent = "Сохранено"; c.className = "chip ok"; } }
const P = path => ["u", uid].concat(path.split("/"));
const api = () => ({
  db: {
    collection: name => ({
      onSnapshot: (cb, err) => { let lastFC = null; return onSnapshot(collection(fs, ...P(name)), { includeMetadataChanges: true }, s => { const fc = s.metadata.fromCache; if (!fc) synced(); if (fc === lastFC && !s.docChanges().length) return; lastFC = fc; cb({ fromCache: fc, docs: s.docs.map(d => ({ id: d.id, data: () => dec(d.data()) })) }); }, err); }
    }),
    doc: path => ({
      onSnapshot: (cb, err) => { let lastFC = null, lastJ = null; return onSnapshot(doc(fs, ...P(path)), { includeMetadataChanges: true }, s => { const fc = s.metadata.fromCache, j = JSON.stringify(s.exists() ? s.data() : null); if (fc === lastFC && j === lastJ) return; lastFC = fc; lastJ = j; cb({ exists: s.exists(), fromCache: fc, data: () => dec(s.data()) }); }, err); },
      set: b => setDoc(doc(fs, ...P(path)), enc(b)),
      delete: () => deleteDoc(doc(fs, ...P(path)))
    }),
    batchSet: async (items, onP) => { for (let i = 0; i < items.length; i += 300) { const b = writeBatch(fs); items.slice(i, i + 300).forEach(([p, body]) => b.set(doc(fs, ...P(p)), enc(body))); await b.commit(); onP && onP(Math.min(items.length, i + 300), items.length); } }
  },
  assets: {
    upload: async blob => {
      const d = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, "0")).join("");
      await setDoc(doc(fs, ...P("img/" + id)), { d });
      return { id };
    }
  },
  downloads: { save: async ({ filename, data }) => { saveFile(filename, data); return { status: "saved" }; } }
});

function saveFile(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || "text/plain;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- резервная копия ---------- */
async function backup() {
  const out = { _app: "prime-era", _at: new Date().toISOString() };
  for (const c of COLLS) {
    const s = await getDocs(collection(fs, ...P(c)));
    if (s.size) { out[c] = {}; s.docs.forEach(d => out[c][d.id] = dec(d.data())); }
  }
  const t = new Date(), pad = n => String(n).padStart(2, "0");
  saveFile(`prime-era-backup-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}.json`, JSON.stringify(out), "application/json");
  try { localStorage.setItem("pe-backup-at", String(Date.now())); } catch (e) {}
  setDoc(doc(fs, ...P("config/backup")), { at: Date.now() }).catch(() => {});
  const bn = document.getElementById("peBkBan"); if (bn) bn.remove();
}
async function restore(file, onProgress) {
  const data = JSON.parse(await file.text());
  const items = [];
  for (const c of COLLS) Object.entries(data[c] || {}).forEach(([id, b]) => items.push([c + "/" + id, b]));
  if (!items.length) throw new Error("В файле нет данных prime era");
  for (let i = 0; i < items.length; i += 300) {
    const b = writeBatch(fs);
    items.slice(i, i + 300).forEach(([p, body]) => b.set(doc(fs, ...P(p)), enc(body)));
    await b.commit();
    onProgress && onProgress(Math.min(items.length, i + 300), items.length);
  }
  return items.length;
}

/* ---------- интерфейс: вход и меню аккаунта ---------- */
const css = document.createElement("style");
css.textContent = `
#peLogin{position:fixed;inset:0;z-index:50;background:var(--bg,#F2F1F5);display:flex;align-items:center;justify-content:center;padding:24px}
#peLogin .box{max-width:360px;width:100%;display:flex;flex-direction:column;gap:14px;text-align:center}
#peLogin h1{font-family:var(--display,Georgia,serif);font-size:34px;font-weight:400;margin:0}
#peLogin p{margin:0;color:var(--ink-2,#6A6376);font-size:14px}
#peAcc{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center}
#peAcc .sheet{background:var(--surface,#fff);color:var(--ink,#27222F);width:100%;max-width:560px;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px}
#peAcc .sheet *{box-sizing:border-box}
#peAcc .sheet>.btn,#peAcc .sheet>label.btn{display:block;width:100%;text-align:center}
#peAcc .hd{display:flex;align-items:flex-start;gap:12px}
#peAcc .hd .who{flex:1;min-width:0;overflow-wrap:anywhere}
#peAcc .x{flex:none;width:36px;height:36px;border:0;border-radius:50%;background:var(--surface-2,#E8E6EE);color:var(--ink,#27222F);font-size:20px;line-height:1;cursor:pointer}
#peGear{border:0;background:var(--surface-2,#E8E6EE);color:var(--ink,#27222F);border-radius:999px;width:32px;height:28px;margin-left:6px;font-size:15px;line-height:1;cursor:pointer}
`;
document.head.appendChild(css);

function loginScreen(msg) {
  let el = document.getElementById("peLogin");
  if (!el) { el = document.createElement("div"); el.id = "peLogin"; document.body.appendChild(el); }
  el.innerHTML = `<div class="box"><h1>prime era</h1><p>Войди через Google — данные хранятся в твоей личной базе и видны только тебе.</p>
    <button type="button" class="btn" id="peIn" style="padding:14px">Войти через Google</button>
    <p id="peMsg" style="min-height:20px">${msg || ""}</p></div>`;
  el.hidden = false;
  document.getElementById("peIn").onclick = async () => {
    const m = document.getElementById("peMsg"); m.textContent = "Открываю окно входа…";
    const prov = new GoogleAuthProvider(); prov.setCustomParameters({ prompt: "select_account" });
    try { await signInWithPopup(auth, prov); }
    catch (e) {
      const c = e && e.code || "";
      if (/popup-blocked|operation-not-supported|web-storage/.test(c)) { await signInWithRedirect(auth, prov); return; }
      m.textContent = c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request" ? "Окно входа закрыто. Попробуй ещё раз."
        : c === "auth/unauthorized-domain" ? "Этот адрес сайта не добавлен в Firebase (Authentication → Настройки → Авторизованные домены)."
        : "Не получилось войти: " + (c || e.message);
    }
  };
}

function accountSheet(user) {
  const el = document.createElement("div"); el.id = "peAcc";
  let last = null; try { last = +localStorage.getItem("pe-backup-at") || null; } catch (e) {}
  el.innerHTML = `<div class="sheet"><div class="hd"><div class="who"><b>${user.displayName || "Аккаунт"}</b><div class="small muted">${user.email || ""}</div></div><button type="button" class="x" id="peX" aria-label="Закрыть">×</button></div>
    <button type="button" class="btn" id="peBk">Скачать резервную копию</button>
    <p class="small muted" style="margin:0"><span id="peLast">${last ? "Последняя копия: " + new Date(last).toLocaleDateString("ru-RU") + "." : "Копию ещё не делали на этом устройстве."}</span> Храни файл в облаке или на компьютере — из него можно восстановить всё.</p>
    <label class="btn ghost" style="text-align:center;cursor:pointer">Восстановить из файла<input type="file" id="peRs" accept=".json,application/json" hidden></label>
    <button type="button" class="btn ghost" id="peMi">Импорт Mi Fitness (шаги, сон, вес)</button>
    <p class="small muted" id="peSt" style="margin:0"></p>
    <button type="button" class="btn ghost" id="peOut">Выйти из аккаунта</button></div>`;
  document.body.appendChild(el);
  const st = el.querySelector("#peSt");
  el.onclick = e => { if (e.target === el) el.remove(); };
  el.querySelector("#peX").onclick = () => el.remove();
  el.querySelector("#peMi").onclick = () => { el.remove(); window.dispatchEvent(new CustomEvent("pe-mi")); };
  el.querySelector("#peBk").onclick = async () => { st.textContent = "Собираю данные…"; try { await backup(); st.textContent = "Готово — файл скачан."; el.querySelector("#peLast").textContent = "Последняя копия: " + new Date().toLocaleDateString("ru-RU") + "."; const g = document.getElementById("peGear"); if (g) { g.textContent = "⚙"; g.style.width = ""; g.style.padding = ""; } } catch (e) { st.textContent = "Не получилось: " + e.message; } };
  el.querySelector("#peRs").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    if (!confirm("Загрузить данные из файла? Записи с теми же датами и номерами заменятся данными из файла.")) return;
    st.textContent = "Загружаю…";
    try { const n = await restore(f, (a, b) => st.textContent = `Загружено ${a} из ${b}…`); st.textContent = `Готово: ${n} записей.`; }
    catch (e) { st.textContent = "Не получилось: " + e.message; }
  };
  el.querySelector("#peOut").onclick = async () => { await signOut(auth); location.reload(); };
}

function gear(user) {
  if (document.getElementById("peGear")) return;
  const chip = document.getElementById("saveState");
  const b = document.createElement("button"); b.type = "button"; b.id = "peGear"; b.setAttribute("aria-label", "Аккаунт и резервная копия"); b.textContent = "⚙";
  b.onclick = () => accountSheet(user);
  if (chip && chip.parentNode) { const w = document.createElement("span"); w.style.cssText = "display:inline-flex;align-items:center"; chip.parentNode.insertBefore(w, chip); w.appendChild(chip); w.appendChild(b); }
  else document.body.appendChild(b);
}

/* Напоминание о копии раз в 3 дня (учитываются копии с любого устройства) */
async function backupNudge() {
  let last = 0; try { last = +localStorage.getItem("pe-backup-at") || 0; } catch (e) {}
  try { const d = await getDoc(doc(fs, ...P("config/backup"))); if (d.exists()) last = Math.max(last, +d.data().at || 0); } catch (e) {}
  if (Date.now() - last < 3 * 864e5) return;
  const g = document.getElementById("peGear"); if (g) { g.textContent = "⚙ !"; g.style.width = "auto"; g.style.padding = "0 10px"; g.title = "Пора сделать резервную копию"; }
  if (document.getElementById("peBkBan")) return;
  const days = last ? Math.floor((Date.now() - last) / 864e5) : 0;
  const b = document.createElement("div"); b.id = "peBkBan"; b.className = "banner"; b.style.cssText = "display:flex;gap:10px;align-items:center;flex-wrap:wrap";
  b.innerHTML = `<span style="flex:1;min-width:180px">${last ? "Резервной копии не было " + days + " дн." : "Резервную копию ещё не делали."} Делаем раз в 3 дня — это 10 секунд.</span><button type="button" class="btn small">Скачать копию</button><button type="button" class="btn ghost small" aria-label="Позже">Позже</button>`;
  const [ok, later] = b.querySelectorAll("button");
  ok.onclick = async () => { ok.disabled = true; ok.textContent = "Собираю…"; try { await backup(); g && (g.textContent = "⚙", g.style.width = "", g.style.padding = ""); b.remove(); } catch (e) { ok.disabled = false; ok.textContent = "Не вышло, ещё раз"; } };
  later.onclick = () => b.remove();
  const off = document.getElementById("offline"); if (off && off.parentNode) off.parentNode.insertBefore(b, off); else document.body.prepend(b);
}

setPersistence(auth, browserLocalPersistence).catch(() => {});
getRedirectResult(auth).catch(e => loginScreen("Не получилось войти: " + (e && e.code || e.message)));
let started = false;
const unsplash = () => { const x = document.getElementById("peSplash"); if (x) x.remove(); };
onAuthStateChanged(auth, user => {
  unsplash();
  if (!user) { loginScreen(); return; }
  const el = document.getElementById("peLogin"); if (el) el.hidden = true;
  if (started) return; started = true;
  uid = user.uid;
  window.__peResolve(api());
  setTimeout(() => { if (!isSynced) { const c = document.getElementById("saveState"); if (c) { c.textContent = "Загружаю данные…"; c.className = "chip warn"; } } }, 0);
  gear(user); setTimeout(backupNudge, 2500);
});
