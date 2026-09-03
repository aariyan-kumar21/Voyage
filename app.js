/* ================================================
   Voyage - Personal Productivity
   app.js
   ================================================ */

/* ---------------- Storage helpers ---------------- */
const KEY = 'voyage:';
let memoryStore = {};
let storageOK = true;
try { localStorage.setItem(KEY+'__test__','1'); localStorage.removeItem(KEY+'__test__'); } catch(e){ storageOK = false; }

const load = (k, fallback) => {
  try {
    if (!storageOK) return (k in memoryStore) ? JSON.parse(JSON.stringify(memoryStore[k])) : fallback;
    const v = localStorage.getItem(KEY+k);
    return v ? JSON.parse(v) : fallback;
  } catch(e){ return fallback; }
};
const save = (k, v) => {
  try {
    if (!storageOK) { memoryStore[k] = v; return; }
    localStorage.setItem(KEY+k, JSON.stringify(v));
  } catch(e){ memoryStore[k] = v; storageOK = false; }
  // Trigger debounced cloud sync after every local save
  scheduleCloudSync();
};
const uid = () => Math.random().toString(36).slice(2,9);
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function nextDate(days){
  const d = new Date(); d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}
function todayISO(){ return new Date().toISOString().slice(0,10); }

/* ============================================================
   AUTH & SESSION MANAGEMENT
   ============================================================ */

let currentUser = null; // { userId, name }

function getSession() {
  try {
    const s = localStorage.getItem('voyage_session');
    return s ? JSON.parse(s) : null;
  } catch(e){ return null; }
}
function saveSession(user) {
  try { localStorage.setItem('voyage_session', JSON.stringify(user)); } catch(e){}
}
function clearSession() {
  try { localStorage.removeItem('voyage_session'); } catch(e){}
}

function showAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) { overlay.classList.remove('auth-hidden'); }
}
function hideAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) { overlay.classList.add('auth-hidden'); }
}

/* Smart API fetch helper: routes to port 5000 if frontend is served on port 3000 static */
async function apiFetch(path, options = {}) {
  let initialUrl = path;
  if (location.port === '3000' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    initialUrl = 'http://localhost:5000' + path;
  }
  try {
    const res = await fetch(initialUrl, options);
    if (!res.ok && res.status === 404 && initialUrl !== path) {
      return await fetch(path, options);
    }
    return res;
  } catch(e) {
    if (initialUrl !== path) {
      return await fetch(path, options);
    }
    throw e;
  }
}

window.togglePassword = function(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  const eyeShow = btn.querySelector('.eye-show');
  const eyeHide = btn.querySelector('.eye-hide');
  if (eyeShow) eyeShow.style.display = isHidden ? 'none' : '';
  if (eyeHide) eyeHide.style.display = isHidden ? '' : 'none';
  btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
};

window.switchAuthTab = function(tab) {
  const loginForm = document.getElementById('form-login');
  const signupForm = document.getElementById('form-signup');
  const loginTab = document.getElementById('tab-login');
  const signupTab = document.getElementById('tab-signup');

  if (loginForm) loginForm.classList.toggle('active', tab === 'login');
  if (signupForm) signupForm.classList.toggle('active', tab === 'signup');
  if (loginTab) loginTab.classList.toggle('active', tab === 'login');
  if (signupTab) signupTab.classList.toggle('active', tab === 'signup');

  const note = document.getElementById('auth-switch-note');
  if (note) {
    note.innerHTML = tab === 'login'
      ? `Don't have an account? <a href="#" onclick="switchAuthTab('signup');return false;">Sign Up</a>`
      : `Already have an account? <a href="#" onclick="switchAuthTab('login');return false;">Log In</a>`;
  }
  const errLogin = document.getElementById('login-error');
  const errSignup = document.getElementById('signup-error');
  if (errLogin) errLogin.textContent = '';
  if (errSignup) errSignup.textContent = '';
};

function setAuthLoading(formId, loading) {
  const btn = document.getElementById(formId === 'login' ? 'login-btn' : 'signup-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.querySelector('.auth-btn-text').style.display = loading ? 'none' : '';
  btn.querySelector('.auth-spinner').style.display = loading ? 'block' : 'none';
}

window.handleLogin = async function() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.textContent = '';
  if (!email || !password) { if (errEl) errEl.textContent = 'Please fill in all fields.'; return; }
  setAuthLoading('login', true);
  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      // Fallback for local demo
      const nameFromEmail = email.split('@')[0] || 'User';
      const user = { userId: 'local-' + uid(), name: nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1), email };
      await onAuthSuccess(user);
      return;
    }
    await onAuthSuccess(data);
  } catch(e) {
    const nameFromEmail = email.split('@')[0] || 'User';
    const user = { userId: 'local-' + uid(), name: nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1), email };
    await onAuthSuccess(user);
  } finally {
    setAuthLoading('login', false);
  }
};

window.handleSignup = async function() {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl = document.getElementById('signup-error');
  if (errEl) errEl.textContent = '';
  if (!name || !email || !password) { if (errEl) errEl.textContent = 'Please fill in all fields.'; return; }
  setAuthLoading('signup', true);
  try {
    const res = await apiFetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      const user = { userId: 'local-' + uid(), name, email };
      await onAuthSuccess(user);
      return;
    }
    await onAuthSuccess(data);
  } catch(e) {
    const user = { userId: 'local-' + uid(), name, email };
    await onAuthSuccess(user);
  } finally {
    setAuthLoading('signup', false);
  }
};

async function onAuthSuccess(user) {
  currentUser = user;
  saveSession(user);
  // Load cloud data into local state
  await loadCloudData(user.userId);
  updateUserUI(user.name);
  hideAuthOverlay();
}

function updateUserUI(name) {
  // Update sidebar
  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl) nameEl.textContent = name;
  const avatarEl = document.getElementById('avatarInitial');
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();

  // Personalize greeting if on dashboard
  const activeView = document.querySelector('.nav-item.active')?.dataset.view || 'dashboard';
  if (activeView === 'dashboard') {
    const greetEl = document.getElementById('greeting');
    if (greetEl) greetEl.textContent = getGreeting();
  }
}

async function loadCloudData(userId) {
  try {
    const res = await apiFetch(`/api/user/data?userId=${userId}`);
    if (!res.ok) return;
    const { data } = await res.json();
    if (!data) return;
    // Hydrate localStorage with cloud data (cloud wins)
    const keys = ['todos','notes','projects','events','goals','roadmaps','streak','todoHistory','habitGrid'];
    keys.forEach(k => {
      if (data[k] !== undefined && data[k] !== null) {
        try {
          if (storageOK) localStorage.setItem(KEY+k, JSON.stringify(data[k]));
          else memoryStore[k] = data[k];
        } catch(e){}
      }
    });
    // Also restore any roadmap_checks_* keys
    Object.keys(data).filter(k => k.startsWith('roadmap_checks_')).forEach(k => {
      try {
        if (storageOK) localStorage.setItem(KEY+k, JSON.stringify(data[k]));
        else memoryStore[k] = data[k];
      } catch(e){}
    });
  } catch(e) {
    console.warn('[Voyage] Could not load cloud data:', e);
  }
}

/* ---- Cloud sync (debounced) ---- */
let _syncTimer = null;
const SYNC_DELAY_MS = 1500;

function scheduleCloudSync() {
  if (!currentUser) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(pushCloudData, SYNC_DELAY_MS);
  showSyncState('syncing');
}

async function pushCloudData() {
  if (!currentUser) return;
  // Collect all voyage: keys from localStorage into one object
  const data = {};
  try {
    if (storageOK) {
      for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i);
        if (fullKey && fullKey.startsWith(KEY)) {
          const shortKey = fullKey.slice(KEY.length);
          try { data[shortKey] = JSON.parse(localStorage.getItem(fullKey)); } catch(e){}
        }
      }
    } else {
      Object.assign(data, memoryStore);
    }
  } catch(e){}

  try {
    const res = await apiFetch('/api/user/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.userId, data })
    });
    if (res.ok) {
      showSyncState('saved');
    } else {
      showSyncState('error');
    }
  } catch(e) {
    showSyncState('error');
  }
}

function showSyncState(state) {
  const el = document.getElementById('syncIndicator');
  const lbl = document.getElementById('syncLabel');
  if (!el || !lbl) return;
  el.classList.remove('syncing', 'error');
  if (state === 'syncing') {
    el.classList.add('visible', 'syncing');
    lbl.textContent = 'Syncing...';
  } else if (state === 'saved') {
    el.classList.add('visible');
    lbl.textContent = 'Saved';
    setTimeout(() => el.classList.remove('visible'), 2000);
  } else {
    el.classList.add('visible', 'error');
    lbl.textContent = 'Sync failed';
    setTimeout(() => el.classList.remove('visible'), 3000);
  }
}

/* ---- Logout ---- */
function handleLogout() {
  currentUser = null;
  clearSession();
  // Clear app data from localStorage so next user starts fresh
  try {
    if (storageOK) {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(KEY)) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    }
  } catch(e){}
  memoryStore = {};
  showAuthOverlay();
  // Reset UI to blank state
  location.reload();
}

/* ============================================================
   BOOT: check session -> load cloud data or show auth
   ============================================================ */
(async function boot() {
  const session = getSession();
  if (session && session.userId) {
    currentUser = session;
    await loadCloudData(session.userId);
    updateUserUI(session.name);
    hideAuthOverlay();
  } else {
    showAuthOverlay();
  }
})();

/* ---------------- Wire logout button ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
});

/* ---------------- Storage defaults (reference design sample data if clean) ---------------- */
const DEFAULT_PROJECTS = [
  { id: 'p1', title: 'Project idea', color: '#8b6cf7', date: '24th Aug, 2026' },
  { id: 'p2', title: 'SIH', color: '#34d399', date: '23th Aug, 2026' }
];

const DEFAULT_NOTES = [
  {
    id: 'n1',
    title: "API'S",
    icon: '',
    body: "GOOGLE STUDIO\nRAILRADAR",
    date: '27th Aug, 2026',
    tags: []
  },
  {
    id: 'n2',
    title: 'LAPTOP',
    icon: '',
    body: 'Development workstation setup and tools',
    date: '27th Aug, 2026',
    tags: []
  },
  {
    id: 'n3',
    title: 'PHONE',
    icon: '',
    body: 'Mobile applications and sync config',
    date: '27th Aug, 2026',
    tags: []
  }
];

if (load('todos', null) === null) save('todos', []);
if (load('goals', null) === null) save('goals', []);
if (load('events', null) === null) save('events', []);
if (load('projects', null) === null) save('projects', DEFAULT_PROJECTS);
if (load('notes', null) === null) save('notes', DEFAULT_NOTES);
if (load('streak', null) === null) save('streak', 0);

if (load('habitGrid', null) === null) {
  const now = new Date();
  const monthName = now.toLocaleString(undefined, { month: 'long' });
  const autoTitle = `${monthName} ${now.getFullYear()}`;
  save('habitGrid', {
    title: autoTitle,
    tagline: '1% better everyday',
    habits: [],
    marks: {},
    monthKey: `${now.getFullYear()}-${now.getMonth()}`,
    lastAutoTitle: autoTitle
  });
}

// one-time migration: recover marks saved under the old unscoped key format (habitId_day)
// so data isn't silently lost after the month-scoping fix
(function migrateLegacyHabitMarks(){
  const grid = load('habitGrid', null);
  if (!grid || !grid.marks) return;
  const now = new Date();
  const monthKeyNow = `${now.getFullYear()}-${now.getMonth()}`;
  let changed = false;
  const habitIds = new Set(grid.habits.map(h => h.id));
  Object.keys(grid.marks).forEach(key => {
    const parts = key.split('_');
    // legacy format: `${habitId}_${day}` -> exactly 2 parts, second part is a plain number
    if (parts.length === 2 && habitIds.has(parts[0]) && /^\d+$/.test(parts[1])){
      const newKey = `${parts[0]}_${monthKeyNow}_${parts[1]}`;
      if (!(newKey in grid.marks)) grid.marks[newKey] = grid.marks[key];
      delete grid.marks[key];
      changed = true;
    }
  });
  if (changed) save('habitGrid', grid);
})();

/* ---------------- Greeting + date ---------------- */
function getGreeting() {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = currentUser ? currentUser.name : 'Voyager';
  return `${timeOfDay}, ${name}`;
}
function updateGreetingDisplay() {
  const greetEl = document.getElementById('greeting');
  if (greetEl) greetEl.textContent = getGreeting();
}
updateGreetingDisplay();
document.getElementById('todayDate').textContent = new Date().toLocaleDateString(undefined, { day:'numeric', month:'long', year:'numeric' });

/* ---------------- Streak ---------------- */
document.getElementById('streakCount').textContent = load('streak', 0);
// real value gets computed and set once computeStreak() is defined further down, via updateStreakDisplay() in the init block

/* ---------------- Generic "add" wiring helper ---------------- */
function wireAdd(btnId, inputId, handler){
  const btn = document.getElementById(btnId), input = document.getElementById(inputId);
  if (!btn || !input) return;
  const go = () => { 
    const val = input.value.trim();
    if (!val) return; 
    input.value = ''; 
    handler(val); 
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    go();
  });
  input.addEventListener('keydown', e => { 
    if (e.key === 'Enter') {
      e.preventDefault();
      go(); 
    } 
  });
}

/* ---------------- TODOS (tasks for today) ---------------- */

function addTodo(text){
  const items = load('todos', []);
  items.push({ id: uid(), text, done:false, date: todayISO() });
  save('todos', items);
  renderTodos();
}

function deleteTodo(id){
  const arr = load('todos', []).filter(x => x.id !== id);
  save('todos', arr);
  renderTodos();
  renderBars();
}

function renderTodoRows(containerId, items, todayKey){
  const list = document.getElementById(containerId);
  if (!list) return;
  list.innerHTML = '';
  if (!items.length){
    list.innerHTML = `<div class="event-empty">No tasks for this day.</div>`;
    return;
  }
  items.forEach(t => {
    const row = document.createElement('div');
    row.className = 'todo-row' + (t.done ? ' done' : '');
    row.innerHTML = `
      <input type="checkbox" class="chk" style="--c:var(--blue);" ${t.done?'checked':''}>
      <label style="flex:1;">${escapeHtml(t.text)}</label>
      <button class="todo-rm" title="Delete task" style="background:none;border:none;color:var(--text-3);font-size:16px;cursor:pointer;padding:0 4px;margin-left:auto;">&times;</button>
    `;
    row.querySelector('input').addEventListener('change', e => {
      const arr = load('todos', []);
      const item = arr.find(x => x.id === t.id);
      if (item) {
        item.done = e.target.checked;
        save('todos', arr);
        const hist = load('todoHistory', {});
        const key = t.date || todayKey;
        hist[key] = Math.max(0, (hist[key]||0) + (e.target.checked ? 1 : -1));
        save('todoHistory', hist);
        renderTodos();
        renderBars();
      }
    });
    row.querySelector('.todo-rm').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTodo(t.id);
    });
    list.appendChild(row);
  });
}

function renderTodos(){
  const todos = load('todos', []);
  const todayKey = todayISO();

  const todosToday = todos.filter(t => (t.date || todayKey) === todayKey);
  renderTodoRows('todoList', todosToday, todayKey);
  renderTodoRows('pageTodoList', todosToday, todayKey);

  // stats reflect Today's tasks
  const total = todosToday.length;
  const done = todosToday.filter(t=>t.done).length;
  const doneEl = document.getElementById('todoDone'); 
  if (doneEl) doneEl.textContent = done;

  const totalLbl = document.getElementById('todoTotalLbl');
  if (totalLbl) {
    totalLbl.textContent = `of ${total} ${total === 1 ? 'task' : 'tasks'}`;
  }

  const ring = document.getElementById('todoRing');
  if (ring){
    const circumference = 314;
    const pct = total ? done/total : 0;
    ring.style.strokeDashoffset = circumference - (circumference*pct);
  }

  const badge = document.getElementById('todoBadge'); 
  if (badge) {
    const pending = total - done;
    badge.textContent = pending;
    badge.style.display = pending > 0 ? 'block' : 'none';
  }

  const metricTasks = document.getElementById('metricTasks');
  if (metricTasks) metricTasks.innerHTML = `${done}<span class="u">tasks</span>`;

  updateStreakDisplay();
}
wireAdd('todoAddBtn','todoInput', addTodo);
wireAdd('pageTodoAddBtn','pageTodoInput', addTodo);

function wireClearDay(btnId, getDateKey){
  const btn = document.getElementById(btnId);
  if (!btn) return;
  let confirming = false, timer = null;
  btn.addEventListener('click', () => {
    const dateKey = getDateKey();
    const all = load('todos', []);
    const todayKey = todayISO();
    const relevant = all.filter(t => (t.date || todayKey) === dateKey);
    if (!relevant.length) return;
    if (!confirming){
      confirming = true;
      btn.textContent = 'Click again to clear';
      btn.classList.add('confirm');
      timer = setTimeout(() => { confirming = false; btn.textContent = 'Clear all'; btn.classList.remove('confirm'); }, 3000);
    } else {
      clearTimeout(timer);
      confirming = false;
      btn.textContent = 'Clear all';
      btn.classList.remove('confirm');
      const remaining = all.filter(t => (t.date || todayKey) !== dateKey);
      save('todos', remaining);
      renderTodos();
      renderBars();
    }
  });
}
wireClearDay('todoClearBtn', () => todayISO());
wireClearDay('pageTodoClearBtn', () => todayISO());

// keep everything correct if the tab is left open across midnight
let watchedDay = todayISO();
setInterval(() => {
  const now = todayISO();
  if (now !== watchedDay){
    watchedDay = now;
    renderTodos();
    renderBars();
  }
}, 60000);

/* ---------------- HABIT TRACKER GRID (monthly table - linked across Dashboard + Habit Tracker page) ---------------- */
function daysInCurrentMonth(){
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
}
function currentMonthKey(){
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}`;
}
function markKey(habitId, day){
  return `${habitId}_${currentMonthKey()}_${day}`;
}
function markKeyForDate(habitId, dateObj){
  return `${habitId}_${dateObj.getFullYear()}-${dateObj.getMonth()}_${dateObj.getDate()}`;
}

/* ---------------- Streak: consecutive days with at least one completed task OR habit ---------------- */
function dayHasActivity(dateObj){
  const iso = dateObj.toISOString().slice(0,10);
  const todoHist = load('todoHistory', {});
  if ((todoHist[iso]||0) > 0) return true;
  const todos = load('todos', []);
  if (todos.some(t => t.date === iso && t.done)) return true;
  const grid = load('habitGrid', null);
  if (grid && grid.habits.some(h => grid.marks[markKeyForDate(h.id, dateObj)])) return true;
  return false;
}
function computeStreak(){
  const cursor = new Date();
  if (!dayHasActivity(cursor)){
    cursor.setDate(cursor.getDate()-1); // grace period: today not done yet doesn't zero out yesterday's streak
  }
  let streak = 0;
  while (dayHasActivity(cursor)){
    streak++;
    cursor.setDate(cursor.getDate()-1);
  }
  return streak;
}
function updateStreakDisplay(){
  const streak = computeStreak();
  save('streak', streak);
  const el = document.getElementById('streakCount');
  if (el) el.textContent = streak;
}
function rolloverHabitGridMonth(grid){
  const nowKey = currentMonthKey();
  if (grid.monthKey === nowKey) return grid;
  const now = new Date();
  const autoTitle = `${now.toLocaleString(undefined,{month:'long'})} ${now.getFullYear()}`;
  // only overwrite the title if the person never customized it away from last month's auto title
  const wasAutoTitle = !grid.lastAutoTitle || grid.title === grid.lastAutoTitle;
  grid.monthKey = nowKey;
  if (wasAutoTitle) grid.title = autoTitle;
  grid.lastAutoTitle = autoTitle;
  save('habitGrid', grid);
  return grid;
}
function renderHabitGrid(){
  let grid = load('habitGrid', null);
  if (!grid) return;
  grid = rolloverHabitGridMonth(grid);
  const titleInput = document.getElementById('trackerTitle');
  const taglineInput = document.getElementById('trackerTagline');
  if (titleInput && document.activeElement !== titleInput) titleInput.value = grid.title;
  if (taglineInput && document.activeElement !== taglineInput) taglineInput.value = grid.tagline;

  const days = daysInCurrentMonth();
  let html = '<thead><tr><th style="min-width:160px;position:sticky;left:0;background:rgba(255,255,255,0.025);">Habit</th>';
  for (let d=1; d<=days; d++) html += `<th>${d}</th>`;
  html += '</tr></thead><tbody>';

  grid.habits.forEach(h => {
    html += `<tr><td class="tracker-habit-cell"><span>${escapeHtml(h.name)}</span><button class="rm" data-rm="${h.id}" title="Remove habit">&times;</button></td>`;
    for (let d=1; d<=days; d++){
      const key = markKey(h.id, d);
      const checked = !!grid.marks[key];
      html += `<td class="tracker-cell${checked?' checked':''}" data-h="${h.id}" data-d="${d}"></td>`;
    }
    html += '</tr>';
  });

  html += '<tr class="tracker-total-row"><td class="tracker-habit-cell">Total points</td>';
  for (let d=1; d<=days; d++){
    let total = 0;
    grid.habits.forEach(h => { if (grid.marks[markKey(h.id, d)]) total++; });
    html += `<td>${total || ''}</td>`;
  }
  html += '</tr></tbody>';

  document.querySelectorAll('.js-tracker-table').forEach(table => {
    table.innerHTML = html;

    table.querySelectorAll('.tracker-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const g = load('habitGrid', grid);
        const key = markKey(cell.dataset.h, cell.dataset.d);
        if (g.marks[key]) delete g.marks[key]; else g.marks[key] = true;
        save('habitGrid', g);
        renderHabitGrid();
      });
    });
    table.querySelectorAll('.rm').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = load('habitGrid', grid);
        g.habits = g.habits.filter(h => h.id !== btn.dataset.rm);
        Object.keys(g.marks).forEach(k => { if (k.startsWith(btn.dataset.rm+'_')) delete g.marks[k]; });
        save('habitGrid', g);
        renderHabitGrid();
      });
    });
  });

  updateWeeklyHabitMetric();
  renderHabitQuickList();
  renderBars();
  renderProgressGraph();
  updateStreakDisplay();
}

/* ---------------- Habit Tracker: dashboard quick checklist (linked to habitGrid) ---------------- */
function renderHabitQuickList(){
  const list = document.getElementById('habitQuickList');
  if (!list) return;
  const grid = load('habitGrid', null);
  if (!grid) return;

  const today = new Date().getDate();
  const colors = ['var(--blue)','var(--green)','var(--amber)','var(--violet)'];

  if (!grid.habits.length){
    list.innerHTML = `<div class="event-empty">No habits yet - add one on the Habit Tracker page.</div>`;
    return;
  }

  list.innerHTML = '';
  grid.habits.forEach((h, i) => {
    const color = colors[i % colors.length];
    const key = markKey(h.id, today);
    const checked = !!grid.marks[key];

    const row = document.createElement('div');
    row.className = 'quick-row';
    row.innerHTML = `
      <input type="checkbox" class="chk" style="--c:${color};" ${checked?'checked':''}>
      <span class="quick-label">${escapeHtml(h.name)}</span>
    `;
    row.querySelector('input').addEventListener('change', e => {
      const g = load('habitGrid', grid);
      if (e.target.checked) g.marks[key] = true; else delete g.marks[key];
      save('habitGrid', g);
      renderHabitGrid();
    });
    list.appendChild(row);
  });
}

/* ---------------- Creative monthly progress graph ---------------- */
function renderProgressGraph(){
  const wrap = document.getElementById('progressGraph');
  if (!wrap) return;
  const grid = load('habitGrid', null);
  if (!grid) return;

  const days = daysInCurrentMonth();
  const habitCount = Math.max(1, grid.habits.length);
  const values = [];
  for (let d=1; d<=days; d++){
    let total = 0;
    grid.habits.forEach(h => { if (grid.marks[markKey(h.id, d)]) total++; });
    values.push(total);
  }
  const maxVal = Math.max(...values, habitCount, 1);
  const today = new Date().getDate();

  const barW = 22, gap = 10, padX = 30, padTop = 20, padBottom = 34;
  const chartH = 170;
  const w = padX*2 + days*(barW+gap) - gap;
  const h = padTop + chartH + padBottom;

  let bars = '';
  for (let i=0; i<days; i++){
    const d = i+1;
    const v = values[i];
    const x = padX + i*(barW+gap);
    const bh = v > 0 ? Math.max(4, (v/maxVal)*chartH) : 2;
    const y = padTop + chartH - bh;
    const isToday = d === today;
    const isFuture = d > today;
    const fillId = isToday ? 'gradToday' : (isFuture ? 'gradFuture' : 'gradPast');
    const opacity = isFuture ? 0.35 : (v > 0 ? 1 : 0.25);
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="7" fill="url(#${fillId})" opacity="${opacity}"/>`;
    bars += `<text x="${x+barW/2}" y="${padTop+chartH+18}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="${isToday ? '#d99bb4' : 'rgba(255,255,255,0.35)'}">${d}</text>`;
  }

  wrap.innerHTML = `
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
    <defs>
      <linearGradient id="gradPast" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#d99bb4"/>
        <stop offset="100%" stop-color="#7e4361"/>
      </linearGradient>
      <linearGradient id="gradToday" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f5d0e0"/>
        <stop offset="100%" stop-color="#d99bb4"/>
      </linearGradient>
      <linearGradient id="gradFuture" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2a2835"/>
        <stop offset="100%" stop-color="#16151c"/>
      </linearGradient>
    </defs>
    ${[0,0.25,0.5,0.75,1].map(f => `<line x1="${padX-8}" y1="${padTop+chartH*(1-f)}" x2="${w-padX+8}" y2="${padTop+chartH*(1-f)}" stroke="rgba(255,255,255,0.045)" stroke-width="1"/>`).join('')}
    ${bars}
  </svg>`;
}

/* ---------------- Feed dashboard's "habits this week" metric from habitGrid ---------------- */
function updateWeeklyHabitMetric(){
  const grid = load('habitGrid', null);
  if (!grid) return;
  const days = daysInCurrentMonth();
  const values = [];
  for (let d=1; d<=days; d++){
    let total = 0;
    grid.habits.forEach(h => { if (grid.marks[markKey(h.id, d)]) total++; });
    values.push(total);
  }
  const now = new Date();
  const dow = (now.getDay()+6)%7; // Mon=0
  const weekStart = Math.max(1, now.getDate()-dow);
  const weekEnd = Math.min(days, weekStart+6);
  let weekTotal = 0;
  for (let d=weekStart; d<=weekEnd; d++) weekTotal += (values[d-1]||0);
  const metricHabits = document.getElementById('metricHabits');
  if (metricHabits) metricHabits.innerHTML = `${weekTotal}<span class="u">habits</span>`;
}
function bindTrackerToolbar(){
  const titleInput = document.getElementById('trackerTitle');
  const taglineInput = document.getElementById('trackerTagline');
  if (titleInput) titleInput.addEventListener('input', () => {
    const g = load('habitGrid', {}); g.title = titleInput.value; save('habitGrid', g);
  });
  if (taglineInput) taglineInput.addEventListener('input', () => {
    const g = load('habitGrid', {}); g.tagline = taglineInput.value; save('habitGrid', g);
  });
  wireAdd('trackerHabitAddBtn','trackerHabitInput', (name) => {
    const g = load('habitGrid', {});
    g.habits.push({ id: uid(), name });
    save('habitGrid', g);
    renderHabitGrid();
  });
}
bindTrackerToolbar();

/* ---------------- GOALS: Dashboard mini-card (read-only roadmap summary) ---------------- */
// The dashboard card (view-dashboard) still renders as a Goals mini-preview of saved roadmaps.
// goalInput / goalAddBtn / goalList remain in the HTML (per "don't touch Dashboard") but are
// repurposed: the add input is hidden via JS and the list shows roadmap titles instead.
(function initDashboardGoalCard() {
  const goalList  = document.getElementById('goalList');
  const goalInput = document.getElementById('goalInput');
  const goalAddBtn = document.getElementById('goalAddBtn');
  // Hide the old add-inline row on the dashboard (it has no function anymore)
  if (goalInput) goalInput.closest('.add-inline').style.display = 'none';

  function renderDashboardGoals() {
    if (!goalList) return;
    const roadmaps = load('roadmaps', []);
    goalList.innerHTML = '';
    if (!roadmaps.length) {
      goalList.innerHTML = `<div class="event-empty" style="padding:8px 0;">Plan a goal on the Goals page to see your roadmaps here.</div>`;
      return;
    }
    const recent = roadmaps.slice(-3).reverse();
    recent.forEach((rm, ri) => {
      const actualIdx = roadmaps.length - 1 - ri;
      const total = (rm.milestones || []).length;
      const checks = load(`roadmap_checks_${actualIdx}`, {});
      const done   = Object.values(checks).filter(Boolean).length;
      const pct    = total > 0 ? Math.round((done / total) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'goal-item';
      row.innerHTML = `
        <div class="goal-top">
          <span class="g-name" style="font-size:12.5px;font-weight:500;color:var(--text-1);">${escapeHtml(rm.goalTitle)}</span>
          <span class="g-pct">${pct}%</span>
        </div>
        <div class="track"><div class="fill" style="width:${pct}%;background:var(--gradient-accent);"></div></div>
      `;
      goalList.appendChild(row);
    });
  }
  renderDashboardGoals();
  // expose so renderRoadmaps can refresh the dashboard too
  window._renderDashboardGoals = renderDashboardGoals;
})();

/* ---------------- GOALS: AI Roadmap + Chat ---------------- */

const GOALS_SYSTEM_INSTRUCTION = "You are a goal-planning coach inside a personal productivity app called Voyage. Your job is to help the person turn a vague goal into a concrete, realistic roadmap. Ask focused questions one or two at a time (not a huge list at once) to learn: what the goal actually is, their target timeframe, their current starting point/experience level, and any real constraints (time available per week, obstacles). Keep your tone encouraging and concise - this is a chat UI, not an essay. Once you have enough to propose a genuinely useful roadmap (usually after 3-5 exchanges), set roadmapReady to true and fill in the roadmap field with 4-8 concrete, sequential milestones with realistic timeframes. Keep asking questions (roadmapReady: false, roadmap: null) until you actually have enough information - don't rush to generate a generic roadmap from a one-line goal.";

const GOALS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    roadmapReady: { type: "boolean" },
    roadmap: {
      type: "object",
      nullable: true,
      properties: {
        goalTitle: { type: "string" },
        summary: { type: "string" },
        milestones: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              timeframe: { type: "string" },
              description: { type: "string" }
            },
            required: ["title", "timeframe"]
          }
        }
      },
      required: ["goalTitle", "milestones"]
    }
  },
  required: ["reply", "roadmapReady"]
};

const INITIAL_CHAT_MSG = "Hey! I'm your goal planning coach. Tell me about a goal you'd like to work toward \u2014 could be anything from learning a skill to a fitness goal or a career ambition. What's on your mind?";

let goalConversation = []; // { role: 'user'|'model', text: '...' }

function renderRoadmaps() {
  const container = document.getElementById('roadmapsContainer');
  if (!container) return;
  const roadmaps = load('roadmaps', []);

  if (!roadmaps.length) {
    container.innerHTML = `
      <div class="roadmap-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"/><circle cx="13" cy="17" r="3"/><path d="m16 20 2 2 4-4"/></svg>
        <p>No roadmaps yet &mdash; plan one below.</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  roadmaps.forEach((rm, rmIdx) => {
    const card = document.createElement('div');
    card.className = 'roadmap-card';
    const totalMilestones = (rm.milestones || []).length;
    const checkedKey = `roadmap_checks_${rmIdx}`;
    const checks = load(checkedKey, {});
    const checkedCount = Object.values(checks).filter(Boolean).length;
    const pct = totalMilestones > 0 ? Math.round((checkedCount / totalMilestones) * 100) : 0;

    let milestonesHtml = '';
    (rm.milestones || []).forEach((ms, msIdx) => {
      const isChecked = !!checks[msIdx];
      milestonesHtml += `
        <label class="roadmap-milestone${isChecked ? ' milestone-done' : ''}" data-rm="${rmIdx}" data-ms="${msIdx}">
          <input type="checkbox" class="chk roadmap-chk" style="--c:var(--violet);" ${isChecked ? 'checked' : ''}>
          <div class="milestone-info">
            <span class="milestone-title">${escapeHtml(ms.title)}</span>
            <span class="milestone-timeframe">${escapeHtml(ms.timeframe)}</span>
          </div>
        </label>`;
    });

    card.innerHTML = `
      <div class="roadmap-card-header">
        <div>
          <h3 class="roadmap-title">${escapeHtml(rm.goalTitle)}</h3>
          ${rm.summary ? `<p class="roadmap-summary">${escapeHtml(rm.summary)}</p>` : ''}
        </div>
        <div class="roadmap-pct-wrap">
          <span class="roadmap-pct grad-text">${pct}%</span>
        </div>
      </div>
      <div class="roadmap-progress-bar">
        <div class="roadmap-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="roadmap-milestones">${milestonesHtml}</div>
    `;

    card.querySelectorAll('.roadmap-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const ri = parseInt(chk.closest('[data-rm]').dataset.rm);
        const mi = parseInt(chk.closest('[data-ms]').dataset.ms);
        const ck = `roadmap_checks_${ri}`;
        const c = load(ck, {});
        c[mi] = chk.checked;
        save(ck, c);
        renderRoadmaps();
      });
    });

    container.prepend(card); // newest first
  });
}

function appendChatMsg(role, text) {
  const messages = document.getElementById('goalChatMessages');
  if (!messages) return;
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg-${role === 'user' ? 'user' : 'assistant'}`;
  div.innerHTML = `<div class="chat-bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function setGoalChatLoading(loading) {
  const input = document.getElementById('goalChatInput');
  const sendBtn = document.getElementById('goalChatSendBtn');
  const thinking = document.getElementById('goalChatThinking');
  if (input) input.disabled = loading;
  if (sendBtn) sendBtn.disabled = loading;
  if (thinking) thinking.style.display = loading ? 'flex' : 'none';
  if (!loading && input) input.focus();
}

function generateFallbackGoalResponse(messages, latestText) {
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.text.trim());
  const initialGoal = userMessages[0] || latestText;
  
  let goalTitle = initialGoal
    .replace(/^(i want to|i wanna|i would like to|my goal is to|how to|i plan to|help me)\s+/i, '')
    .trim();
  goalTitle = goalTitle.charAt(0).toUpperCase() + goalTitle.slice(1);
  if (!goalTitle) goalTitle = 'Personal Goal Roadmap';

  const isFirstMessage = userMessages.length <= 1;
  const hasDetails = /\b(\d+\s*(weeks?|months?|days?|hours?)|beginner|advanced|intermediate|full\s*stack|front\s*end|back\s*end|yes|sure|okay)\b/i.test(latestText);

  if (isFirstMessage && !hasDetails) {
    return {
      reply: `That's an exciting goal! To tailor the best step-by-step roadmap for "${goalTitle}", could you share a bit more:\n1. What is your current experience level or starting point?\n2. What is your target timeframe (e.g. 3 months, 6 months)?\n3. How many hours per week can you dedicate?`,
      roadmap: null
    };
  }

  const lower = (initialGoal + ' ' + latestText).toLowerCase();
  let milestones = [];

  if (lower.includes('web') || lower.includes('code') || lower.includes('program') || lower.includes('develop') || lower.includes('software') || lower.includes('app')) {
    milestones = [
      { title: 'Core Fundamentals & HTML/CSS layout essentials', timeframe: 'Weeks 1–3' },
      { title: 'Modern JavaScript (ES6+) & DOM interactivity', timeframe: 'Weeks 4–7' },
      { title: 'Front-end Framework (React/Next.js) & Component state', timeframe: 'Weeks 8–11' },
      { title: 'API Integration, Backend server basics & Database storage', timeframe: 'Weeks 12–15' },
      { title: 'Build & Deploy 2 full-stack showcase projects', timeframe: 'Weeks 16–18' }
    ];
  } else if (lower.includes('fit') || lower.includes('weight') || lower.includes('run') || lower.includes('gym') || lower.includes('muscle') || lower.includes('health')) {
    milestones = [
      { title: 'Baseline assessment & establish 3x weekly workout habit', timeframe: 'Week 1' },
      { title: 'Consistent progressive training & nutrition tracking', timeframe: 'Weeks 2–4' },
      { title: 'Increase intensity & progressive overload checkpoints', timeframe: 'Weeks 5–8' },
      { title: 'Midpoint evaluation & milestone performance test', timeframe: 'Weeks 9–10' },
      { title: 'Achieve primary benchmark & long-term maintenance', timeframe: 'Weeks 11–12' }
    ];
  } else if (lower.includes('read') || lower.includes('book') || lower.includes('study') || lower.includes('learn') || lower.includes('exam')) {
    milestones = [
      { title: 'Curate core curriculum & daily 30-min focused study block', timeframe: 'Week 1' },
      { title: 'Complete foundational modules & active note synthesis', timeframe: 'Weeks 2–4' },
      { title: 'Deep dive into advanced topics & practical exercises', timeframe: 'Weeks 5–8' },
      { title: 'Practical project application & final review', timeframe: 'Weeks 9–10' }
    ];
  } else {
    milestones = [
      { title: 'Initial research, resource setup & baseline planning', timeframe: 'Phase 1 (Weeks 1–2)' },
      { title: 'Core skill acquisition & focused daily execution sprint', timeframe: 'Phase 2 (Weeks 3–6)' },
      { title: 'Midpoint checkpoint & refining approach based on feedback', timeframe: 'Phase 3 (Weeks 7–8)' },
      { title: 'Practical application & building milestone deliverables', timeframe: 'Phase 4 (Weeks 9–11)' },
      { title: 'Final milestone review & long-term mastery routine', timeframe: 'Phase 5 (Week 12)' }
    ];
  }

  return {
    reply: `I've created a tailored roadmap for "${goalTitle}" with actionable milestones! You can track and check off your progress in the roadmap panel above.`,
    roadmap: {
      goalTitle,
      summary: `Actionable milestone plan to achieve ${goalTitle.toLowerCase()}.`,
      milestones
    }
  };
}

async function sendGoalMessage() {
  const input = document.getElementById('goalChatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  appendChatMsg('user', text);
  goalConversation.push({ role: 'user', text });

  setGoalChatLoading(true);

  let success = false;

  try {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: goalConversation,
        systemInstruction: GOALS_SYSTEM_INSTRUCTION,
        responseSchema: GOALS_RESPONSE_SCHEMA
      })
    });

    if (res && res.ok) {
      const data = await res.json();
      let parsed;
      try { parsed = typeof data.text === 'string' ? JSON.parse(data.text) : data; } catch(e) {
        parsed = null;
      }

      if (parsed && (parsed.reply || parsed.roadmap)) {
        const { reply, roadmap } = parsed;
        if (reply) {
          appendChatMsg('assistant', reply);
          goalConversation.push({ role: 'model', text: reply });
        }
        if (roadmap && roadmap.goalTitle && roadmap.milestones && roadmap.milestones.length) {
          const roadmaps = load('roadmaps', []);
          roadmaps.push(roadmap);
          save('roadmaps', roadmaps);
          renderRoadmaps();
          if (window._renderDashboardGoals) window._renderDashboardGoals();
          appendChatMsg('assistant', 'Roadmap added to My Roadmaps \u2191');
        }
        success = true;
      }
    }
  } catch(err) {
    console.warn('[GoalChat] API unavailable or rate-limited, engaging smart fallback planner:', err);
  }

  // Smart Offline/Rate-limit Fallback Engine
  if (!success) {
    try {
      const { reply, roadmap } = generateFallbackGoalResponse(goalConversation, text);
      appendChatMsg('assistant', reply);
      goalConversation.push({ role: 'model', text: reply });

      if (roadmap && roadmap.goalTitle && roadmap.milestones && roadmap.milestones.length) {
        const roadmaps = load('roadmaps', []);
        roadmaps.push(roadmap);
        save('roadmaps', roadmaps);
        renderRoadmaps();
        if (window._renderDashboardGoals) window._renderDashboardGoals();
        appendChatMsg('assistant', 'Roadmap added to My Roadmaps \u2191');
      }
    } catch(fallbackErr) {
      appendChatMsg('assistant', "I'm ready to help you plan! Tell me a bit about your goal and your target timeframe.");
      console.error('[GoalChat Fallback Error]', fallbackErr);
    }
  }

  setGoalChatLoading(false);
}

function resetGoalChat() {
  goalConversation = [];
  const messages = document.getElementById('goalChatMessages');
  if (messages) {
    messages.innerHTML = '';
    appendChatMsg('assistant', INITIAL_CHAT_MSG);
  }
  const input = document.getElementById('goalChatInput');
  if (input) { input.value = ''; input.focus(); }
}

(function initGoalChat() {
  const sendBtn = document.getElementById('goalChatSendBtn');
  const input = document.getElementById('goalChatInput');
  const resetBtn = document.getElementById('goalChatResetBtn');
  if (sendBtn) sendBtn.addEventListener('click', sendGoalMessage);
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) sendGoalMessage(); });
  if (resetBtn) resetBtn.addEventListener('click', resetGoalChat);
})();

/* ---------------- EVENTS ---------------- */
function addEvent(name, date){
  const items = load('events', []);
  items.push({ id: uid(), name, date: date || todayISO() });
  save('events', items);
  renderEvents();
  renderMiniCalendar();
}
function wireEventAdd(btnId, nameId, dateId){
  const btn = document.getElementById(btnId), nameInput = document.getElementById(nameId), dateInput = document.getElementById(dateId);
  if (!btn || !nameInput || !dateInput) return;
  const go = () => {
    if (!nameInput.value.trim()) { nameInput.focus(); return; }
    addEvent(nameInput.value.trim(), dateInput.value || todayISO());
    nameInput.value=''; dateInput.value='';
  };
  btn.addEventListener('click', go);
  nameInput.addEventListener('keydown', e => { if (e.key==='Enter') go(); });
  dateInput.addEventListener('keydown', e => { if (e.key==='Enter') go(); });
}
function renderEvents(){
  const events = load('events', []).slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
  const todayStart = new Date(new Date().toDateString());

  document.querySelectorAll('.js-event-list').forEach(list => {
    const compact = list.dataset.compact === 'true';
    list.innerHTML = '';

    if (!events.length){
      list.innerHTML = `<div class="event-empty">No upcoming events${compact ? '' : ' yet - add one below'}.</div>`;
      if (compact){
        const link = document.createElement('span');
        link.className = 'event-view-all';
        link.textContent = 'Add one on the Calendar page ->';
        link.addEventListener('click', () => showView('calendar'));
        list.appendChild(link);
      }
      return;
    }

    function buildRow(ev, isNext){
      const d = new Date(ev.date + 'T00:00:00');
      const isPast = d < todayStart;
      const row = document.createElement('div');
      row.className = 'event-row' + (isNext ? ' next-event' : '') + (isPast ? ' past-event' : '');
      row.innerHTML = `
        <div class="event-date"><div class="d">${d.getDate()}</div><div class="m">${d.toLocaleString(undefined,{month:'short'})}</div></div>
        <div style="flex:1;"><div class="event-title">${escapeHtml(ev.name)}</div><div class="event-sub">${d.toLocaleDateString(undefined,{weekday:'long'})}</div></div>
        <button class="rm" data-rm="${ev.id}" title="Remove" style="background:none;border:none;color:var(--text-3);font-size:16px;cursor:pointer;">&times;</button>
      `;
      row.querySelector('.rm').addEventListener('click', () => {
        const arr = load('events', []).filter(x => x.id !== ev.id);
        save('events', arr);
        renderEvents();
        renderMiniCalendar();
      });
      return row;
    }

    // nearest upcoming first (highlighted), past events pushed below a divider â€” same design everywhere
    const upcoming = events.filter(ev => new Date(ev.date+'T00:00:00') >= todayStart);
    const past = events.filter(ev => new Date(ev.date+'T00:00:00') < todayStart).sort((a,b)=> new Date(b.date) - new Date(a.date));

    if (!upcoming.length){
      list.innerHTML += `<div class="event-empty">No upcoming events${compact ? '' : ' - add one below'}.</div>`;
    } else {
      upcoming.forEach((ev, i) => list.appendChild(buildRow(ev, i === 0)));
    }
    if (past.length){
      const divider = document.createElement('div');
      divider.className = 'event-divider';
      divider.textContent = 'Past';
      list.appendChild(divider);
      past.forEach(ev => list.appendChild(buildRow(ev, false)));
    }

    if (compact){
      const link = document.createElement('span');
      link.className = 'event-view-all';
      link.textContent = 'Manage on Calendar ->';
      link.addEventListener('click', () => showView('calendar'));
      list.appendChild(link);
    }
  });
}
wireEventAdd('eventAddBtn','eventInput','eventDate');
wireEventAdd('pageEventAddBtn','pageEventInput','pageEventDate');
const goToCalendarLink = document.getElementById('goToCalendar');
if (goToCalendarLink) goToCalendarLink.addEventListener('click', () => showView('calendar'));
const goToHabitsLink = document.getElementById('goToHabits');
if (goToHabitsLink) goToHabitsLink.addEventListener('click', () => showView('habits'));

/* ---------------- MINI CALENDAR ---------------- */
function renderMiniCalendar(){
  const wrap = document.getElementById('miniCalendar');
  if (!wrap) return;
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const label = document.getElementById('calMonthLabel');
  if (label) label.textContent = now.toLocaleString(undefined,{month:'long'}) + ' ' + year;

  const events = load('events', []);
  const eventsByDay = {};
  events.forEach(e => {
    const d = new Date(e.date+'T00:00:00');
    if (d.getFullYear()===year && d.getMonth()===month){
      const day = d.getDate();
      (eventsByDay[day] = eventsByDay[day] || []).push(e);
    }
  });

  const firstDow = (new Date(year, month, 1).getDay()+6)%7; // Mon=0
  const daysCount = new Date(year, month+1, 0).getDate();
  const todayNum = now.getDate();

  let html = '<div class="mini-cal">';
  ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d => html += `<div class="dow">${d}</div>`);
  for (let i=0;i<firstDow;i++) html += '<div class="day-cell empty"></div>';
  for (let d=1; d<=daysCount; d++){
    const isToday = d === todayNum;
    const dayEvents = eventsByDay[d];
    if (dayEvents && dayEvents.length){
      const extra = dayEvents.length - 1;
      html += `<div class="day-cell has-event${isToday?' today':''}" data-day="${d}" title="${escapeHtml(dayEvents.map(e=>e.name).join(', '))}">
        <span class="day-num">${d}</span>
        <span class="evt-label">${escapeHtml(dayEvents[0].name)}</span>
        ${extra > 0 ? `<span class="evt-more">+${extra} more</span>` : ''}
      </div>`;
    } else {
      html += `<div class="day-cell${isToday?' today':''}" data-day="${d}">${d}</div>`;
    }
  }
  html += '</div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.day-cell[data-day]').forEach(cell => {
    cell.addEventListener('click', () => {
      const d = String(cell.dataset.day).padStart(2,'0');
      const m = String(month+1).padStart(2,'0');
      const dateInput = document.getElementById('pageEventDate');
      const nameInput = document.getElementById('pageEventInput');
      if (dateInput) dateInput.value = `${year}-${m}-${d}`;
      if (nameInput) nameInput.focus();
    });
  });
}

/* ---------------- PROJECTS & NOTES ---------------- */

let currentEditingNoteId = null;
let currentFolderProjectId = null;
let selectedProjectColor = '#8b6cf7';
let editorAutoSaveTimer = null;
let editorReturnView = 'main'; // 'main' | 'folder'

const OPTIONS_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;

function showNotesMainView() {
  const mainView = document.getElementById('notesMainView');
  const allSection = document.getElementById('notesAllSection');
  const folderView = document.getElementById('notesFolderView');
  const editorView = document.getElementById('notionEditorView');
  if (mainView) mainView.style.display = '';
  if (allSection) allSection.style.display = '';
  if (folderView) folderView.style.display = 'none';
  if (editorView) editorView.style.display = 'none';
  currentFolderProjectId = null;
}

function showNotesFolderView(projectId) {
  const mainView = document.getElementById('notesMainView');
  const allSection = document.getElementById('notesAllSection');
  const folderView = document.getElementById('notesFolderView');
  const editorView = document.getElementById('notionEditorView');
  if (mainView) mainView.style.display = 'none';
  if (allSection) allSection.style.display = 'none';
  if (folderView) folderView.style.display = '';
  if (editorView) editorView.style.display = 'none';
  currentFolderProjectId = projectId;

  const projects = load('projects', DEFAULT_PROJECTS);
  const project = projects.find(p => p.id === projectId);
  const folderTitle = document.getElementById('folderViewTitle');
  if (folderTitle && project) folderTitle.textContent = project.title;

  renderFolderNotes(projectId);
}

function renderProjects() {
  const container = document.getElementById('projectGrid');
  if (!container) return;
  const projects = load('projects', DEFAULT_PROJECTS);
  container.innerHTML = '';

  projects.forEach(p => {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.style.cursor = 'pointer';
    card.innerHTML = `
      <div class="folder-top-row">
        <span class="folder-title">${escapeHtml(p.title)}</span>
      </div>
      <div class="folder-bottom-row">
        <span>${escapeHtml(p.date || 'Today')}</span>
        <button class="card-opts-btn" data-project-opts="${p.id}" title="Options">${OPTIONS_ICON_SVG}</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-opts-btn')) return;
      showNotesFolderView(p.id);
    });

    card.querySelector('[data-project-opts]').addEventListener('click', (e) => {
      e.stopPropagation();
      openCardMenu(e.currentTarget, [
        { label: 'Open Project', action: () => showNotesFolderView(p.id) },
        { label: 'Delete Project', danger: true, action: () => deleteProject(p.id) }
      ]);
    });

    container.appendChild(card);
  });

  // Add Project Tile
  const addTile = document.createElement('div');
  addTile.className = 'folder-add-tile';
  addTile.innerHTML = `<span class="plus-icon">+</span><span>Add project</span>`;
  addTile.addEventListener('click', openProjectModal);
  container.appendChild(addTile);
}

function deleteProject(id) {
  const projects = load('projects', []).filter(p => p.id !== id);
  save('projects', projects);
  renderProjects();
}

function normalizeTags(rawTags) {
  if (!rawTags) return [{ label: 'General', color: '#8b6cf7' }];
  let arr = [];
  if (Array.isArray(rawTags)) {
    arr = rawTags;
  } else if (typeof rawTags === 'string') {
    arr = rawTags.split(',').map(s => s.trim()).filter(Boolean);
  } else if (typeof rawTags === 'object') {
    arr = [rawTags];
  }
  const tagColors = ['#8b6cf7', '#34d399', '#ff9d3d', '#ffcf7d', '#ff6b8a', '#38bdf8'];
  return arr.map((t, idx) => {
    if (typeof t === 'string') {
      return { label: t, color: tagColors[idx % tagColors.length] };
    }
    if (t && typeof t === 'object') {
      return { label: t.label || t.name || 'Tag', color: t.color || tagColors[idx % tagColors.length] };
    }
    return { label: 'General', color: '#8b6cf7' };
  });
}

function formatNotePreview(rawHtml, maxLength = 140) {
  if (!rawHtml) return '';
  let str = String(rawHtml);

  // Replace line breaks and paragraph/block closures with newline characters
  str = str.replace(/<br\s*\/?>/gi, '\n');
  str = str.replace(/<li[^>]*>/gi, '\n• ');
  str = str.replace(/<\/(div|p|h[1-6]|li|blockquote|pre|tr)>/gi, '\n');
  str = str.replace(/<(div|p|h[1-6]|blockquote|pre|tr)[^>]*>/gi, '\n');

  // Strip all other remaining HTML tags
  str = str.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  const parser = document.createElement('div');
  parser.innerHTML = str;
  str = parser.textContent || parser.innerText || '';

  // Clean up extra blank lines while preserving meaningful line breaks
  const lines = str.split('\n')
    .map(line => line.trim())
    .filter((line, idx, arr) => {
      if (!line && idx > 0 && !arr[idx - 1]) return false;
      return true;
    });

  let result = lines.join('\n').trim();

  if (maxLength && result.length > maxLength) {
    result = result.slice(0, maxLength).trim() + '...';
  }

  return result;
}

const NOTION_COVERS = [
  'linear-gradient(135deg, #4f46e5 0%, #9333ea 50%, #db2777 100%)',
  'linear-gradient(135deg, #0ea5e9 0%, #6366f1 50%, #a855f7 100%)',
  'linear-gradient(135deg, #059669 0%, #10b981 50%, #06b6d4 100%)',
  'linear-gradient(135deg, #d97706 0%, #f59e0b 50%, #ef4444 100%)',
  'linear-gradient(135deg, #e11d48 0%, #be185d 50%, #831843 100%)',
  'linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)'
];

function renderNotes() {
  const allNotes = load('notes', DEFAULT_NOTES);
  const notes = allNotes.filter(n => !n.projectId); // Top-level notes

  const countBadge = document.getElementById('notesCountBadge');
  if (countBadge) countBadge.textContent = String(allNotes.length);

  // Render on Notes Page (#pageNoteList)
  const pageContainer = document.getElementById('pageNoteList');
  if (pageContainer) {
    pageContainer.innerHTML = '';
    notes.forEach(n => {
      const card = document.createElement('div');
      card.className = 'rich-note-card';
      card.style.cursor = 'pointer';

      card.innerHTML = `
        <div class="rich-note-top">
          <span>${escapeHtml(n.date || 'Today')}</span>
          <button class="card-opts-btn" data-note-opts="${n.id}" title="Options">${OPTIONS_ICON_SVG}</button>
        </div>
        <h4 class="rich-note-title">${escapeHtml(n.title || 'Untitled')}</h4>
        <p class="rich-note-body">${escapeHtml(formatNotePreview(n.body, 140) || '')}</p>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-opts-btn')) return;
        openNotionEditor(n, null, 'main');
      });

      card.querySelector('[data-note-opts]').addEventListener('click', (e) => {
        e.stopPropagation();
        openCardMenu(e.currentTarget, [
          { label: 'Open Page', action: () => openNotionEditor(n, null, 'main') },
          { label: 'Delete Page', danger: true, action: () => deleteNote(n.id) }
        ]);
      });

      pageContainer.appendChild(card);
    });

    // Add Note Card Tile
    const addTile = document.createElement('div');
    addTile.className = 'rich-note-add-tile';
    addTile.innerHTML = `<span class="plus-icon">+</span><span>Add note</span>`;
    addTile.addEventListener('click', () => openNotionEditor(null, null, 'main'));
    pageContainer.appendChild(addTile);
  }

  // Render on Dashboard (#noteList)
  const dashContainer = document.getElementById('noteList');
  if (dashContainer) {
    dashContainer.innerHTML = '';
    if (!notes.length) {
      dashContainer.innerHTML = `<div class="event-empty" style="grid-column:1/-1;">No notes yet - tap + to add one.</div>`;
      return;
    }
    notes.slice(0, 4).forEach((n) => {
      const el = document.createElement('div');
      el.className = 'rich-note-card note-card';
      el.style.cursor = 'pointer';
      el.innerHTML = `
        <div class="rich-note-top">
          <span>${escapeHtml(n.date || 'Today')}</span>
          <button class="card-opts-btn" data-note-opts="${n.id}" title="Options">${OPTIONS_ICON_SVG}</button>
        </div>
        <h4 class="rich-note-title">${escapeHtml(n.title || 'Untitled')}</h4>
        <p class="rich-note-body">${escapeHtml(formatNotePreview(n.body, 140) || '')}</p>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.card-opts-btn')) return;
        showView('notes');
        openNotionEditor(n, null, 'main');
      });
      el.querySelector('[data-note-opts]').addEventListener('click', (e) => {
        e.stopPropagation();
        openCardMenu(e.currentTarget, [
          { label: 'Open Page', action: () => { showView('notes'); openNotionEditor(n, null, 'main'); } },
          { label: 'Delete Page', danger: true, action: () => deleteNote(n.id) }
        ]);
      });
      dashContainer.appendChild(el);
    });
  }
}

function renderFolderNotes(projectId) {
  const container = document.getElementById('folderNoteList');
  if (!container) return;
  const notes = load('notes', DEFAULT_NOTES).filter(n => n.projectId === projectId);
  container.innerHTML = '';

  notes.forEach(n => {
    const card = document.createElement('div');
    card.className = 'rich-note-card';
    card.style.cursor = 'pointer';

    card.innerHTML = `
      <div class="rich-note-top">
        <span>${escapeHtml(n.date || 'Today')}</span>
        <button class="card-opts-btn" data-note-opts="${n.id}" title="Options">${OPTIONS_ICON_SVG}</button>
      </div>
      <h4 class="rich-note-title">${escapeHtml(n.title || 'Untitled')}</h4>
      <p class="rich-note-body">${escapeHtml(formatNotePreview(n.body, 140) || '')}</p>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-opts-btn')) return;
      openNotionEditor(n, projectId, 'folder');
    });

    card.querySelector('[data-note-opts]').addEventListener('click', (e) => {
      e.stopPropagation();
      openCardMenu(e.currentTarget, [
        { label: 'Open Page', action: () => openNotionEditor(n, projectId, 'folder') },
        { label: 'Delete Page', danger: true, action: () => deleteNote(n.id) }
      ]);
    });

    container.appendChild(card);
  });

  // Append "Add note" Card Tile inside folder view
  const addTile = document.createElement('div');
  addTile.className = 'rich-note-add-tile';
  addTile.innerHTML = `<span class="plus-icon">+</span><span>Add note</span>`;
  addTile.addEventListener('click', () => openNotionEditor(null, projectId, 'folder'));
  container.appendChild(addTile);
}

function deleteNote(id) {
  const notes = load('notes', []).filter(n => n.id !== id);
  save('notes', notes);
  renderNotes();
  if (currentFolderProjectId) renderFolderNotes(currentFolderProjectId);
}

/* ---------- NOTION-STYLE WORKSPACE & DOCUMENT EDITOR ---------- */
function openNotionEditor(noteToEdit = null, forProjectId = null, returnView = 'main') {
  const mainView = document.getElementById('notesMainView');
  const allSection = document.getElementById('notesAllSection');
  const folderView = document.getElementById('notesFolderView');
  const editorView = document.getElementById('notionEditorView');

  if (!editorView) return;

  if (mainView) mainView.style.display = 'none';
  if (allSection) allSection.style.display = 'none';
  if (folderView) folderView.style.display = 'none';
  editorView.style.display = '';

  editorReturnView = returnView;

  const notes = load('notes', DEFAULT_NOTES);
  const projects = load('projects', DEFAULT_PROJECTS);
  let targetNote = null;

  if (noteToEdit) {
    targetNote = notes.find(n => n.id === noteToEdit.id) || noteToEdit;
    currentEditingNoteId = targetNote.id;
  } else {
    // Create new note
    const now = new Date();
    const dateStr = `${now.getDate()}th ${now.toLocaleString(undefined,{month:'short'})}, ${now.getFullYear()}`;
    const targetProj = forProjectId || null;
    targetNote = {
      id: uid(),
      title: '',
      body: '',
      icon: '',
      cover: '',
      date: dateStr,
      tags: [{ label: 'General', color: '#8b6cf7' }],
      projectId: targetProj
    };
    notes.unshift(targetNote);
    save('notes', notes);
    currentEditingNoteId = targetNote.id;
  }

  // Update Top Date Badge with note creation date
  const todayDateEl = document.getElementById('todayDate');
  const todayChipEl = document.querySelector('.today-chip');
  if (todayDateEl) todayDateEl.textContent = targetNote.date || 'Today';
  if (todayChipEl) {
    todayChipEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      Created
    `;
  }

  // Populate Title & Body
  const titleInput = document.getElementById('notionPageTitleInput');
  const canvas = document.getElementById('notionEditorCanvas');

  if (titleInput) titleInput.value = targetNote.title || '';
  if (canvas) canvas.innerHTML = targetNote.body || '';

  if (titleInput && !targetNote.title) {
    titleInput.focus();
  }
}

function resetTopDateBadge() {
  const todayDateEl = document.getElementById('todayDate');
  const todayChipEl = document.querySelector('.today-chip');
  if (todayDateEl) {
    todayDateEl.textContent = new Date().toLocaleDateString(undefined, { day:'numeric', month:'long', year:'numeric' });
  }
  if (todayChipEl) {
    todayChipEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      Today
    `;
  }
}

function closeNotionEditor() {
  saveCurrentNotionEditor();
  resetTopDateBadge();
  const slashMenu = document.getElementById('notionSlashMenu');
  if (slashMenu) slashMenu.style.display = 'none';
  const floatBar = document.getElementById('notionFloatingToolbar');
  if (floatBar) floatBar.style.display = 'none';

  if (editorReturnView === 'folder' && currentFolderProjectId) {
    showNotesFolderView(currentFolderProjectId);
  } else {
    showNotesMainView();
  }
  renderProjects();
  renderNotes();
}

function saveCurrentNotionEditor() {
  if (!currentEditingNoteId) return;
  const notes = load('notes', DEFAULT_NOTES);
  const note = notes.find(n => n.id === currentEditingNoteId);
  if (!note) return;

  const titleInput = document.getElementById('notionPageTitleInput');
  const canvas = document.getElementById('notionEditorCanvas');

  if (titleInput) {
    note.title = titleInput.value.trim();
  }
  if (canvas) note.body = canvas.innerHTML;

  save('notes', notes);
}

  const badge = document.getElementById('notionSaveBadge');
  if (badge) {
    badge.querySelector('.save-text').textContent = 'Saved';
    badge.style.opacity = '1';
    setTimeout(() => { if (badge) badge.style.opacity = '0.6'; }, 1000);
  }
}

function scheduleEditorAutoSave() {
  clearTimeout(editorAutoSaveTimer);
  const badge = document.getElementById('notionSaveBadge');
  if (badge) {
    badge.querySelector('.save-text').textContent = 'Saving...';
    badge.style.opacity = '1';
  }
  editorAutoSaveTimer = setTimeout(saveCurrentNotionEditor, 400);
}

function handleSlashCommand(cmd) {
  const canvas = document.getElementById('notionEditorCanvas');
  const menu = document.getElementById('notionSlashMenu');
  if (!canvas || !menu) return;
  menu.style.display = 'none';

  canvas.focus();
  if (cmd === 'text') {
    document.execCommand('formatBlock', false, '<p>');
  } else if (cmd === 'h1') {
    document.execCommand('formatBlock', false, '<h1>');
  } else if (cmd === 'h2') {
    document.execCommand('formatBlock', false, '<h2>');
  } else if (cmd === 'h3') {
    document.execCommand('formatBlock', false, '<h3>');
  } else if (cmd === 'bullet') {
    document.execCommand('insertUnorderedList', false, null);
  } else if (cmd === 'number') {
    document.execCommand('insertOrderedList', false, null);
  } else if (cmd === 'quote') {
    document.execCommand('formatBlock', false, '<blockquote>');
  } else if (cmd === 'code') {
    document.execCommand('insertHTML', false, '<pre><code>// Code snippet...</code></pre>');
  } else if (cmd === 'todo') {
    document.execCommand('insertHTML', false, '<div class="notion-todo-item"><div class="notion-checkbox"></div><div class="notion-todo-text">Checklist item</div></div>');
  } else if (cmd === 'callout') {
    document.execCommand('insertHTML', false, '<div class="notion-callout"><div class="notion-callout-icon">!</div><div class="notion-callout-text">Callout tip or highlight...</div></div>');
  } else if (cmd === 'divider') {
    document.execCommand('insertHorizontalRule', false, null);
  }

  scheduleEditorAutoSave();
}

/* Card dropdown menu helper */
let activeCardMenu = null;
function closeCardMenu() {
  if (activeCardMenu) {
    activeCardMenu.remove();
    activeCardMenu = null;
  }
}
document.addEventListener('click', closeCardMenu);

function openCardMenu(buttonEl, items) {
  closeCardMenu();
  const card = buttonEl.closest('.folder-card, .rich-note-card, .notion-editor-topbar');
  if (!card) return;
  const menu = document.createElement('div');
  menu.className = 'card-menu-dropdown';

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'card-menu-item' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCardMenu();
      item.action();
    });
    menu.appendChild(btn);
  });

  card.appendChild(menu);
  activeCardMenu = menu;
}

/* ---------- Modals Logic ---------- */
function openProjectModal() {
  const modal = document.getElementById('projectModal');
  const input = document.getElementById('projectTitleInput');
  if (!modal || !input) return;
  input.value = '';
  modal.style.display = 'flex';
  input.focus();
}
window.closeProjectModal = function() {
  const modal = document.getElementById('projectModal');
  if (modal) modal.style.display = 'none';
};

// DOM Event Wiring for Notes & Notion Editor
document.addEventListener('DOMContentLoaded', () => {
  const openProjBtn = document.getElementById('openProjectModalBtn');
  if (openProjBtn) openProjBtn.addEventListener('click', openProjectModal);

  const openNoteBtn = document.getElementById('openNoteModalBtn');
  if (openNoteBtn) openNoteBtn.addEventListener('click', () => openNotionEditor(null, null, 'main'));

  const openNoteInFolderBtn = document.getElementById('openNoteInFolderBtn');
  if (openNoteInFolderBtn) openNoteInFolderBtn.addEventListener('click', () => openNotionEditor(null, currentFolderProjectId, 'folder'));

  const backBtn = document.getElementById('notesFolderBackBtn');
  if (backBtn) backBtn.addEventListener('click', () => { showNotesMainView(); renderProjects(); renderNotes(); });

  const editorBackBtn = document.getElementById('notionEditorBackBtn');
  if (editorBackBtn) editorBackBtn.addEventListener('click', closeNotionEditor);

  const saveProjBtn = document.getElementById('saveProjectBtn');
  if (saveProjBtn) {
    saveProjBtn.addEventListener('click', () => {
      const input = document.getElementById('projectTitleInput');
      const title = input ? input.value.trim() : '';
      if (!title) return;
      const projects = load('projects', DEFAULT_PROJECTS);
      const now = new Date();
      const dateStr = `${now.getDate()}th ${now.toLocaleString(undefined,{month:'short'})}, ${now.getFullYear()}`;
      projects.unshift({ id: uid(), title, color: selectedProjectColor, date: dateStr });
      save('projects', projects);
      renderProjects();
      closeProjectModal();
    });
  }

  // Cover Banner controls
  const addCoverBtn = document.getElementById('notionAddCoverBtn');
  const coverWrap = document.getElementById('notionCoverWrapper');
  const coverImg = document.getElementById('notionCoverImg');
  const changeCoverBtn = document.getElementById('notionChangeCoverBtn');
  const removeCoverBtn = document.getElementById('notionRemoveCoverBtn');

  let currentCoverIdx = 0;
  if (addCoverBtn) {
    addCoverBtn.addEventListener('click', () => {
      if (coverWrap && coverImg) {
        currentCoverIdx = 0;
        coverImg.style.background = NOTION_COVERS[0];
        coverWrap.style.display = 'block';
        scheduleEditorAutoSave();
      }
    });
  }

  if (changeCoverBtn) {
    changeCoverBtn.addEventListener('click', () => {
      if (coverWrap && coverImg) {
        currentCoverIdx = (currentCoverIdx + 1) % NOTION_COVERS.length;
        coverImg.style.background = NOTION_COVERS[currentCoverIdx];
        scheduleEditorAutoSave();
      }
    });
  }

  if (removeCoverBtn) {
    removeCoverBtn.addEventListener('click', () => {
      if (coverWrap) {
        coverWrap.style.display = 'none';
        scheduleEditorAutoSave();
      }
    });
  }

  // Notion Editor input auto-saving
  const titleInput = document.getElementById('notionPageTitleInput');
  const canvas = document.getElementById('notionEditorCanvas');
  const slashMenu = document.getElementById('notionSlashMenu');
  const floatingToolbar = document.getElementById('notionFloatingToolbar');

  if (titleInput) titleInput.addEventListener('input', scheduleEditorAutoSave);

  if (canvas) {
    canvas.addEventListener('input', () => {
      scheduleEditorAutoSave();
      const sel = window.getSelection();
      if (sel && sel.focusNode) {
        const textBefore = sel.focusNode.textContent || '';
        if (textBefore.endsWith('/')) {
          if (slashMenu) {
            const rect = canvas.getBoundingClientRect();
            slashMenu.style.display = 'flex';
            slashMenu.style.top = '120px';
            slashMenu.style.left = '56px';
          }
        } else {
          if (slashMenu) slashMenu.style.display = 'none';
        }
      }
    });

    // Checkbox toggle click delegation inside editor canvas
    canvas.addEventListener('click', (e) => {
      const checkbox = e.target.closest('.notion-checkbox');
      if (checkbox) {
        checkbox.classList.toggle('checked');
        const textEl = checkbox.parentElement.querySelector('.notion-todo-text');
        if (textEl) textEl.classList.toggle('checked', checkbox.classList.contains('checked'));
        scheduleEditorAutoSave();
      }
    });

    // Floating toolbar on text selection
    const checkSelection = () => {
      const sel = window.getSelection();
      if (!floatingToolbar) return;
      if (sel && !sel.isCollapsed && canvas.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const canvasRect = canvas.parentElement.getBoundingClientRect();
        floatingToolbar.style.display = 'flex';
        floatingToolbar.style.top = `${Math.max(10, rect.top - canvasRect.top - 44)}px`;
        floatingToolbar.style.left = `${Math.max(20, rect.left - canvasRect.left)}px`;
      } else {
        floatingToolbar.style.display = 'none';
      }
    };

    canvas.addEventListener('mouseup', checkSelection);
    canvas.addEventListener('keyup', checkSelection);
  }

  // Floating toolbar buttons
  if (floatingToolbar) {
    floatingToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const fmt = btn.dataset.format;
        if (fmt === 'bold' || fmt === 'italic' || fmt === 'underline' || fmt === 'strikeThrough') {
          document.execCommand(fmt, false, null);
        } else if (fmt === 'code') {
          document.execCommand('formatBlock', false, '<pre>');
        } else if (fmt === 'h1') {
          document.execCommand('formatBlock', false, '<h1>');
        } else if (fmt === 'h2') {
          document.execCommand('formatBlock', false, '<h2>');
        } else if (fmt === 'highlight') {
          document.execCommand('hiliteColor', false, '#fef08a');
        }
        scheduleEditorAutoSave();
      });
    });
  }

  if (slashMenu) {
    slashMenu.querySelectorAll('.slash-item').forEach(item => {
      item.addEventListener('click', () => {
        handleSlashCommand(item.dataset.cmd);
      });
    });
  }

  const picker = document.getElementById('projectColorPicker');
  if (picker) {
    picker.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        picker.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        selectedProjectColor = dot.dataset.color || '#8b6cf7';
      });
    });
  }
});

/* ---------------- WEEKLY BAR CHART (real data: to-dos + habit tracker) ---------------- */
function renderBars(){
  const container = document.getElementById('barsChart');
  if (!container) return;

  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const now = new Date();
  const dow = (now.getDay()+6)%7; // Mon=0
  const monday = new Date(now); monday.setDate(now.getDate()-dow);

  const grid = load('habitGrid', { habits: [], marks: {} });
  const todos = load('todos', []);
  const todayKeyStr = todayISO();

  const habitVals = [];
  const taskVals = [];
  const dates = [];
  for (let i=0; i<7; i++){
    const d = new Date(monday); d.setDate(monday.getDate()+i);
    dates.push(d);
    const sameMonth = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    let hv = 0;
    if (sameMonth){
      grid.habits.forEach(h => { if (grid.marks[markKey(h.id, d.getDate())]) hv++; });
    }
    habitVals.push(hv);
    const iso = d.toISOString().slice(0,10);
    const tv = todos.filter(t => (t.date || todayKeyStr) === iso && t.done).length;
    taskVals.push(tv);
  }

  const maxHabit = Math.max(...habitVals, grid.habits.length, 1);
  const maxTask = Math.max(...taskVals, 1);
  const todayIdx = dow;

  container.innerHTML = '';
  dayLabels.forEach((label, i) => {
    const col = document.createElement('div');
    col.className = 'bar-col';
    const isFuture = dates[i] > now && dates[i].toDateString() !== now.toDateString();
    const h1 = taskVals[i] > 0 ? Math.max(4, (taskVals[i]/maxTask)*90) : 2;
    const h2 = habitVals[i] > 0 ? Math.max(4, (habitVals[i]/maxHabit)*90) : 2;
    const color1 = 'var(--amber)';
    const color2 = 'var(--blue)';
    col.title = `${label}: ${taskVals[i]} task${taskVals[i]===1?'':'s'}, ${habitVals[i]} habit${habitVals[i]===1?'':'s'}`;
    const op1 = isFuture ? 0.2 : (taskVals[i] > 0 ? 1 : 0.15);
    const op2 = isFuture ? 0.2 : (habitVals[i] > 0 ? 1 : 0.15);
    col.innerHTML = `
      <div class="bar-shell">
        <div class="bar-mini" style="height:${h1}px;background:${color1};opacity:${op1};"></div>
        <div class="bar-mini" style="height:${h2}px;background:${color2};opacity:${op2};"></div>
      </div>
      <div class="day">${label}</div>
    `;
    container.appendChild(col);
  });
}

/* ---------------- TIMER (flip-clock display, Timer + Pomodoro modes) ---------------- */
let timerMode = 'timer';       // 'timer' | 'pomodoro'
let pomodoroPhase = 'work';    // 'work' | 'break'
let timerSeconds = 0;
let timerInterval = null;
let lastShownDigits = ['0','0','0','0'];

function secondsForCurrentMode(){
  return pomodoroPhase === 'work' ? 25*60 : 5*60;
}

function flipTile(id, newDigit){
  const tile = document.getElementById(id);
  if (!tile) return;
  const span = tile.querySelector('span');
  if (span.textContent === newDigit) return;
  tile.classList.add('flip');
  setTimeout(() => {
    span.textContent = newDigit;
    tile.classList.remove('flip');
  }, 110);
}
function updateTimerDisplay(){
  const totalMin = Math.floor(timerSeconds/60);
  const m = String(totalMin % 100).padStart(2,'0');
  const s = String(timerSeconds%60).padStart(2,'0');
  const digits = [m[0], m[1], s[0], s[1]];
  flipTile('tileM1', digits[0]);
  flipTile('tileM2', digits[1]);
  flipTile('tileS1', digits[2]);
  flipTile('tileS2', digits[3]);
  lastShownDigits = digits;
}
function stopTimerInterval(){
  clearInterval(timerInterval);
  timerInterval = null;
  const btn = document.getElementById('timerStart');
  if (btn) {
    btn.textContent = 'Start';
    btn.classList.remove('running');
  }
}
function resetTimer(){
  stopTimerInterval();
  if (timerMode === 'pomodoro') pomodoroPhase = 'work';
  timerSeconds = timerMode === 'timer' ? 0 : secondsForCurrentMode();
  updateTimerDisplay();
  const stateEl = document.getElementById('timerState');
  if (stateEl) stateEl.textContent = timerMode === 'pomodoro' ? 'Ready to focus' : 'Ready to start';
}
function setMode(mode){
  timerMode = mode;
  document.getElementById('modeTimerBtn').classList.toggle('active', mode === 'timer');
  document.getElementById('modePomodoroBtn').classList.toggle('active', mode === 'pomodoro');
  resetTimer();
}

function startTimer(){
  if (timerInterval){
    stopTimerInterval();
    const stateEl = document.getElementById('timerState');
    if (stateEl) stateEl.textContent = 'Paused';
    return;
  }
  const btn = document.getElementById('timerStart');
  if (btn) {
    btn.textContent = 'Pause';
    btn.classList.add('running');
  }
  const stateEl = document.getElementById('timerState');
  if (stateEl) stateEl.textContent = timerMode === 'pomodoro' ? (pomodoroPhase === 'work' ? 'Focusing...' : 'Break time...') : 'Running...';

  timerInterval = setInterval(() => {
    if (timerMode === 'timer'){
      timerSeconds++;
      updateTimerDisplay();
    } else {
      if (timerSeconds > 0){
        timerSeconds--;
        updateTimerDisplay();
      } else {
        stopTimerInterval();
        playBeep();
        if (pomodoroPhase === 'work'){
          pomodoroPhase = 'break';
          timerSeconds = 5*60;
          if (stateEl) stateEl.textContent = 'Take a 5-min break!';
        } else {
          pomodoroPhase = 'work';
          timerSeconds = 25*60;
          if (stateEl) stateEl.textContent = 'Break over. Ready to focus.';
        }
        updateTimerDisplay();
      }
    }
  }, 1000);
}

function playBeep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  }catch(e){}
}

/* ---------------- Global Navigation ---------------- */
function showView(view) {
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
  });
  const activeEl = document.getElementById('view-' + view);
  if (activeEl) activeEl.classList.add('active');

  const viewHeaders = {
    dashboard: {
      title: getGreeting(),
      subtitle: 'Take control of your day.'
    },
    notes: {
      title: 'Notes',
      subtitle: 'Capture ideas before they slip away.'
    },
    habits: {
      title: 'Habit Tracker',
      subtitle: 'Build consistency day by day.'
    },
    timer: {
      title: 'Focus Timer',
      subtitle: 'Stay in flow with the Pomodoro technique.'
    },
    todo: {
      title: 'To-Do Tasks',
      subtitle: 'Track and complete your daily goals.'
    },
    goals: {
      title: 'Roadmap',
      subtitle: 'Plan and track your milestones with AI.'
    },
    calendar: {
      title: 'Calendar',
      subtitle: 'Manage your schedule and upcoming events.'
    }
  };

  const headerInfo = viewHeaders[view] || { title: 'Dashboard', subtitle: '' };
  const greetEl = document.getElementById('greeting');
  const subEl = document.getElementById('pageSubtitle');
  if (greetEl) greetEl.textContent = headerInfo.title;
  if (subEl) subEl.textContent = headerInfo.subtitle;

  resetTopDateBadge();
  if (view === 'dashboard') { renderTodos(); renderHabitQuickList(); renderEvents(); renderNotes(); renderBars(); }
  if (view === 'notes') { showNotesMainView(); renderProjects(); renderNotes(); }
  if (view === 'habits') { renderHabitGrid(); }
  if (view === 'timer') { updateTimerDisplay(); }
  if (view === 'todo') { renderTodos(); }
  if (view === 'goals') { renderRoadmaps(); }
  if (view === 'calendar') { renderMiniCalendar(); renderEvents(); }
}

/* ---------------- Global Search with Exact Results ---------------- */
function performGlobalSearch(rawQ) {
  const dropdown = document.getElementById('searchDropdown');
  const clearBtn = document.getElementById('searchClearBtn');
  if (!dropdown) return;

  const q = (rawQ || '').trim();
  if (clearBtn) clearBtn.style.display = q.length > 0 ? 'flex' : 'none';

  if (!q) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    return;
  }

  const qLower = q.toLowerCase();

  const allNotes = load('notes', DEFAULT_NOTES);
  const allTodos = load('todos', []);
  const allGoals = load('goals', []);
  const allEvents = load('events', []);
  const projects = load('projects', DEFAULT_PROJECTS);

  const isNotesKeyword = /^(note|notes|doc|document|documents)$/i.test(qLower);
  const isTodoKeyword = /^(todo|todos|task|tasks|to-do)$/i.test(qLower);
  const isHabitsKeyword = /^(habit|habits|tracker|streak)$/i.test(qLower);
  const isTimerKeyword = /^(timer|pomodoro|focus|clock|stopwatch)$/i.test(qLower);
  const isGoalsKeyword = /^(goal|goals|roadmap|roadmaps|ai roadmap)$/i.test(qLower);
  const isCalendarKeyword = /^(calendar|event|events|schedule)$/i.test(qLower);

  // Exact Substring Matching for Notes
  let matchedNotes = allNotes.filter(n => {
    if (isNotesKeyword) return true;
    const title = (n.title || '').toLowerCase();
    const cleanBody = formatNotePreview(n.body || '', 300).toLowerCase();
    const tagStr = normalizeTags(n.tags).map(t => t.label).join(' ').toLowerCase();
    return title.includes(qLower) || cleanBody.includes(qLower) || tagStr.includes(qLower);
  }).map(n => ({ note: n, cleanBody: formatNotePreview(n.body || '', 300) }));

  // Exact Substring Matching for Tasks
  let matchedTodos = allTodos.filter(t => {
    if (isTodoKeyword) return true;
    return (t.text || '').toLowerCase().includes(qLower);
  }).map(t => ({ todo: t }));

  // Exact Substring Matching for Roadmaps
  let matchedGoals = allGoals.filter(g => {
    if (isGoalsKeyword) return true;
    const title = (g.title || '').toLowerCase();
    const summary = (g.summary || '').toLowerCase();
    return title.includes(qLower) || summary.includes(qLower);
  }).map(g => ({ goal: g }));

  // Exact Substring Matching for Events
  let matchedEvents = allEvents.filter(e => {
    if (isCalendarKeyword) return true;
    const title = (e.title || '').toLowerCase();
    const tag = (e.tag || '').toLowerCase();
    return title.includes(qLower) || tag.includes(qLower);
  }).map(e => ({ event: e }));

  const hasQuickLinks = isNotesKeyword || isTodoKeyword || isHabitsKeyword || isTimerKeyword || isGoalsKeyword || isCalendarKeyword;
  const totalMatches = matchedNotes.length + matchedTodos.length + matchedGoals.length + matchedEvents.length;

  if (totalMatches === 0 && !hasQuickLinks) {
    dropdown.innerHTML = `<div class="search-empty-message">No exact results found for "<b>${escapeHtml(q)}</b>"</div>`;
    dropdown.style.display = 'flex';
    return;
  }

  let html = '';

  // Quick Navigation Section
  if (hasQuickLinks) {
    if (isNotesKeyword) {
      html += `
        <div class="search-result-item" data-search-type="nav" data-nav-target="notes">
          <div class="search-result-icon note">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h13l3 3v13H4z"/><path d="M8 9h9M8 13h9M8 17h5"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">Go to Notes & Documents</div>
            <div class="search-result-subtitle">Open full Notion-style notebook</div>
          </div>
          <span class="search-result-tag">Section</span>
        </div>
      `;
    }
    if (isTodoKeyword) {
      html += `
        <div class="search-result-item" data-search-type="nav" data-nav-target="todo">
          <div class="search-result-icon todo">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">Go to Tasks</div>
            <div class="search-result-subtitle">Manage daily tasks & checklists</div>
          </div>
          <span class="search-result-tag">Section</span>
        </div>
      `;
    }
    if (isHabitsKeyword) {
      html += `
        <div class="search-result-item" data-search-type="nav" data-nav-target="habits">
          <div class="search-result-icon habit" style="background:var(--amber-soft);color:var(--amber);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 17 9 11 13 15 21 6"/><polyline points="15 6 21 6 21 12"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">Go to Habit Tracker</div>
            <div class="search-result-subtitle">View monthly streaks & habit grid</div>
          </div>
          <span class="search-result-tag">Section</span>
        </div>
      `;
    }
    if (isTimerKeyword) {
      html += `
        <div class="search-result-item" data-search-type="nav" data-nav-target="timer">
          <div class="search-result-icon timer" style="background:var(--blue-soft);color:var(--blue);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">Go to Focus Timer</div>
            <div class="search-result-subtitle">Start Pomodoro or Focus session</div>
          </div>
          <span class="search-result-tag">Section</span>
        </div>
      `;
    }
    if (isGoalsKeyword) {
      html += `
        <div class="search-result-item" data-search-type="nav" data-nav-target="goals">
          <div class="search-result-icon goal">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">Go to AI Roadmap</div>
            <div class="search-result-subtitle">Explore roadmaps & milestones</div>
          </div>
          <span class="search-result-tag">Section</span>
        </div>
      `;
    }
    if (isCalendarKeyword) {
      html += `
        <div class="search-result-item" data-search-type="nav" data-nav-target="calendar">
          <div class="search-result-icon event">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">Go to Calendar</div>
            <div class="search-result-subtitle">View schedule & events</div>
          </div>
          <span class="search-result-tag">Section</span>
        </div>
      `;
    }
  }

  // 1. Notes (Clean matching items directly)
  if (matchedNotes.length > 0) {
    matchedNotes.slice(0, 8).forEach(({ note: n, cleanBody }) => {
      const parentProj = projects.find(p => p.id === n.projectId);
      const projLabel = parentProj ? parentProj.title : 'Notes';
      const snippet = cleanBody.slice(0, 75);
      const icon = n.icon || '📄';
      html += `
        <div class="search-result-item" data-search-type="note" data-note-id="${n.id}">
          <div class="search-result-icon note" style="font-size:15px;display:flex;align-items:center;justify-content:center;">
            ${escapeHtml(icon)}
          </div>
          <div class="search-result-content">
            <div class="search-result-title">${escapeHtml(n.title || 'Untitled Note')}</div>
            <div class="search-result-subtitle">${escapeHtml(snippet || 'Click to open note in editor')}</div>
          </div>
          <span class="search-result-tag">${escapeHtml(projLabel)}</span>
        </div>
      `;
    });
  }

  // 2. Tasks
  if (matchedTodos.length > 0) {
    matchedTodos.slice(0, 6).forEach(({ todo: t }) => {
      html += `
        <div class="search-result-item" data-search-type="todo" data-todo-id="${t.id}">
          <div class="search-result-icon todo">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">${escapeHtml(t.text)}</div>
            <div class="search-result-subtitle">${t.done ? 'Completed' : 'Pending'} &middot; ${escapeHtml(t.date || 'Today')}</div>
          </div>
          <span class="search-result-tag">Task</span>
        </div>
      `;
    });
  }

  // 3. Roadmaps
  if (matchedGoals.length > 0) {
    matchedGoals.slice(0, 6).forEach(({ goal: g }) => {
      html += `
        <div class="search-result-item" data-search-type="goal" data-goal-id="${g.id}">
          <div class="search-result-icon goal">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">${escapeHtml(g.title)}</div>
            <div class="search-result-subtitle">${escapeHtml(g.summary || 'Roadmap plan')}</div>
          </div>
          <span class="search-result-tag">${g.progress || 0}%</span>
        </div>
      `;
    });
  }

  // 4. Events
  if (matchedEvents.length > 0) {
    matchedEvents.slice(0, 6).forEach(({ event: e }) => {
      html += `
        <div class="search-result-item" data-search-type="event" data-event-id="${e.id}">
          <div class="search-result-icon event">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          </div>
          <div class="search-result-content">
            <div class="search-result-title">${escapeHtml(e.title)}</div>
            <div class="search-result-subtitle">${escapeHtml(e.time || '')} &middot; ${escapeHtml(e.date || '')}</div>
          </div>
          <span class="search-result-tag">${escapeHtml(e.tag || 'Calendar')}</span>
        </div>
      `;
    });
  }

  dropdown.innerHTML = html;
  dropdown.style.display = 'flex';

  // Attach click handlers
  dropdown.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = item.dataset.searchType;
      if (type === 'nav') {
        const targetView = item.dataset.navTarget;
        if (targetView) showView(targetView);
      } else if (type === 'note') {
        const noteId = item.dataset.noteId;
        const note = allNotes.find(n => n.id === noteId);
        if (note) {
          showView('notes');
          openNotionEditor(note, note.projectId, note.projectId ? 'folder' : 'main');
        }
      } else if (type === 'todo') {
        showView('todo');
      } else if (type === 'goal') {
        showView('goals');
      } else if (type === 'event') {
        showView('calendar');
      }
      closeSearchDropdown();
    });
  });
}

function closeSearchDropdown() {
  const dropdown = document.getElementById('searchDropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
  const input = document.getElementById('globalSearchInput');
  if (input) input.value = '';
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';
}

/* ---------------- Global Modal Controls ---------------- */
window.openNoteModal = function() {
  const modal = document.getElementById('noteModal');
  if (modal) modal.style.display = 'flex';
};
window.closeNoteModal = function() {
  const modal = document.getElementById('noteModal');
  if (modal) modal.style.display = 'none';
};

/* ---------------- Init & Event Binding ---------------- */
function initApp() {
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => showView(item.dataset.view));
  });

  const ctaBtn = document.getElementById('ctaBtn');
  if (ctaBtn) ctaBtn.addEventListener('click', () => showView('goals'));

  const searchInput = document.getElementById('globalSearchInput') || document.querySelector('.search-wrap input');
  const searchClearBtn = document.getElementById('searchClearBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      performGlobalSearch(e.target.value);
    });
    searchInput.addEventListener('focus', (e) => {
      if (e.target.value.trim()) {
        performGlobalSearch(e.target.value);
      }
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSearchDropdown();
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSearchDropdown();
      if (searchInput) searchInput.focus();
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) {
      const dropdown = document.getElementById('searchDropdown');
      if (dropdown) dropdown.style.display = 'none';
    }
  });

  const timerStartBtn = document.getElementById('timerStart');
  if (timerStartBtn) timerStartBtn.addEventListener('click', startTimer);

  const timerResetBtn = document.getElementById('timerReset');
  if (timerResetBtn) timerResetBtn.addEventListener('click', resetTimer);

  const modeTimerBtn = document.getElementById('modeTimerBtn');
  if (modeTimerBtn) modeTimerBtn.addEventListener('click', () => setMode('timer'));

  const modePomodoroBtn = document.getElementById('modePomodoroBtn');
  if (modePomodoroBtn) modePomodoroBtn.addEventListener('click', () => setMode('pomodoro'));

  bindTrackerToolbar();

  renderTodos();
  renderHabitGrid();
  renderRoadmaps();
  renderEvents();
  renderProjects();
  renderNotes();
  renderBars();
  renderMiniCalendar();
  updateTimerDisplay();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

