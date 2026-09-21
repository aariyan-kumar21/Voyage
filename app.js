/* ================================================
   Voyage - Personal Productivity
   app.js
   ================================================ */

/* ---------------- Storage helpers & Multi-User Isolation ---------------- */
let memoryStore = {};
let storageOK = true;
try { localStorage.setItem('voyage__test__','1'); localStorage.removeItem('voyage__test__'); } catch(e){ storageOK = false; }

let currentUser = null; // { userId, name, email }

function getStorageKey(k) {
  if (currentUser && currentUser.userId) {
    return `voyage_user_${currentUser.userId}:${k}`;
  }
  return `voyage:${k}`;
}

const load = (k, fallback) => {
  try {
    const fullKey = getStorageKey(k);
    if (!storageOK) return (fullKey in memoryStore) ? JSON.parse(JSON.stringify(memoryStore[fullKey])) : fallback;
    const v = localStorage.getItem(fullKey);
    return v !== null ? JSON.parse(v) : fallback;
  } catch(e){ return fallback; }
};

const save = (k, v) => {
  try {
    const fullKey = getStorageKey(k);
    if (!storageOK) { memoryStore[fullKey] = v; return; }
    localStorage.setItem(fullKey, JSON.stringify(v));
  } catch(e){ memoryStore[fullKey] = v; storageOK = false; }
  // Trigger debounced cloud sync after every local save
  scheduleCloudSync();
};

const uid = () => Math.random().toString(36).slice(2,9);
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function sanitizeHtml(dirtyHtml) {
  if (!dirtyHtml) return '';
  if (typeof DOMPurify !== 'undefined' && typeof DOMPurify.sanitize === 'function') {
    return DOMPurify.sanitize(String(dirtyHtml), {
      ALLOWED_TAGS: [
        'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr',
        'div', 'span', 'a'
      ],
      ALLOWED_ATTR: [
        'class', 'style', 'id', 'href', 'target', 'rel', 'title', 'data-checked', 'data-todo-id'
      ],
      ALLOW_DATA_ATTR: true
    });
  }
  return String(dirtyHtml)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi, '');
}
function nextDate(days){
  const d = new Date(); d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}
function todayISO(){ return new Date().toISOString().slice(0,10); }

/* ============================================================
   AUTH & SESSION MANAGEMENT
   ============================================================ */

/* Clear legacy plaintext users store if present */
try { localStorage.removeItem('voyage_users'); } catch(e) {}

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
  if (overlay) {
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      overlay.classList.remove('auth-hidden');
    });
  }
}
function hideAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) {
    overlay.classList.add('auth-hidden');
    setTimeout(() => {
      if (overlay.classList.contains('auth-hidden')) {
        overlay.style.display = 'none';
      }
    }, 360);
  }
}

/* Smart API fetch helper with 5s timeout protection & automatic cookie credentials */
async function apiFetch(path, options = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 5000) : null;
  try {
    const fetchOpts = {
      credentials: 'same-origin',
      ...options,
      signal: controller ? controller.signal : undefined
    };
    const res = await fetch(path, fetchOpts);
    if (timeoutId) clearTimeout(timeoutId);
    return res;
  } catch(e) {
    if (timeoutId) clearTimeout(timeoutId);
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
  const textEl = btn.querySelector('.auth-btn-text');
  const spinEl = btn.querySelector('.auth-spinner');
  if (textEl) textEl.style.display = loading ? 'none' : '';
  if (spinEl) spinEl.style.display = loading ? 'block' : 'none';
}

function renderAllViews() {
  if (typeof renderTodos === 'function') renderTodos();
  if (typeof renderNotes === 'function') renderNotes();
  if (typeof renderProjects === 'function') renderProjects();
  if (typeof renderEvents === 'function') renderEvents();
  if (typeof renderMiniCalendar === 'function') renderMiniCalendar();
  if (typeof renderRoadmaps === 'function') renderRoadmaps();
  if (typeof renderHabitGrid === 'function') renderHabitGrid();
  if (typeof renderBars === 'function') renderBars();
  if (typeof updateStreakDisplay === 'function') updateStreakDisplay();
  if (typeof updateWeeklyHabitMetric === 'function') updateWeeklyHabitMetric();
  if (window._renderDashboardGoals) window._renderDashboardGoals();
}

window.handleLogin = async function() {
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-password');
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value : '';
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.textContent = '';

  if (!email || !password) {
    if (errEl) errEl.textContent = 'Please fill in all fields.';
    return;
  }

  setAuthLoading('login', true);
  const cleanEmail = email.toLowerCase().trim();

  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });
    let data = null;
    try { data = await res.json(); } catch(e) {}

    if (res && res.ok && data && data.userId) {
      const loggedInUser = {
        userId: data.userId,
        name: data.name || cleanEmail.split('@')[0],
        email: cleanEmail
      };
      if (emailInput) emailInput.value = '';
      if (passInput) passInput.value = '';
      setAuthLoading('login', false);
      await onAuthSuccess(loggedInUser);
      return;
    }

    if (res && (res.status === 401 || res.status === 400)) {
      if (errEl) errEl.textContent = data?.error || 'Invalid email or password.';
    } else {
      if (errEl) errEl.textContent = data?.error || 'Could not log in. Please check your credentials or network connection.';
    }
  } catch(e) {
    console.error('[Voyage Auth] Login network/server error:', e);
    if (errEl) errEl.textContent = 'Unable to reach the server. Please check your network connection and try again.';
  } finally {
    setAuthLoading('login', false);
    if (passInput) passInput.value = '';
  }
};

window.handleSignup = async function() {
  const nameInput = document.getElementById('signup-name');
  const emailInput = document.getElementById('signup-email');
  const passInput = document.getElementById('signup-password');
  const name = nameInput ? nameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value : '';
  const errEl = document.getElementById('signup-error');
  if (errEl) errEl.textContent = '';

  if (!name || !email || !password) {
    if (errEl) errEl.textContent = 'Please fill in all fields.';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (errEl) errEl.textContent = 'Please enter a valid email address.';
    return;
  }
  if (password.length < 6) {
    if (errEl) errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }

  setAuthLoading('signup', true);
  const cleanEmail = email.toLowerCase().trim();

  try {
    const res = await apiFetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email: cleanEmail, password })
    });
    let data = null;
    try { data = await res.json(); } catch(e) {}

    if (res && res.ok && data && data.userId) {
      const signedUpUser = {
        userId: data.userId,
        name: data.name || name,
        email: cleanEmail
      };
      if (nameInput) nameInput.value = '';
      if (emailInput) emailInput.value = '';
      if (passInput) passInput.value = '';
      setAuthLoading('signup', false);
      await onAuthSuccess(signedUpUser);
      return;
    }

    if (res && (res.status === 409 || res.status === 400)) {
      if (errEl) errEl.textContent = data?.error || 'An account with this email already exists.';
    } else {
      if (errEl) errEl.textContent = data?.error || 'Could not complete registration. Please try again.';
    }
  } catch(e) {
    console.error('[Voyage Auth] Signup network/server error:', e);
    if (errEl) errEl.textContent = 'Unable to reach the server. Please check your network connection and try again.';
  } finally {
    setAuthLoading('signup', false);
    if (passInput) passInput.value = '';
  }
};

async function onAuthSuccess(user) {
  currentUser = user;
  saveSession(user);
  ensureUserDefaults();
  updateUserUI(user.name);
  hideAuthOverlay();
  try {
    await loadCloudData(user.userId);
  } catch(e) {
    console.warn('[Voyage] Cloud load notice:', e);
  }
  renderAllViews();
}

function updateUserUI(name) {
  // Update sidebar
  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl) nameEl.textContent = name;
  const avatarEl = document.getElementById('avatarInitial');
  if (avatarEl) avatarEl.textContent = (name || 'U').charAt(0).toUpperCase();

  // Personalize greeting if on dashboard
  const activeView = document.querySelector('.nav-item.active')?.dataset.view || 'dashboard';
  if (activeView === 'dashboard') {
    const greetEl = document.getElementById('greeting');
    if (greetEl) greetEl.textContent = getGreeting();
  }
}

async function loadCloudData(userId) {
  if (!userId) return;
  try {
    const res = await apiFetch(`/api/user/data?userId=${userId}`);
    if (!res || !res.ok) return;
    const { data } = await res.json();
    if (!data) return;
    const userPrefix = `voyage_user_${userId}:`;
    const keys = ['todos','notes','projects','events','goals','roadmaps','streak','todoHistory','habitGrid'];
    keys.forEach(k => {
      if (data[k] !== undefined && data[k] !== null) {
        try {
          if (storageOK) localStorage.setItem(userPrefix + k, JSON.stringify(data[k]));
          else memoryStore[userPrefix + k] = data[k];
        } catch(e){}
      }
    });
    // Also restore any roadmap_checks_* keys
    Object.keys(data).filter(k => k.startsWith('roadmap_checks_')).forEach(k => {
      try {
        if (storageOK) localStorage.setItem(userPrefix + k, JSON.stringify(data[k]));
        else memoryStore[userPrefix + k] = data[k];
      } catch(e){}
    });
  } catch(e) {
    console.warn('[Voyage] Cloud load notice:', e);
  }
}

/* ---- Cloud sync (debounced) ---- */
let _syncTimer = null;
const SYNC_DELAY_MS = 1500;

function scheduleCloudSync() {
  if (!currentUser || !currentUser.userId) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(pushCloudData, SYNC_DELAY_MS);
  showSyncState('syncing');
}

async function pushCloudData() {
  if (!currentUser || !currentUser.userId) return;
  const userPrefix = `voyage_user_${currentUser.userId}:`;
  const data = {};
  try {
    if (storageOK) {
      for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i);
        if (fullKey && fullKey.startsWith(userPrefix)) {
          const shortKey = fullKey.slice(userPrefix.length);
          try { data[shortKey] = JSON.parse(localStorage.getItem(fullKey)); } catch(e){}
        }
      }
    } else {
      Object.entries(memoryStore).forEach(([k, v]) => {
        if (k.startsWith(userPrefix)) {
          data[k.slice(userPrefix.length)] = v;
        }
      });
    }
  } catch(e){}

  try {
    const res = await apiFetch('/api/user/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.userId, data })
    });
    if (res && res.ok) {
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
    // Silently fail background sync so it doesn't distract the user
    el.classList.remove('visible');
  }
}

/* ---- Logout ---- */
async function handleLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch(e) {}

  currentUser = null;
  clearSession();
  memoryStore = {};

  const loginEmail = document.getElementById('login-email');
  const loginPass = document.getElementById('login-password');
  const signupName = document.getElementById('signup-name');
  const signupEmail = document.getElementById('signup-email');
  const signupPass = document.getElementById('signup-password');
  if (loginEmail) loginEmail.value = '';
  if (loginPass) loginPass.value = '';
  if (signupName) signupName.value = '';
  if (signupEmail) signupEmail.value = '';
  if (signupPass) signupPass.value = '';

  const errLogin = document.getElementById('login-error');
  const errSignup = document.getElementById('signup-error');
  if (errLogin) errLogin.textContent = '';
  if (errSignup) errSignup.textContent = '';

  switchAuthTab('login');
  showAuthOverlay();
  renderAllViews();
}

/* ---------------- Storage defaults (clean empty state for all users) ---------------- */
const DEFAULT_PROJECTS = [];
const DEFAULT_NOTES = [];

function rolloverCalendarMonth() {
  if (!currentUser) return;
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const storedMonthKey = load('calendarMonthKey', null);

  if (storedMonthKey && storedMonthKey !== currentMonthKey) {
    // New month arrived (1st of the month): refresh and remove past month events
    const events = load('events', []);
    const activeEvents = events.filter(ev => {
      if (!ev || !ev.date) return false;
      const evMonthKey = String(ev.date).slice(0, 7);
      return evMonthKey >= currentMonthKey;
    });
    save('events', activeEvents);
  }
  save('calendarMonthKey', currentMonthKey);
}

function ensureUserDefaults() {
  if (!currentUser) return;
  if (load('todos', null) === null) save('todos', []);
  if (load('goals', null) === null) save('goals', []);
  if (load('events', null) === null) save('events', []);
  if (load('roadmaps', null) === null) save('roadmaps', []);
  if (load('projects', null) === null) save('projects', []);
  if (load('notes', null) === null) save('notes', []);
  if (load('streak', null) === null) save('streak', 0);

  // Clean out any legacy template dummy data (API'S, LAPTOP, PHONE, SIH, Project idea)
  const legacyNoteIds = new Set(['n1', 'n2', 'n3']);
  const currentNotes = load('notes', []);
  if (Array.isArray(currentNotes) && currentNotes.some(n => legacyNoteIds.has(n.id))) {
    const cleanedNotes = currentNotes.filter(n => !legacyNoteIds.has(n.id));
    save('notes', cleanedNotes);
  }

  const legacyProjIds = new Set(['p1', 'p2']);
  const currentProjects = load('projects', []);
  if (Array.isArray(currentProjects) && currentProjects.some(p => legacyProjIds.has(p.id))) {
    const cleanedProjects = currentProjects.filter(p => !legacyProjIds.has(p.id));
    save('projects', cleanedProjects);
  }

  rolloverCalendarMonth();

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
}

/* ============================================================
   BOOT: Authenticated session check via httpOnly cookie
   ============================================================ */
(async function boot() {
  const cachedSession = getSession();
  if (cachedSession && cachedSession.userId) {
    currentUser = cachedSession;
    ensureUserDefaults();
    updateUserUI(cachedSession.name);
    hideAuthOverlay();
    renderAllViews();
  }

  try {
    const res = await apiFetch('/api/auth/me');
    if (res && res.ok) {
      const data = await res.json();
      if (data && data.authenticated && data.user) {
        currentUser = data.user;
        saveSession(data.user);
        ensureUserDefaults();
        updateUserUI(data.user.name);
        hideAuthOverlay();
        await loadCloudData(data.user.userId);
        renderAllViews();
        return;
      }
    }
    if (res && res.status === 401) {
      currentUser = null;
      clearSession();
      showAuthOverlay();
      return;
    }
  } catch (e) {
    console.warn('[Voyage Auth] Server check notice:', e);
    if (cachedSession && cachedSession.userId) {
      return;
    }
  }

  if (!currentUser) {
    showAuthOverlay();
  }
})();

/* ---------------- Wire logout button ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
});

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

/* ---------------- SPRING CHECK (React Bits) ---------------- */
const SC_VISUAL_DURATION = 0.2;
const SC_RULE_END = 0.84;
const SC_SWELL = 0.35;
const SC_TICK_PATH = 'M4 12.6111L8.92308 17.5L20 6.5';
const SC_ORIGIN = { left: 'left center', center: 'center', right: 'right center', none: 'left center' };

const scClamp01 = value => Math.min(1, Math.max(0, value));
const scZetaOf = bounce => (bounce <= 0 ? 1 : -Math.log(bounce) / Math.sqrt(Math.PI ** 2 + Math.log(bounce) ** 2));

function scReadings(t, doneOpacity = 0.42, strikeLag = 0.12) {
  const held = scClamp01(t);
  return {
    fill: `scale(${Math.max(t, 0)})`,
    box: `scale(${1 + SC_SWELL * Math.max(0, t - 1)})`,
    tick: 1 - held,
    word: 1 - (1 - doneOpacity) * held,
    rule: `scaleX(${scClamp01((held - strikeLag) / (SC_RULE_END - strikeLag))})`
  };
}

function createSpringCheck({
  label = 'Ship the build',
  checked = false,
  onChange,
  disabled = false,
  color = 'var(--mauve)',
  fillColor = 'var(--mauve)',
  checkColor = '#09080c',
  boxSize = 23,
  boxRadius = 7,
  fontSize = 15.5,
  bounce = 0.2,
  strikeLag = 0.12,
  doneOpacity = 0.42,
  strike = 'left',
  ariaLabel,
  className = ''
}) {
  let isChecked = !!checked;
  let currentT = isChecked ? 1 : 0;
  let cancelAnimation = null;
  let viaPointer = false;

  const button = document.createElement('button');
  button.type = 'button';
  button.role = 'checkbox';
  button.setAttribute('aria-checked', isChecked ? 'true' : 'false');
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  if (disabled) button.disabled = true;

  button.className = `spring-check${className ? ` ${className}` : ''}`;
  const ring = boxSize >= 24 ? 2 : 1.5;
  const gap = Math.min(16, Math.max(8, Math.round(boxSize * 0.43)));
  const ruleHeight = Math.max(1.5, Math.round(fontSize / 6) / 2);

  button.style.setProperty('--sc-ink', color);
  button.style.setProperty('--sc-fill', fillColor);
  button.style.setProperty('--sc-check', checkColor);
  button.style.setProperty('--sc-box', `${boxSize}px`);
  button.style.setProperty('--sc-radius', `${boxRadius}px`);
  button.style.setProperty('--sc-font', `${fontSize}px`);
  button.style.setProperty('--sc-ring', `${ring}px`);
  button.style.setProperty('--sc-gap', `${gap}px`);
  button.style.setProperty('--sc-row', `${Math.max(32, boxSize + 12)}px`);
  button.style.setProperty('--sc-rule', `${ruleHeight}px`);
  button.style.setProperty('--sc-origin', SC_ORIGIN[strike] || SC_ORIGIN.left);

  button.innerHTML = `
    <span class="spring-check__press">
      <span class="spring-check__box">
        <span class="spring-check__ring" aria-hidden="true"></span>
        <span class="spring-check__fill"></span>
        <svg class="spring-check__tick" viewBox="0 0 24 24" aria-hidden="true">
          <path d="${SC_TICK_PATH}" pathLength="1" stroke-dasharray="1" style="stroke-dashoffset: 1;" />
        </svg>
      </span>
    </span>
    <span class="spring-check__label">
      <span class="spring-check__word"></span>
      ${strike !== 'none' ? '<span class="spring-check__rule" aria-hidden="true"></span>' : ''}
    </span>
  `;

  const boxEl = button.querySelector('.spring-check__box');
  const fillEl = button.querySelector('.spring-check__fill');
  const tickEl = button.querySelector('.spring-check__tick path');
  const wordEl = button.querySelector('.spring-check__word');
  const ruleEl = button.querySelector('.spring-check__rule');

  if (wordEl) wordEl.textContent = label;

  function applyReadings(val) {
    currentT = val;
    const r = scReadings(val, doneOpacity, strikeLag);
    if (fillEl) fillEl.style.transform = r.fill;
    if (boxEl) boxEl.style.transform = r.box;
    if (tickEl) tickEl.style.strokeDashoffset = r.tick;
    if (wordEl) wordEl.style.opacity = r.word;
    if (ruleEl) ruleEl.style.transform = r.rule;
  }

  // Initial state without animating
  applyReadings(currentT);

  function animateTo(target, instant = false) {
    if (cancelAnimation) {
      cancelAnimation();
      cancelAnimation = null;
    }

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || instant) {
      applyReadings(target);
      return;
    }

    const startVal = currentT;
    const delta = target - startVal;
    if (Math.abs(delta) < 0.0001) return;

    const zeta = scZetaOf(bounce);
    let wd, w0;
    if (zeta < 1) {
      wd = Math.PI / SC_VISUAL_DURATION;
      w0 = wd / Math.sqrt(1 - zeta * zeta);
    } else {
      w0 = 2 / SC_VISUAL_DURATION;
      wd = 0;
    }

    let startTime = null;
    let rafId = null;

    function step(now) {
      if (!startTime) startTime = now;
      const elapsed = (now - startTime) / 1000;

      let progress;
      if (zeta < 1) {
        const decay = Math.exp(-zeta * w0 * elapsed);
        const envelope = Math.cos(wd * elapsed) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * elapsed);
        progress = 1 - decay * envelope;

        if (elapsed > SC_VISUAL_DURATION && decay < 0.005) {
          applyReadings(target);
          cancelAnimation = null;
          return;
        }
      } else {
        const decay = Math.exp(-w0 * elapsed);
        progress = 1 - decay * (1 + w0 * elapsed);
        if (decay < 0.005) {
          applyReadings(target);
          cancelAnimation = null;
          return;
        }
      }

      applyReadings(startVal + delta * progress);
      rafId = requestAnimationFrame(step);
    }

    rafId = requestAnimationFrame(step);
    cancelAnimation = () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }

  const handlePointerDown = e => {
    if (e.button !== 0 || disabled) return;
    viaPointer = true;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) button.dataset.pressed = '';
  };

  const handlePointerUp = () => {
    delete button.dataset.pressed;
  };

  const handlePointerCancel = () => {
    viaPointer = false;
    handlePointerUp();
  };

  const toggle = () => {
    if (disabled) return;
    viaPointer = false;
    isChecked = !isChecked;
    button.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    animateTo(isChecked ? 1 : 0);
    onChange?.(isChecked);
  };

  button.addEventListener('pointerdown', handlePointerDown);
  button.addEventListener('pointerup', handlePointerUp);
  button.addEventListener('pointercancel', handlePointerCancel);
  button.addEventListener('pointerleave', handlePointerCancel);
  button.addEventListener('click', toggle);

  return {
    element: button,
    setChecked(newChecked, animate = true) {
      if (isChecked === !!newChecked && Math.abs(currentT - (newChecked ? 1 : 0)) < 0.001) return;
      isChecked = !!newChecked;
      button.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      animateTo(isChecked ? 1 : 0, !animate);
    },
    destroy() {
      if (cancelAnimation) cancelAnimation();
    }
  };
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
    row.dataset.id = t.id;

    const springCheck = createSpringCheck({
      label: t.text,
      checked: !!t.done,
      color: 'var(--mauve)',
      fillColor: 'var(--mauve)',
      checkColor: '#09080c',
      boxSize: 23,
      boxRadius: 7,
      fontSize: 15.5,
      bounce: 0.2,
      strikeLag: 0.12,
      doneOpacity: 0.42,
      strike: 'left',
      onChange: (checked) => {
        const arr = load('todos', []);
        const item = arr.find(x => x.id === t.id);
        if (item) {
          item.done = checked;
          save('todos', arr);
          const hist = load('todoHistory', {});
          const key = t.date || todayKey;
          hist[key] = Math.max(0, (hist[key] || 0) + (checked ? 1 : -1));
          save('todoHistory', hist);

          if (checked) {
            row.classList.add('done');
          } else {
            row.classList.remove('done');
          }

          // Sync other container if both exist (dashboard and todo page)
          const otherContainerId = containerId === 'todoList' ? 'pageTodoList' : 'todoList';
          const otherList = document.getElementById(otherContainerId);
          if (otherList) {
            const otherRow = otherList.querySelector(`[data-id="${t.id}"]`);
            if (otherRow && otherRow._springCheck) {
              otherRow._springCheck.setChecked(checked, true);
              if (checked) otherRow.classList.add('done');
              else otherRow.classList.remove('done');
            }
          }

          updateTodoStats();
          renderBars();
        }
      }
    });

    row._springCheck = springCheck;
    row.appendChild(springCheck.element);

    const rmBtn = document.createElement('button');
    rmBtn.className = 'todo-rm';
    rmBtn.title = 'Delete task';
    rmBtn.style.cssText = 'background:none;border:none;color:var(--text-3);font-size:16px;cursor:pointer;padding:0 4px;line-height:1;margin-left:auto;';
    rmBtn.innerHTML = '&times;';
    rmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTodo(t.id);
    });
    row.appendChild(rmBtn);

    list.appendChild(row);
  });
}

function updateTodoStats(){
  const todos = load('todos', []);
  const todayKey = todayISO();
  const todosToday = todos.filter(t => (t.date || todayKey) === todayKey);

  // stats reflect Today's tasks
  const total = todosToday.length;
  const done = todosToday.filter(t=>t.done).length;
  const totalText = `of ${total} ${total === 1 ? 'task' : 'tasks'}`;
  const circumference = 314;
  const pct = total ? done/total : 0;
  const strokeOffset = circumference - (circumference*pct);

  // Dashboard Wheel
  const doneEl = document.getElementById('todoDone'); 
  if (doneEl) doneEl.textContent = done;

  const totalLbl = document.getElementById('todoTotalLbl');
  if (totalLbl) totalLbl.textContent = totalText;

  const ring = document.getElementById('todoRing');
  if (ring) ring.style.strokeDashoffset = strokeOffset;

  // To-Do Page Wheel
  const pageDoneEl = document.getElementById('pageTodoDone'); 
  if (pageDoneEl) pageDoneEl.textContent = done;

  const pageTotalLbl = document.getElementById('pageTodoTotalLbl');
  if (pageTotalLbl) pageTotalLbl.textContent = totalText;

  const pageRing = document.getElementById('pageTodoRing');
  if (pageRing) pageRing.style.strokeDashoffset = strokeOffset;

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

function renderTodos(){
  const todos = load('todos', []);
  const todayKey = todayISO();

  const todosToday = todos.filter(t => (t.date || todayKey) === todayKey);
  renderTodoRows('todoList', todosToday, todayKey);
  renderTodoRows('pageTodoList', todosToday, todayKey);
  updateTodoStats();
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
    rolloverCalendarMonth();
    renderTodos();
    renderEvents();
    renderMiniCalendar();
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
  while (dayHasActivity(cursor) && streak < 3650){
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

  if (!grid.habits.length){
    list.innerHTML = `<div class="event-empty">No habits yet - add one on the Habit Tracker page.</div>`;
    return;
  }

  list.innerHTML = '';
  grid.habits.forEach((h) => {
    const key = markKey(h.id, today);
    const isChecked = !!grid.marks[key];

    const row = document.createElement('div');
    row.className = 'quick-row';
    row.dataset.habitId = h.id;

    const springCheck = createSpringCheck({
      label: h.name,
      checked: isChecked,
      color: 'var(--mauve)',
      fillColor: 'var(--mauve)',
      checkColor: '#09080c',
      boxSize: 23,
      boxRadius: 7,
      fontSize: 15.5,
      bounce: 0.2,
      strikeLag: 0.12,
      doneOpacity: 0.42,
      strike: 'left',
      onChange: (checked) => {
        const g = load('habitGrid', grid);
        if (checked) g.marks[key] = true;
        else delete g.marks[key];
        save('habitGrid', g);

        // Update corresponding cell in tracker table if rendered
        document.querySelectorAll(`.js-tracker-table .tracker-cell[data-h="${h.id}"][data-d="${today}"]`).forEach(cell => {
          if (checked) cell.classList.add('checked');
          else cell.classList.remove('checked');
        });

        updateWeeklyHabitMetric();
        renderBars();
        renderProgressGraph();
        updateStreakDisplay();
      }
    });

    row._springCheck = springCheck;
    row.appendChild(springCheck.element);
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

/* ---------------- GOALS: Roadmaps Core Logic, Deletion & Shared Rendering ---------------- */

function deleteRoadmap(idx) {
  let roadmaps = load('roadmaps', []);
  if (idx < 0 || idx >= roadmaps.length) return;
  const oldLen = roadmaps.length;
  roadmaps.splice(idx, 1);
  save('roadmaps', roadmaps);

  // Clean and shift roadmap_checks_*
  try {
    const keyI = getStorageKey(`roadmap_checks_${idx}`);
    if (storageOK) {
      localStorage.removeItem(keyI);
    } else {
      delete memoryStore[keyI];
    }
    for (let j = idx + 1; j < oldLen; j++) {
      const val = load(`roadmap_checks_${j}`, {});
      save(`roadmap_checks_${j - 1}`, val);
      const keyJ = getStorageKey(`roadmap_checks_${j}`);
      if (storageOK) {
        localStorage.removeItem(keyJ);
      } else {
        delete memoryStore[keyJ];
      }
    }
  } catch(e) {
    console.warn('Error shifting roadmap checks:', e);
  }

  renderRoadmaps();
  if (window._renderDashboardGoals) window._renderDashboardGoals();
}

function buildRoadmapCardHtml(rm, rmIdx) {
  const totalMilestones = (rm.milestones || []).length;
  const checkedKey = `roadmap_checks_${rmIdx}`;
  const checks = load(checkedKey, {});
  const checkedCount = Object.values(checks).filter(Boolean).length;
  const pct = totalMilestones > 0 ? Math.round((checkedCount / totalMilestones) * 100) : 0;

  let milestonesHtml = '';
  let activeIdx = 0;
  
  // Determine which milestone is currently active (first unchecked)
  while(activeIdx < totalMilestones && checks[activeIdx]) {
    activeIdx++;
  }

  (rm.milestones || []).forEach((ms, msIdx) => {
    const isChecked = !!checks[msIdx];
    const desc = ms.description || '';
    
    let stateClass = '';
    let canToggle = false;
    
    if (isChecked) {
      stateClass = 'milestone-done';
      if (msIdx === activeIdx - 1) {
        canToggle = true; // Can undo the last completed milestone
      }
    } else if (msIdx === activeIdx) {
      stateClass = 'milestone-active';
      canToggle = true; // Can check off the current active milestone
    } else {
      stateClass = 'milestone-locked';
    }

    milestonesHtml += `
      <div class="roadmap-timeline-item ${stateClass} ${canToggle ? 'can-toggle' : ''}" data-rm="${rmIdx}" data-ms="${msIdx}">
        <div class="timeline-timeframe">${escapeHtml(ms.timeframe)}</div>
        <div class="timeline-divider">
          <div class="timeline-dot" ${canToggle ? 'role="button" tabindex="0"' : ''}>
            ${isChecked ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="check-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
          </div>
          ${msIdx < totalMilestones - 1 ? '<div class="timeline-line"></div>' : ''}
        </div>
        <div class="timeline-content">
          <div class="timeline-title">${escapeHtml(ms.title)}</div>
          ${desc ? `<p class="timeline-desc">${escapeHtml(desc)}</p>` : ''}
        </div>
      </div>`;
  });

  return `
    <div class="roadmap-card">
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
      <div class="roadmap-timeline">${milestonesHtml}</div>
    </div>
  `;
}

function attachRoadmapCardListeners(container) {
  if (!container) return;

  // Add click listeners to the toggleable dots
  container.querySelectorAll('.roadmap-timeline-item.can-toggle .timeline-dot').forEach(dot => {
    const handleToggle = (e) => {
      e.stopPropagation();
      const item = e.target.closest('.roadmap-timeline-item');
      if (!item) return;
      const ri = parseInt(item.dataset.rm);
      const mi = parseInt(item.dataset.ms);
      const ck = `roadmap_checks_${ri}`;
      const c = load(ck, {});

      if (c[mi]) {
        delete c[mi];
      } else {
        c[mi] = true;
      }

      save(ck, c);
      renderRoadmaps();
      if (window._renderDashboardGoals) window._renderDashboardGoals();
    };

    dot.addEventListener('click', handleToggle);
    dot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleToggle(e);
      }
    });
  });
}

(function initDashboardGoalCard() {
  const goalList  = document.getElementById('goalList');
  const goalInput = document.getElementById('goalInput');
  const goToRoadmaps = document.getElementById('goToRoadmaps');

  if (goalInput) {
    const addInline = goalInput.closest('.add-inline');
    if (addInline) addInline.style.display = 'none';
  }

  if (goToRoadmaps) {
    goToRoadmaps.addEventListener('click', () => {
      if (typeof showView === 'function') showView('goals');
    });
  }

  function renderDashboardGoals() {
    if (!goalList) return;
    let roadmaps = load('roadmaps', []);
    goalList.innerHTML = '';
    if (!roadmaps.length) {
      goalList.innerHTML = `<div class="event-empty" style="padding:12px 0;">No roadmaps yet. Plan one on the Goals page.</div>`;
      return;
    }
    let cardsHtml = '';
    roadmaps.forEach((rm, rmIdx) => {
      cardsHtml += buildRoadmapCardHtml(rm, rmIdx);
    });
    goalList.innerHTML = cardsHtml;
    attachRoadmapCardListeners(goalList);
  }

  renderDashboardGoals();
  // Expose so renderRoadmaps and chat updates refresh the dashboard too
  window._renderDashboardGoals = renderDashboardGoals;
})();

/* ---------------- GOALS: AI Roadmap + Chat ---------------- */

const GOALS_SYSTEM_INSTRUCTION = `You are an expert domain coach inside Voyage, a productivity app. Your job is to transform the user's goal into a concrete, realistic, and highly tailored roadmap.

Flow:
Ask 1-2 focused questions at a time to learn their starting point/prior experience, timeframe, and constraints. Keep tone encouraging and concise. Keep asking (roadmapReady: false, roadmap: null) until you have enough info to propose a genuinely useful roadmap (usually 1-3 exchanges).

When ready to generate the roadmap, set roadmapReady to true and output a JSON object adhering strictly to these rules:

1. EXTRACT THE ACTUAL SUBJECT, NEVER REPEAT THE RAW SENTENCE:
- Before generating anything, identify the underlying topic, technology, or skill (e.g. "Ruby", "Digital Marketing", "Guitar") — NOT the user's literal request sentence.
- The goalTitle and every milestone title/description must refer to the actual subject naturally (e.g. goalTitle: "Ruby Mastery", "Ruby Development Roadmap").
- NEVER repeat the user's literal request phrasing (words like "give me," "a roadmap to," "teach me," "how to," "i want to learn," etc.) in goalTitle, summary, or any milestone title/description.
- Never append redundant words like "Roadmap Roadmap". Extract only the real subject matter.

2. RESPECT THE STATED TIMEFRAME EXACTLY:
- If the user specifies a timeframe (e.g. "2 months", "8 weeks", "3 months", "30 days"), the sum of all milestone durations MUST add up to approximately that total — not more, not noticeably less.
- Mentally total the weeks across all milestones before finalizing. If the user asks for 8 weeks (2 months), distribute exactly 8 weeks (e.g. Weeks 1–2, Weeks 3–4, Weeks 5–6, Weeks 7–8 across 4 milestones). Do not generate a default 10-12 week plan when given an 8-week target.

3. RESPECT STATED EXPERIENCE LEVEL:
- If the user states prior relevant experience (e.g. "I already know Python and Java", "experienced in C++"), SKIP general beginner material (variables, loops, what is an if-statement, basic OOP theory).
- Focus milestones on what is unique, idiomatic, and specific to the new subject (e.g. for Ruby with prior Python/Java experience: Ruby-specific syntax differences, blocks/procs/lambdas, metaprogramming, gems/Bundler, Rails ecosystem).
- Only include foundational programming basics if the user is a true beginner with zero coding background.

4. MILESTONE SPECIFICITY & NO "&" BUNDLING:
- Do NOT bundle two distinct major topics into a single milestone with "&" (e.g. do not do "Ruby Fundamentals & Core Principles" or "Gems & Rails & Testing").
- Every milestone title must name a concrete, specific skill or domain topic (not a generic study phase like "Intermediate Phase" or "Phase 1: Getting Started").
- Milestone count should scale naturally to goal breadth and timeframe (typically 3 to 6 focused milestones).
- Every milestone description must be 2-3 concise sentences explaining the focus and the concrete deliverable built.

RESPONSE FORMAT (JSON):
{
  "reply": "Encouraging summary explaining how this roadmap is tailored to their specific background and timeframe.",
  "roadmapReady": true,
  "roadmap": {
    "goalTitle": "Clean Title (e.g. 'Ruby Developer Roadmap')",
    "summary": "1-2 sentence executive overview of the roadmap tailored to their timeline and prior background.",
    "milestones": [
      {
        "title": "Concrete Topic Name",
        "timeframe": "Weeks 1–2",
        "description": "2-3 sentences detailing specific concepts and what practical project/deliverable is created."
      }
    ]
  }
}`;

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
            required: ["title", "timeframe", "description"]
          }
        }
      },
      required: ["goalTitle", "summary", "milestones"]
    }
  },
  required: ["reply", "roadmapReady", "roadmap"]
};

function extractCleanSubject(rawText) {
  if (!rawText) return 'Skill';
  let clean = String(rawText).trim();

  // Strip conversational requests, commands, action phrases, and meta prompts
  const prefixRegex = /^(can you\s+)?(please\s+)?(give me\s+(a\s+)?(roadmap|plan|guide|schedule|learning path)?(\s+(to|for|on))?|create\s+(a\s+)?(roadmap|plan|guide)?(\s+(to|for|on))?|make\s+(a\s+)?(roadmap|plan|guide)?(\s+(to|for|on))?|build\s+(a\s+)?(roadmap|plan|guide)?(\s+(to|for|on))?|show me\s+(a\s+)?(roadmap|plan|guide)?(\s+(to|for|on))?|i want to|i wanna|i would like to|i'd like to|my goal is to|i plan to|how to|help me(\s+(with|to|learn))?|teach me(\s+(how to|about))?|guide me(\s+(on|in|through|to))?|learn|master|study|start learning|become an?|roadmap for|roadmap to|plan for|learning path for)\s+/i;
  
  let prev;
  let iters = 0;
  do {
    prev = clean;
    clean = clean.replace(prefixRegex, '').trim();
    iters++;
  } while (clean !== prev && prefixRegex.test(clean) && iters < 20);

  // Strip trailing timeframe / filler qualifiers if present in raw sentence
  clean = clean.replace(/\s+(in\s+\d+\s*(weeks?|months?|days?|years?)|over\s+\d+\s*(weeks?|months?|days?|years?)|for\s+beginners?|from\s+scratch)$/i, '').trim();

  // Strip trailing "roadmap", "learning path", "plan"
  clean = clean.replace(/\s*(roadmap|milestone plan|learning path|plan)$/i, '').trim();

  if (!clean) return 'Skill';

  const minorWords = new Set(['and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'a', 'an', 'the']);
  clean = clean
    .split(/\s+/)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && minorWords.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');

  return clean;
}

function sanitizeRoadmap(roadmap) {
  if (!roadmap) return roadmap;
  let rawTitle = (roadmap.goalTitle || '').trim();
  
  // Clean conversational prefixes from goalTitle
  const cleanSubject = extractCleanSubject(rawTitle);
  
  // Build a clean, natural goalTitle without double "Roadmap" or conversational sentence
  let goalTitle = rawTitle;
  if (/^(give me|teach me|i want|learn|how to|help me|guide me|can you|create a|make a)/i.test(goalTitle) || !goalTitle) {
    goalTitle = `${cleanSubject} Roadmap`;
  } else {
    // Remove duplicate "Roadmap" if repeated at end
    goalTitle = goalTitle.replace(/\s+Roadmap\s+Roadmap$/i, ' Roadmap');
    if (!goalTitle.toLowerCase().includes('roadmap') && !goalTitle.toLowerCase().includes('mastery') && !goalTitle.toLowerCase().includes('path')) {
      goalTitle = `${goalTitle} Roadmap`;
    }
  }

  // Capitalize nicely
  goalTitle = goalTitle.charAt(0).toUpperCase() + goalTitle.slice(1);

  let summary = (roadmap.summary || '').trim();
  if (!summary || /achieve teach me/i.test(summary) || /give me a roadmap/i.test(summary)) {
    summary = `Tailored milestone roadmap to achieve ${cleanSubject.toLowerCase()} proficiency.`;
  }

  const conversationalFilterRegex = /(give me\s+(a\s+)?roadmap\s+(to\s+)?learn|teach me\s+how\s+to|teach me\s+|how to\s+|i want to\s+learn\s+)/gi;

  const milestones = (roadmap.milestones || []).map((m) => {
    let title = (m.title || '').trim();
    // Clean any accidental conversational prefixes from title
    title = title.replace(conversationalFilterRegex, '').trim();
    title = title.charAt(0).toUpperCase() + title.slice(1);

    let desc = (m.description || '').trim();
    desc = desc.replace(conversationalFilterRegex, '');

    return {
      ...m,
      title: title || 'Milestone',
      description: desc
    };
  });

  return {
    ...roadmap,
    goalTitle,
    summary,
    milestones
  };
}

const INITIAL_CHAT_MSG = "Hey! I'm your goal planning coach. Tell me about a goal you'd like to work toward \u2014 could be anything from learning a skill to a fitness goal or a career ambition. What's on your mind?";

let goalConversation = []; // { role: 'user'|'model', text: '...' }

function renderRoadmaps() {
  const container = document.getElementById('roadmapsContainer');
  if (!container) return;
  let roadmaps = load('roadmaps', []);

  // Clean up any previously stored roadmaps with conversational titles
  let needsSave = false;
  roadmaps = roadmaps.map(rm => {
    const clean = sanitizeRoadmap(rm);
    if (clean.goalTitle !== rm.goalTitle || clean.summary !== rm.summary) needsSave = true;
    return clean;
  });
  if (needsSave) save('roadmaps', roadmaps);

  if (!roadmaps.length) {
    container.innerHTML = `
      <div class="roadmap-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"/><circle cx="13" cy="17" r="3"/><path d="m16 20 2 2 4-4"/></svg>
        <p>No roadmaps yet &mdash; plan one below.</p>
      </div>`;
    return;
  }

  let cardsHtml = '';
  roadmaps.forEach((rm, rmIdx) => {
    cardsHtml += buildRoadmapCardHtml(rm, rmIdx);
  });
  container.innerHTML = cardsHtml;
  attachRoadmapCardListeners(container);
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
  const allUserText = userMessages.join(' ');
  
  const cleanSubject = extractCleanSubject(initialGoal);
  const goalTitle = `${cleanSubject} Roadmap`;

  const isFirstMessage = userMessages.length <= 1;
  const hasDetails = /\b(\d+\s*(weeks?|months?|days?|hours?)|beginner|advanced|intermediate|developer|programmer|engineer|experience|python|java|javascript|c\+\+|coding|code|yes|sure|okay)\b/i.test(latestText);

  if (isFirstMessage && !hasDetails) {
    return {
      reply: `That's an exciting goal! To tailor the best step-by-step roadmap for "${cleanSubject}", could you share a bit more:\n1. What is your current background or prior coding experience?\n2. What is your target timeframe (e.g. 8 weeks, 3 months)?\n3. How many hours per week can you dedicate?`,
      roadmap: null
    };
  }

  // Detect timeframe from conversation
  let totalWeeks = 8;
  const monthMatch = allUserText.match(/(\d+)\s*months?/i);
  const weekMatch = allUserText.match(/(\d+)\s*weeks?/i);
  if (monthMatch) {
    totalWeeks = parseInt(monthMatch[1], 10) * 4;
  } else if (weekMatch) {
    totalWeeks = parseInt(weekMatch[1], 10);
  }

  // Detect prior experience
  const hasPriorExp = /\b(python|java|c\+\+|javascript|golang|rust|php|c#|experience|already know|developer|engineer|programmer|can code)\b/i.test(allUserText);

  // Divide into 4 phases proportional to totalWeeks
  const w1End = Math.max(1, Math.round(totalWeeks * 0.25));
  const w2End = Math.max(w1End + 1, Math.round(totalWeeks * 0.5));
  const w3End = Math.max(w2End + 1, Math.round(totalWeeks * 0.75));
  const w4End = totalWeeks;

  let milestones = [];
  if (hasPriorExp) {
    milestones = [
      {
        title: `${cleanSubject} Syntax & Idiomatic Paradigms`,
        timeframe: `Weeks 1–${w1End}`,
        description: `Leverage your prior programming background to quickly map core constructs into ${cleanSubject}. Focus on language-specific idioms, closures/blocks, memory model, and interactive tooling.`
      },
      {
        title: `Standard Library & Ecosystem Tooling`,
        timeframe: `Weeks ${w1End + 1}–${w2End}`,
        description: `Explore ${cleanSubject}'s standard packages, package management, project structure, and automated testing frameworks. Build modular CLI tools and benchmark performance.`
      },
      {
        title: `Frameworks & Production Architecture`,
        timeframe: `Weeks ${w2End + 1}–${w3End}`,
        description: `Build end-to-end applications using the premier frameworks in the ${cleanSubject} ecosystem. Implement clean service architecture, database persistence, and asynchronous operations.`
      },
      {
        title: `Advanced Systems & Capstone Project`,
        timeframe: `Weeks ${w3End + 1}–${w4End}`,
        description: `Develop and deploy a complete production-grade application or library. Implement comprehensive test suites, CI/CD pipelines, and performance optimizations.`
      }
    ];
  } else {
    milestones = [
      {
        title: `${cleanSubject} Fundamentals & Setup`,
        timeframe: `Weeks 1–${w1End}`,
        description: `Set up your development environment and master foundational syntax, data structures, and basic control flow in ${cleanSubject} through practical exercises.`
      },
      {
        title: `Applied Concepts & Project Building`,
        timeframe: `Weeks ${w1End + 1}–${w2End}`,
        description: `Deepen your understanding with object-oriented and functional techniques in ${cleanSubject}. Construct practical utilities and solve algorithmic problems.`
      },
      {
        title: `Ecosystem Frameworks & Data Persistence`,
        timeframe: `Weeks ${w2End + 1}–${w3End}`,
        description: `Learn standard frameworks and data management techniques. Build multi-component applications integrating external libraries and databases.`
      },
      {
        title: `Showcase Application & Deployment`,
        timeframe: `Weeks ${w3End + 1}–${w4End}`,
        description: `Design, test, and deploy a complete capstone project demonstrating your mastery in ${cleanSubject}. Publish and document your repository.`
      }
    ];
  }

  return {
    reply: `I've prepared a ${totalWeeks}-week tailored roadmap for ${cleanSubject}${hasPriorExp ? ' tailored to your existing programming background' : ''}! You can track and check off each milestone in your roadmap timeline above.`,
    roadmap: {
      goalTitle,
      summary: `Tailored ${totalWeeks}-week milestone plan to achieve ${cleanSubject.toLowerCase()} mastery${hasPriorExp ? ' leveraging your existing coding background' : ''}.`,
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
  input.style.height = 'auto';
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
      console.log('[/api/chat raw response text]', data?.text);
      console.log('[/api/chat full response payload]', data);

      let parsed;
      try { 
        parsed = typeof data.text === 'string' ? JSON.parse(data.text) : data; 
      } catch(e) {
        console.warn('[/api/chat JSON parse error]', e, data.text);
        parsed = null;
      }

      if (parsed && (parsed.reply || parsed.roadmap)) {
        const { reply, roadmap } = parsed;
        if (reply) {
          appendChatMsg('assistant', reply);
          goalConversation.push({ role: 'model', text: reply });
        }
        if (roadmap && roadmap.goalTitle && roadmap.milestones && roadmap.milestones.length) {
          const cleanRoadmap = sanitizeRoadmap(roadmap);
          const roadmaps = load('roadmaps', []);
          roadmaps.push(cleanRoadmap);
          save('roadmaps', roadmaps);
          renderRoadmaps();
          if (window._renderDashboardGoals) window._renderDashboardGoals();
        }
        success = true;
      }
    } else {
      console.warn('[/api/chat HTTP error response]', res ? res.status : 'No response');
    }
  } catch(err) {
    console.warn('[GoalChat] API unavailable or network error, engaging smart dynamic planner:', err);
  }

  // Smart Offline/Rate-limit Fallback Engine
  if (!success) {
    try {
      const { reply, roadmap } = generateFallbackGoalResponse(goalConversation, text);
      appendChatMsg('assistant', reply);
      goalConversation.push({ role: 'model', text: reply });

      if (roadmap && roadmap.goalTitle && roadmap.milestones && roadmap.milestones.length) {
        const cleanRoadmap = sanitizeRoadmap(roadmap);
        const roadmaps = load('roadmaps', []);
        roadmaps.push(cleanRoadmap);
        save('roadmaps', roadmaps);
        renderRoadmaps();
        if (window._renderDashboardGoals) window._renderDashboardGoals();
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
  if (input) { 
    input.value = ''; 
    input.style.height = 'auto';
    input.focus(); 
  }
}

(function initGoalChat() {
  const sendBtn = document.getElementById('goalChatSendBtn');
  const input = document.getElementById('goalChatInput');
  const resetBtn = document.getElementById('goalChatResetBtn');
  
  const autoResizeInput = () => {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  };

  if (input) {
    input.addEventListener('input', autoResizeInput);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendGoalMessage();
      }
    });
  }

  if (sendBtn) sendBtn.addEventListener('click', sendGoalMessage);
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
  rolloverCalendarMonth();
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
  rolloverCalendarMonth();
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
    const isPast = d < todayNum;
    const pastClass = isPast ? ' past' : '';
    const dayEvents = eventsByDay[d];
    if (dayEvents && dayEvents.length){
      const eventsHtml = dayEvents.map(ev => `<span class="evt-label">${escapeHtml(ev.name)}</span>`).join('');
      html += `<div class="day-cell has-event${isToday?' today':''}${pastClass}" data-day="${d}" title="${escapeHtml(dayEvents.map(e=>e.name).join(', '))}">
        <span class="day-num">${d}</span>
        <div class="evt-list">${eventsHtml}</div>
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

  const greetEl = document.getElementById('greeting');
  const subEl = document.getElementById('pageSubtitle');
  if (greetEl) greetEl.textContent = 'Notes';
  if (subEl) subEl.textContent = 'Capture ideas before they slip away.';
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

  const greetEl = document.getElementById('greeting');
  const subEl = document.getElementById('pageSubtitle');
  if (greetEl) greetEl.textContent = 'My projects';
  if (subEl) subEl.textContent = '';

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

  // Decode HTML entities safely without script execution
  const parser = document.createElement('textarea');
  parser.innerHTML = str;
  str = parser.value || '';

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

    notes.slice(0, 3).forEach((n) => {
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

    const addTile = document.createElement('div');
    addTile.className = 'rich-note-add-tile';
    addTile.innerHTML = `<span class="plus-icon">+</span><span>Add note</span>`;
    addTile.addEventListener('click', () => {
      showView('notes');
      openNotionEditor(null, null, 'main');
    });
    dashContainer.appendChild(addTile);
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
  const todayChipText = document.getElementById('todayChipText');
  if (todayDateEl) todayDateEl.textContent = targetNote.date || 'Today';
  if (todayChipText) todayChipText.textContent = 'Created';

  // Update Breadcrumb inside Notion editor
  const crumbSection = document.getElementById('notionCrumbSection');
  const crumbTitle = document.getElementById('notionCrumbTitle');
  if (crumbSection) crumbSection.textContent = (returnView === 'folder' || forProjectId) ? 'Projects' : 'Notes';
  if (crumbTitle) crumbTitle.textContent = targetNote.title || 'Untitled Note';

  // Populate Title & Body
  const titleInput = document.getElementById('notionPageTitleInput');
  const canvas = document.getElementById('notionEditorCanvas');

  if (titleInput) {
    titleInput.value = targetNote.title || '';
    titleInput.oninput = () => {
      if (crumbTitle) crumbTitle.textContent = titleInput.value.trim() || 'Untitled Note';
    };
  }
  if (canvas) canvas.innerHTML = sanitizeHtml(targetNote.body || '');

  if (titleInput && !targetNote.title) {
    titleInput.focus();
  }
}

function resetTopDateBadge() {
  const activeView = document.querySelector('.nav-item.active')?.dataset.view || 'dashboard';
  const topDateBadge = document.getElementById('topDateBadge') || document.querySelector('.date-badge');
  if (topDateBadge) {
    topDateBadge.style.display = (activeView === 'timer' || activeView === 'goals') ? 'none' : 'flex';
  }
  const todayDateEl = document.getElementById('todayDate');
  const todayChipText = document.getElementById('todayChipText');
  if (todayDateEl) {
    todayDateEl.textContent = new Date().toLocaleDateString(undefined, { day:'numeric', month:'long', year:'numeric' });
  }
  if (todayChipText) {
    todayChipText.textContent = 'Today';
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
  if (canvas) note.body = sanitizeHtml(canvas.innerHTML);

  save('notes', notes);

  const badge = document.getElementById('notionSaveBadge');
  if (badge) {
    const textEl = badge.querySelector('.save-text');
    if (textEl) textEl.textContent = 'Saved';
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

  if (titleInput) {
    titleInput.addEventListener('input', scheduleEditorAutoSave);
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (canvas) canvas.focus();
      }
    });
  }

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

function getElById(id) {
  let el = document.getElementById(id);
  if (!el && window.documentPictureInPicture && window.documentPictureInPicture.window) {
    el = window.documentPictureInPicture.window.document.getElementById(id);
  }
  return el;
}

function getQuery(sel) {
  let el = document.querySelector(sel);
  if (!el && window.documentPictureInPicture && window.documentPictureInPicture.window) {
    el = window.documentPictureInPicture.window.document.querySelector(sel);
  }
  return el;
}

function flipTile(id, newDigit){
  const tile = getElById(id);
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

  // Sync mini timer flip clock
  flipTile('miniTileM1', digits[0]);
  flipTile('miniTileM2', digits[1]);
  flipTile('miniTileS1', digits[2]);
  flipTile('miniTileS2', digits[3]);

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

  const miniPlay = getElById('miniTimerPlayBtn');
  if (miniPlay) {
    miniPlay.textContent = 'Start';
    miniPlay.classList.remove('running');
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

  const miniPlay = getElById('miniTimerPlayBtn');
  if (miniPlay) {
    miniPlay.textContent = 'Pause';
    miniPlay.classList.add('running');
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

  // Control MoltenMetal animation depending on view
  if (window.moltenMetalInstance) {
    window.moltenMetalInstance.play();
  }

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

  const topDateBadge = document.getElementById('topDateBadge') || document.querySelector('.date-badge');
  if (topDateBadge) {
    topDateBadge.style.display = (view === 'timer' || view === 'goals') ? 'none' : 'flex';
  }

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

  // Initialize Flatpickr for the calendar page event date input
  if (window.flatpickr) {
    flatpickr("#pageEventDate", {
      allowInput: true,
      dateFormat: "Y-m-d", // matches standard HTML date format
      altInput: true,
      altFormat: "d-m-Y", // dd-mm-yyyy display format
      theme: "dark",
      placeholder: "dd-mm-yyyy",
      monthSelectorType: "static"
    });
  }

  // Mini Timer Initialization
  const minimizeBtn = document.getElementById('minimizeTimerBtn');
  const expandBtn = document.getElementById('miniTimerExpandBtn');
  const closeBtn = document.getElementById('miniTimerCloseBtn');
  const resetBtn = document.getElementById('miniTimerResetBtn');
  const miniUI = document.getElementById('miniTimerUI');
  const miniContent = document.getElementById('miniTimerContent');
  const miniPlayBtn = document.getElementById('miniTimerPlayBtn');

  const updateMiniTimerScale = () => {
    if (!miniUI || !miniContent) return;
    const w = miniUI.clientWidth || window.innerWidth;
    const h = miniUI.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;

    // Base dimensions of flip clock + controls
    const baseW = 490;
    const baseH = 210;
    const paddingX = 16;
    const paddingY = 16;

    const availableW = Math.max(20, w - paddingX);
    const availableH = Math.max(20, h - paddingY);

    const scale = Math.min(availableW / baseW, availableH / baseH);
    miniContent.style.transform = `scale(${Math.max(0.1, scale)})`;
  };

  if (window.ResizeObserver && miniUI) {
    const miniObserver = new ResizeObserver(() => {
      updateMiniTimerScale();
    });
    miniObserver.observe(miniUI);
  }

  const closeFloatingTimer = () => {
    if (window.documentPictureInPicture && window.documentPictureInPicture.window) {
      window.documentPictureInPicture.window.close();
    } else {
      miniUI.classList.remove('visible');
      const timerCard = document.querySelector('.timer-page-card');
      if (timerCard) timerCard.style.display = '';
    }
  };

  if (minimizeBtn && miniUI) {
    minimizeBtn.addEventListener('click', async () => {
      const timerCard = document.querySelector('.timer-page-card');
      if (timerCard) timerCard.style.display = 'none';

      if ('documentPictureInPicture' in window) {
        try {
          const pipWindow = await window.documentPictureInPicture.requestWindow({
            width: 340,
            height: 190,
          });

          pipWindow.document.title = "Voyage Focus Timer";

          // Copy all stylesheets and styles to PiP window
          document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
            pipWindow.document.head.appendChild(node.cloneNode(true));
          });

          pipWindow.document.body.style.margin = '0';
          pipWindow.document.body.style.backgroundColor = '#18151d';
          pipWindow.document.body.style.display = 'flex';
          pipWindow.document.body.style.alignItems = 'center';
          pipWindow.document.body.style.justifyContent = 'center';
          pipWindow.document.body.style.overflow = 'hidden';
          pipWindow.document.body.style.width = '100vw';
          pipWindow.document.body.style.height = '100vh';

          // Override fixed positioning for window mode
          miniUI.style.position = 'relative';
          miniUI.style.bottom = 'auto';
          miniUI.style.right = 'auto';
          miniUI.style.left = 'auto';
          miniUI.style.top = 'auto';
          miniUI.style.transform = 'none';
          miniUI.style.width = '100vw';
          miniUI.style.height = '100vh';
          miniUI.style.maxWidth = '100%';
          miniUI.style.maxHeight = '100%';
          miniUI.style.borderRadius = '0';
          miniUI.style.border = 'none';
          miniUI.style.boxShadow = 'none';

          miniUI.classList.add('visible');
          pipWindow.document.body.appendChild(miniUI);

          const pipResizeHandler = () => updateMiniTimerScale();
          pipWindow.addEventListener('resize', pipResizeHandler);
          requestAnimationFrame(updateMiniTimerScale);
          setTimeout(updateMiniTimerScale, 50);

          pipWindow.addEventListener("pagehide", () => {
            pipWindow.removeEventListener('resize', pipResizeHandler);
            miniUI.style.position = '';
            miniUI.style.bottom = '';
            miniUI.style.right = '';
            miniUI.style.left = '';
            miniUI.style.top = '';
            miniUI.style.transform = '';
            miniUI.style.width = '';
            miniUI.style.height = '';
            miniUI.style.maxWidth = '';
            miniUI.style.maxHeight = '';
            miniUI.style.borderRadius = '';
            miniUI.style.border = '';
            miniUI.style.boxShadow = '';
            
            miniUI.classList.remove('visible');
            document.body.appendChild(miniUI);
            if (timerCard) timerCard.style.display = '';
            updateMiniTimerScale();
          });
          
          return;
        } catch (err) {
          console.error("PiP failed, falling back to overlay:", err);
        }
      }

      // Fallback overlay
      miniUI.classList.add('visible');
      updateMiniTimerScale();
    });
  }

  if (expandBtn && miniUI) {
    expandBtn.addEventListener('click', closeFloatingTimer);
  }
  
  if (closeBtn && miniUI) {
    closeBtn.addEventListener('click', closeFloatingTimer);
  }

  if (miniPlayBtn) {
    miniPlayBtn.addEventListener('click', () => {
      startTimer();
    });
  }
  
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetTimer();
    });
  }

  const handle = document.getElementById('miniTimerDragHandle');
  if (handle && miniUI) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    handle.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      const rect = miniUI.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      
      miniUI.style.bottom = 'auto';
      miniUI.style.right = 'auto';
      miniUI.style.left = initialX + 'px';
      miniUI.style.top = initialY + 'px';
      miniUI.style.transform = 'none'; 
      miniUI.style.transition = 'none';
      
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      let newX = initialX + dx;
      let newY = initialY + dy;
      
      newX = Math.max(0, Math.min(newX, window.innerWidth - miniUI.offsetWidth));
      newY = Math.max(0, Math.min(newY, window.innerHeight - miniUI.offsetHeight));
      
      miniUI.style.left = newX + 'px';
      miniUI.style.top = newY + 'px';
    });

    handle.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      handle.releasePointerCapture(e.pointerId);
      miniUI.style.transition = 'opacity 0.3s ease';
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}



/* ============================================================
   Molten Metal Background Initialization
   ============================================================ */
window.moltenMetalInstance = null;
import('./MoltenMetal.js').then((module) => {
  const MoltenMetal = module.default;
  const container = document.getElementById('moltenMetalBg');
  if (container) {
    window.moltenMetalInstance = new MoltenMetal(container, {
      speed: 0.245 // Reduced speed by 30% from the default 0.35
    });
  }
}).catch(console.error);
