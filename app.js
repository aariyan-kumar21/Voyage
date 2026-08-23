/* ================================================
   Voyage — Personal Productivity
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

window.switchAuthTab = function(tab) {
  document.getElementById('form-login').classList.toggle('active', tab === 'login');
  document.getElementById('form-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  const note = document.getElementById('auth-switch-note');
  if (note) {
    note.innerHTML = tab === 'login'
      ? `Don't have an account? <a href="#" onclick="switchAuthTab('signup');return false;">Sign Up</a>`
      : `Already have an account? <a href="#" onclick="switchAuthTab('login');return false;">Log In</a>`;
  }
  document.getElementById(tab === 'login' ? 'login-error' : 'signup-error').textContent = '';
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
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Please fill in all fields.'; return; }
  setAuthLoading('login', true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Login failed.'; return; }
    await onAuthSuccess(data);
  } catch(e) {
    errEl.textContent = 'Network error. Please try again.';
  } finally {
    setAuthLoading('login', false);
  }
};

window.handleSignup = async function() {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl = document.getElementById('signup-error');
  errEl.textContent = '';
  if (!name || !email || !password) { errEl.textContent = 'Please fill in all fields.'; return; }
  setAuthLoading('signup', true);
  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Sign up failed.'; return; }
    await onAuthSuccess(data);
  } catch(e) {
    errEl.textContent = 'Network error. Please try again.';
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
  // Personalize greeting
  const hour = new Date().getHours();
  const greeting = (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') + ', ' + name;
  const greetEl = document.getElementById('greeting');
  if (greetEl) greetEl.textContent = greeting;
  // Update sidebar
  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl) nameEl.textContent = name;
  const avatarEl = document.getElementById('avatarInitial');
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
}

async function loadCloudData(userId) {
  try {
    const res = await fetch(`/api/user/data?userId=${userId}`);
    if (!res.ok) return;
    const { data } = await res.json();
    if (!data) return;
    // Hydrate localStorage with cloud data (cloud wins)
    const keys = ['todos','notes','events','goals','roadmaps','streak','todoHistory','habitGrid'];
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
    const res = await fetch('/api/user/data', {
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
    lbl.textContent = 'Syncing…';
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
   BOOT: check session → load cloud data or show auth
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

/* ---------------- Storage defaults (empty initial state for new accounts) ---------------- */
if (load('todos', null) === null) save('todos', []);
if (load('goals', null) === null) save('goals', []);
if (load('events', null) === null) save('events', []);
if (load('notes', null) === null) save('notes', []);
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
const hour = new Date().getHours();
const greetText = currentUser
  ? (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') + ', ' + currentUser.name
  : (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') + ', Voyager';
const greetingText = greetText;
document.getElementById('greeting').textContent = greetingText;
document.getElementById('todayDate').textContent = new Date().toLocaleDateString(undefined, { day:'numeric', month:'long', year:'numeric' });

/* ---------------- Streak ---------------- */
document.getElementById('streakCount').textContent = load('streak', 0);
// real value gets computed and set once computeStreak() is defined further down, via updateStreakDisplay() in the init block

/* ---------------- Generic "add" wiring helper ---------------- */
function wireAdd(btnId, inputId, handler){
  const btn = document.getElementById(btnId), input = document.getElementById(inputId);
  if (!btn || !input) return;
  const go = () => { if (!input.value.trim()) return; handler(input.value.trim()); input.value=''; };
  btn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key==='Enter') go(); });
}

/* ---------------- TODOS (dashboard = always Today, page = browsable by day) ---------------- */
let pageTodoDate = todayISO();

function addTodo(text){
  const items = load('todos', []);
  items.push({ id: uid(), text, done:false, date: todayISO() });
  save('todos', items);
  renderTodos();
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
    row.innerHTML = `<input type="checkbox" class="chk" style="--c:var(--blue);" ${t.done?'checked':''}><label>${escapeHtml(t.text)}</label>`;
    row.querySelector('input').addEventListener('change', e => {
      const arr = load('todos', []);
      const item = arr.find(x => x.id === t.id);
      item.done = e.target.checked;
      save('todos', arr);
      const hist = load('todoHistory', {});
      const key = t.date || todayKey;
      hist[key] = Math.max(0, (hist[key]||0) + (e.target.checked ? 1 : -1));
      save('todoHistory', hist);
      renderTodos();
      renderBars();
    });
    list.appendChild(row);
  });
}

function renderTodos(){
  const todos = load('todos', []);
  const todayKey = todayISO();

  const todosToday = todos.filter(t => (t.date || todayKey) === todayKey);
  renderTodoRows('todoList', todosToday, todayKey);

  const todosSelected = todos.filter(t => (t.date || todayKey) === pageTodoDate);
  renderTodoRows('pageTodoList', todosSelected, todayKey);

  // dashboard stats always reflect Today, regardless of which day the page is browsing
  const total = todosToday.length;
  const done = todosToday.filter(t=>t.done).length;
  const doneEl = document.getElementById('todoDone'); if (doneEl) doneEl.textContent = done;
  const totalLbl = document.getElementById('todoTotalLbl'); if (totalLbl) totalLbl.textContent = `of ${total} tasks`;
  const badge = document.getElementById('todoBadge'); if (badge) badge.textContent = total - done;
  const ring = document.getElementById('todoRing');
  if (ring){
    const circumference = 314;
    const pct = total ? done/total : 0;
    ring.style.strokeDashoffset = circumference - (circumference*pct);
  }
  const metricTasks = document.getElementById('metricTasks');
  if (metricTasks) metricTasks.innerHTML = `${done}<span class="u">tasks</span>`;

  updateTodoDayLabel();
  updateStreakDisplay();
}
wireAdd('todoAddBtn','todoInput', addTodo);
wireAdd('pageTodoAddBtn','pageTodoInput', addTodo);

function updateTodoDayLabel(){
  const label = document.getElementById('todoDayLabel');
  if (!label) return;
  const isToday = pageTodoDate === todayISO();
  const d = new Date(pageTodoDate + 'T00:00:00');
  label.textContent = isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short', year: d.getFullYear()!==new Date().getFullYear() ? 'numeric' : undefined });
  const nextBtn = document.getElementById('todoNextDay');
  if (nextBtn) nextBtn.disabled = isToday;
  const addRow = document.getElementById('pageTodoAddRow');
  const note = document.getElementById('pageTodoHistoryNote');
  if (addRow) addRow.style.display = isToday ? 'flex' : 'none';
  if (note) note.style.display = isToday ? 'none' : 'block';
}
function shiftTodoDay(delta){
  const d = new Date(pageTodoDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const next = d.toISOString().slice(0,10);
  if (next > todayISO()) return; // no browsing into the future
  pageTodoDate = next;
  renderTodos();
}
const todoPrevBtn = document.getElementById('todoPrevDay');
const todoNextBtn = document.getElementById('todoNextDay');
const todoTodayBtn = document.getElementById('todoTodayBtn');
if (todoPrevBtn) todoPrevBtn.addEventListener('click', () => shiftTodoDay(-1));
if (todoNextBtn) todoNextBtn.addEventListener('click', () => shiftTodoDay(1));
if (todoTodayBtn) todoTodayBtn.addEventListener('click', () => { pageTodoDate = todayISO(); renderTodos(); });

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
wireClearDay('pageTodoClearBtn', () => pageTodoDate);

// keep everything correct if the tab is left open across midnight
let watchedDay = todayISO();
setInterval(() => {
  const now = todayISO();
  if (now !== watchedDay){
    if (pageTodoDate === watchedDay) pageTodoDate = now;
    watchedDay = now;
    renderTodos();
    renderBars();
  }
}, 60000);

/* ---------------- HABIT TRACKER GRID (monthly table — linked across Dashboard + Habit Tracker page) ---------------- */
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
    list.innerHTML = `<div class="event-empty">No habits yet — add one on the Habit Tracker page.</div>`;
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
    bars += `<text x="${x+barW/2}" y="${padTop+chartH+18}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="${isToday ? '#ffcf7d' : 'rgba(255,255,255,0.35)'}">${d}</text>`;
  }

  wrap.innerHTML = `
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
    <defs>
      <linearGradient id="gradPast" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--violet)"/>
        <stop offset="100%" stop-color="var(--blue)"/>
      </linearGradient>
      <linearGradient id="gradToday" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffcf7d"/>
        <stop offset="100%" stop-color="var(--amber)"/>
      </linearGradient>
      <linearGradient id="gradFuture" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3a4256"/>
        <stop offset="100%" stop-color="#232a3a"/>
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

const GOALS_SYSTEM_INSTRUCTION = "You are a goal-planning coach inside a personal productivity app called Voyage. Your job is to help the person turn a vague goal into a concrete, realistic roadmap. Ask focused questions one or two at a time (not a huge list at once) to learn: what the goal actually is, their target timeframe, their current starting point/experience level, and any real constraints (time available per week, obstacles). Keep your tone encouraging and concise — this is a chat UI, not an essay. Once you have enough to propose a genuinely useful roadmap (usually after 3-5 exchanges), set roadmapReady to true and fill in the roadmap field with 4-8 concrete, sequential milestones with realistic timeframes. Keep asking questions (roadmapReady: false, roadmap: null) until you actually have enough information — don't rush to generate a generic roadmap from a one-line goal.";

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

async function sendGoalMessage() {
  const input = document.getElementById('goalChatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  appendChatMsg('user', text);
  goalConversation.push({ role: 'user', text });

  setGoalChatLoading(true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: goalConversation,
        systemInstruction: GOALS_SYSTEM_INSTRUCTION,
        responseSchema: GOALS_RESPONSE_SCHEMA
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    let parsed;
    try { parsed = JSON.parse(data.text); } catch(e) {
      throw new Error('Could not parse AI response.');
    }

    const { reply, roadmap } = parsed;

    appendChatMsg('assistant', reply);
    goalConversation.push({ role: 'model', text: reply });

    if (roadmap && roadmap.goalTitle && roadmap.milestones && roadmap.milestones.length) {
      const roadmaps = load('roadmaps', []);
      roadmaps.push(roadmap);
      save('roadmaps', roadmaps);
      renderRoadmaps();
      if (window._renderDashboardGoals) window._renderDashboardGoals();
      appendChatMsg('assistant', 'Roadmap added above \u2191');
    }

  } catch(err) {
    appendChatMsg('assistant', "Gemini's a bit busy \u2014 try again in a moment.");
    console.error('[GoalChat]', err);
  } finally {
    setGoalChatLoading(false);
  }
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
      list.innerHTML = `<div class="event-empty">No upcoming events${compact ? '' : ' yet — add one below'}.</div>`;
      if (compact){
        const link = document.createElement('span');
        link.className = 'event-view-all';
        link.textContent = 'Add one on the Calendar page →';
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

    // nearest upcoming first (highlighted), past events pushed below a divider — same design everywhere
    const upcoming = events.filter(ev => new Date(ev.date+'T00:00:00') >= todayStart);
    const past = events.filter(ev => new Date(ev.date+'T00:00:00') < todayStart).sort((a,b)=> new Date(b.date) - new Date(a.date));

    if (!upcoming.length){
      list.innerHTML += `<div class="event-empty">No upcoming events${compact ? '' : ' — add one below'}.</div>`;
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
      link.textContent = 'Manage on Calendar →';
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

/* ---------------- NOTES ---------------- */
const NOTE_TAGS = [
  { label: 'Idea',     color: 'var(--violet)' },
  { label: 'Task',     color: 'var(--blue)' },
  { label: 'Reminder', color: 'var(--amber)' },
  { label: 'Journal',  color: 'var(--green)' },
];
function addNote(text){
  const items = load('notes', []);
  const tag = NOTE_TAGS[items.length % NOTE_TAGS.length];
  items.unshift({ id: uid(), text, tagLabel: tag.label, tagColor: tag.color });
  save('notes', items);
  renderNotes();
}
function renderNotes(){
  const notes = load('notes', []);
  document.querySelectorAll('.js-note-list').forEach(list => {
    list.innerHTML = '';
    list.appendChild(buildAddNoteTile());
    if (!notes.length){
      const empty = document.createElement('div');
      empty.className = 'event-empty';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = 'No notes yet — tap the card to add one.';
      list.appendChild(empty);
      return;
    }
    notes.forEach((n, i) => {
      const tag = n.tagLabel ? { label: n.tagLabel, color: n.tagColor } : NOTE_TAGS[i % NOTE_TAGS.length];
      const words = n.text.split(' ');
      const heading = words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
      const body = words.length > 6 ? words.slice(6).join(' ') : 'Tap to keep this in view.';
      const el = document.createElement('div');
      el.className = 'note-card';
      el.innerHTML = `
        <span class="note-pill"><span class="dot" style="background:${tag.color};"></span>${tag.label}</span>
        <h5>${escapeHtml(heading)}</h5>
        <p>${escapeHtml(body)}</p>
        <button class="rm" data-rm="${n.id}" title="Remove">&times;</button>
      `;
      el.querySelector('.rm').addEventListener('click', () => {
        const arr = load('notes', []).filter(x => x.id !== n.id);
        save('notes', arr);
        renderNotes();
      });
      list.appendChild(el);
    });
  });
}
function buildAddNoteTile(){
  const tile = document.createElement('div');
  tile.className = 'note-card note-add-tile';
  tile.innerHTML = `<span class="add-icon">+</span><span class="add-label">Add note</span>`;

  const openEditor = () => {
    tile.classList.add('editing');
    tile.innerHTML = `
      <textarea class="note-add-input" rows="3" placeholder="Jot something down..."></textarea>
      <button class="note-add-confirm">Add note</button>
    `;
    const input = tile.querySelector('.note-add-input');
    input.focus();
    const commit = () => {
      const val = input.value.trim();
      if (val) addNote(val); else renderNotes();
    };
    tile.querySelector('.note-add-confirm').addEventListener('click', (e) => { e.stopPropagation(); commit(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); commit(); }
      if (e.key === 'Escape') renderNotes();
    });
    input.addEventListener('click', e => e.stopPropagation());
  };
  tile.addEventListener('click', () => { if (!tile.classList.contains('editing')) openEditor(); });
  return tile;
}

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
    const color1 = i === todayIdx ? 'var(--amber)' : (isFuture ? 'rgba(255,157,61,0.18)' : 'var(--amber)');
    const color2 = i === todayIdx ? 'linear-gradient(180deg, #ffcf7d, var(--violet))' : (isFuture ? 'rgba(255,255,255,0.06)' : 'linear-gradient(180deg, var(--violet), var(--blue))');
    col.title = `${label}: ${taskVals[i]} task${taskVals[i]===1?'':'s'}, ${habitVals[i]} habit${habitVals[i]===1?'':'s'}`;
    const op1 = isFuture ? 0.4 : (taskVals[i] > 0 ? 1 : 0.2);
    const op2 = isFuture ? 0.4 : (habitVals[i] > 0 ? 1 : 0.2);
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

  const label = document.getElementById('flipPhaseLabel');
  if (label){
    label.textContent = timerMode === 'pomodoro' ? (pomodoroPhase === 'work' ? 'FOCUS' : 'BREAK') : 'TIMER';
  }
}
function stopTimerInterval(){
  clearInterval(timerInterval);
  timerInterval = null;
  const btn = document.getElementById('timerStart');
  if (btn) btn.textContent = 'Start';
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

const timerStartBtn = document.getElementById('timerStart');
if (timerStartBtn){
  timerStartBtn.addEventListener('click', () => {
    if (timerInterval){
      stopTimerInterval();
      document.getElementById('timerState').textContent = 'Paused';
      return;
    }
    timerStartBtn.textContent = 'Pause';
    document.getElementById('timerState').textContent = timerMode === 'pomodoro'
      ? (pomodoroPhase === 'work' ? 'Focusing...' : 'On a break...')
      : 'Counting up...';
    timerInterval = setInterval(() => {
      if (timerMode === 'timer'){
        timerSeconds++;
        updateTimerDisplay();
        return;
      }
      timerSeconds--;
      if (timerSeconds <= 0){
        pomodoroPhase = pomodoroPhase === 'work' ? 'break' : 'work';
        timerSeconds = secondsForCurrentMode();
        updateTimerDisplay();
        document.getElementById('timerState').textContent = pomodoroPhase === 'work' ? 'Focusing...' : 'On a break...';
        updateStreakDisplay();
        return;
      }
      updateTimerDisplay();
    }, 1000);
  });
  document.getElementById('timerReset').addEventListener('click', resetTimer);
  document.getElementById('modeTimerBtn').addEventListener('click', () => setMode('timer'));
  document.getElementById('modePomodoroBtn').addEventListener('click', () => setMode('pomodoro'));
}

/* ---------------- View routing (sidebar navigation) ---------------- */
const pageMeta = {
  notes:    { title: 'Notes',         sub: 'Capture ideas before they slip away.' },
  habits:   { title: 'Habit Tracker', sub: 'Stay consistent, one day at a time.' },
  timer:    { title: 'Focus Timer',   sub: 'Deep work, tracked automatically.' },
  todo:     { title: 'To-Do',         sub: 'Everything on your plate today.' },
  goals:    { title: 'Goals',         sub: 'Chart your long-term course.' },
  calendar: { title: 'Calendar',      sub: 'Plan ahead and never miss a date.' },
};
function showView(view){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + view);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navItem) navItem.classList.add('active');

  const h1 = document.getElementById('greeting');
  const sub = h1 ? h1.nextElementSibling : null;
  if (view === 'dashboard'){
    if (h1) h1.textContent = greetingText;
    if (sub) sub.textContent = 'Take control of your day.';
  } else if (pageMeta[view]){
    if (h1) h1.textContent = pageMeta[view].title;
    if (sub) sub.textContent = pageMeta[view].sub;
  }

  if (view === 'habits') renderHabitGrid();
  if (view === 'calendar') renderMiniCalendar();
}
document.querySelectorAll('.nav-item[data-view]').forEach(item => {
  item.addEventListener('click', () => showView(item.dataset.view));
});
const ctaBtn = document.getElementById('ctaBtn');
if (ctaBtn) ctaBtn.addEventListener('click', () => {
  showView('goals');
});

/* ---------------- Init ---------------- */
renderTodos();
renderHabitGrid();
renderRoadmaps();
renderEvents();
renderNotes();
renderBars();
renderMiniCalendar();
updateTimerDisplay();
