const WORKER_BASE = 'https://next-trailer.alewein.workers.dev';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const ITEMS_LIMIT = 12;

// "Mi lista": se guarda solo en este dispositivo.
const WATCHLIST_KEY = 'next-trailer:watchlist';
// Next Appointment (misma serie Next) crea la cuenta atrás y el aviso del estreno.
const APPOINTMENT_URL = 'https://aleweing.github.io/next-appointment/';

const CONFIG = {
  movies: {
    endpoint: '/api/movies',
    paramName: 'category',
    categories: [
      { id: 'now_playing', label: 'En cartelera' },
      { id: 'upcoming',    label: 'Próximos' }
    ]
  },
  series: {
    endpoint: '/api/series',
    paramName: 'category',
    categories: [
      { id: 'on_the_air', label: 'En emisión' },
      { id: 'upcoming',   label: 'Próximos' }
    ]
  },
  streaming: {
    endpoint: '/api/streaming',
    paramName: 'provider',
    categories: [
      { id: 'netflix',     label: 'Netflix' },
      { id: 'prime',       label: 'Prime Video' },
      { id: 'skyshowtime', label: 'SkyShowtime' },
      { id: 'max',         label: 'Max' },
      { id: 'disney',      label: 'Disney+' },
      { id: 'appletv',     label: 'Apple TV+' },
      { id: 'movistar',    label: 'Movistar Plus+' }
    ]
  },
  watchlist: {
    categories: [
      { id: 'upcoming', label: 'Por estrenar' },
      { id: 'released', label: 'Ya estrenados' }
    ]
  }
};

const state = {
  mediaType: 'movies',
  category: { movies: 'now_playing', series: 'on_the_air', streaming: 'netflix', watchlist: 'upcoming' },
  cache: {},
  itemsByKey: {} // títulos pintados, para poder guardarlos en Mi lista
};

// ─── Mi lista ────────────────────────────────────────────────────────────────

function itemKey(item) {
  return `${item.mediaType || ''}:${item.id}`;
}

const Watchlist = {
  load() {
    try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || []; } catch { return []; }
  },
  save(list) {
    try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list)); } catch { /* modo privado */ }
  },
  has(key) {
    return this.load().some(i => itemKey(i) === key);
  },
  /** Añade o quita. Devuelve true si queda guardado. */
  toggle(item) {
    const list = this.load();
    const key = itemKey(item);
    const idx = list.findIndex(i => itemKey(i) === key);
    if (idx >= 0) {
      list.splice(idx, 1);
      this.save(list);
      return false;
    }
    const { id, title, originalTitle, posterPath, date, mediaType } = item;
    list.push({ id, title, originalTitle, posterPath, date, mediaType, addedAt: Date.now() });
    this.save(list);
    return true;
  }
};

/** Fecha de estreno en formato YYYY-MM-DD, o null si no se puede interpretar. */
function releaseISO(date) {
  if (!date) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const t = Date.parse(date);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Enlace que abre Next Appointment con la cuenta atrás del estreno lista para importar. */
function appointmentLink(item) {
  const isSeries = /tv|serie/i.test(item.mediaType || '');
  const name = `Estreno: ${item.title}`;
  const payload = {
    name: name.length > 40 ? name.slice(0, 39) + '…' : name,
    date: releaseISO(item.date),
    time: '10:00',
    emoji: isSeries ? '📺' : '🎬',
    color: '#ff2d55',
    category: 'other',
    recurrenceUnit: 'none',
    recurrenceInterval: 1
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  return `${APPOINTMENT_URL}?import=${encodeURIComponent(encoded)}`;
}


async function fetchJSON(path) {
  const res = await fetch(`${WORKER_BASE}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json();
}

async function loadList(mediaType, key) {
  const cacheKey = `${mediaType}-${key}`;
  if (state.cache[cacheKey]) return state.cache[cacheKey];

  const { endpoint, paramName } = CONFIG[mediaType];
  const items = await fetchJSON(`${endpoint}?${paramName}=${key}`);

  const result = (Array.isArray(items) ? items : []).slice(0, ITEMS_LIMIT);
  state.cache[cacheKey] = result;
  return result;
}

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function posterCardHTML(item, { withReminder = false } = {}) {
  const key = itemKey(item);
  state.itemsByKey[key] = item;
  const saved = Watchlist.has(key);
  const release = releaseISO(item.date);
  const reminder = withReminder && release && release > todayISO()
    ? `<button class="remind-btn" data-key="${escapeHTML(key)}">⏰ Avísame del estreno</button>`
    : '';
  const img = item.posterPath
    ? `<img class="poster-img" src="${TMDB_IMAGE_BASE}${item.posterPath}" alt="${escapeHTML(item.title)}" loading="lazy" />`
    : `<div class="poster-img placeholder">🎬</div>`;

  return `
    <div class="poster-card"
         data-id="${escapeHTML(String(item.id))}"
         data-media-type="${escapeHTML(item.mediaType || '')}"
         data-original-title="${escapeHTML(item.originalTitle || item.title)}">
      <div class="poster-wrap">
        ${img}
        <button class="fav-btn ${saved ? 'saved' : ''}" data-key="${escapeHTML(key)}"
                aria-label="${saved ? 'Quitar de Mi lista' : 'Guardar en Mi lista'}">${saved ? '★' : '☆'}</button>
      </div>
      <div class="poster-title">${escapeHTML(item.title)}</div>
      <div class="poster-date">${escapeHTML(item.date)}</div>
      ${reminder}
    </div>
  `;
}

function renderSegmented() {
  document.getElementById('segmented').innerHTML = CONFIG[state.mediaType].categories
    .map(cat => `
      <button class="segment ${cat.id === state.category[state.mediaType] ? 'active' : ''}" data-category="${cat.id}">
        ${escapeHTML(cat.label)}
      </button>
    `).join('');
}

function renderWatchlist() {
  const content = document.getElementById('content');
  const today = todayISO();
  const showUpcoming = state.category.watchlist === 'upcoming';

  const items = Watchlist.load()
    .filter(i => {
      const d = releaseISO(i.date);
      const upcoming = !d || d > today; // sin fecha → aún por estrenar
      return showUpcoming ? upcoming : !upcoming;
    })
    .sort((a, b) => (releaseISO(a.date) || '9999').localeCompare(releaseISO(b.date) || '9999')
      * (showUpcoming ? 1 : -1));

  if (!items.length) {
    content.innerHTML = Watchlist.load().length
      ? `<p class="loading">${showUpcoming ? 'Nada pendiente de estreno en tu lista.' : 'Todavía no se ha estrenado nada de tu lista.'}</p>`
      : '<p class="loading">Toca ☆ en cualquier póster para guardarlo aquí y no perderte su estreno.</p>';
    return;
  }
  content.innerHTML = items.map(i => posterCardHTML(i, { withReminder: true })).join('');
}

async function renderContent() {
  const content = document.getElementById('content');
  if (state.mediaType === 'watchlist') return renderWatchlist();

  content.innerHTML = '<p class="loading">Cargando…</p>';

  const key = state.category[state.mediaType];

  try {
    const items = await loadList(state.mediaType, key);
    content.innerHTML = items.length
      ? items.map(posterCardHTML).join('')
      : '<p class="loading">Sin resultados disponibles ahora.</p>';
  } catch {
    content.innerHTML = '<p class="loading">No se pudo cargar. Revisa la URL del Worker.</p>';
  }
}

function render() {
  renderSegmented();
  renderContent();
}

function openPlayer(videoId) {
  if (!videoId) return;
  document.getElementById('player-frame').src = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
  document.getElementById('player-overlay').classList.add('open');
}

function closePlayer() {
  document.getElementById('player-overlay').classList.remove('open');
  document.getElementById('player-frame').src = '';
}

// ─── Aviso de estreno (vía Next Appointment) ────────────────────────────────

function openReminder(item) {
  const link = appointmentLink(item);
  document.getElementById('reminder-title').textContent = item.title;
  document.getElementById('reminder-date').textContent = releaseISO(item.date).split('-').reverse().join('/');
  document.getElementById('reminder-open').href = link;
  document.getElementById('reminder-copy').dataset.link = link;
  document.getElementById('reminder-sheet').classList.add('open');
}

function closeReminder() {
  document.getElementById('reminder-sheet').classList.remove('open');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function setupEvents() {
  document.getElementById('bottom-nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mediaType = btn.dataset.media;
    render();
  });

  document.getElementById('segmented').addEventListener('click', e => {
    const btn = e.target.closest('.segment');
    if (!btn) return;
    state.category[state.mediaType] = btn.dataset.category;
    render();
  });

  document.getElementById('content').addEventListener('click', async e => {
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) {
      const item = state.itemsByKey[favBtn.dataset.key];
      if (!item) return;
      const saved = Watchlist.toggle(item);
      if (state.mediaType === 'watchlist') return renderWatchlist();
      favBtn.classList.toggle('saved', saved);
      favBtn.textContent = saved ? '★' : '☆';
      favBtn.setAttribute('aria-label', saved ? 'Quitar de Mi lista' : 'Guardar en Mi lista');
      toast(saved ? 'Guardado en Mi lista' : 'Quitado de Mi lista');
      return;
    }

    const remindBtn = e.target.closest('.remind-btn');
    if (remindBtn) {
      const item = state.itemsByKey[remindBtn.dataset.key];
      if (item) openReminder(item);
      return;
    }

    const card = e.target.closest('.poster-card');
    if (!card) return;

    const title = card.dataset.originalTitle;
    if (!title) return;

    const mediaType = card.dataset.mediaType;
    const tmdbId = card.dataset.id;

    card.style.opacity = '0.5';

    try {
      const { videoId } = await fetchJSON(
        `/api/youtube?title=${encodeURIComponent(title)}`
        + (mediaType ? `&mediaType=${encodeURIComponent(mediaType)}` : '')
        + (tmdbId ? `&tmdbId=${encodeURIComponent(tmdbId)}` : '')
      );
      card.style.opacity = '';
      if (videoId) {
        openPlayer(videoId);
      } else {
        card.style.opacity = '0.4';
      }
    } catch {
      card.style.opacity = '';
    }
  });

  document.getElementById('player-close').addEventListener('click', closePlayer);

  document.getElementById('reminder-close').addEventListener('click', closeReminder);
  document.getElementById('reminder-sheet').addEventListener('click', e => {
    if (e.target.id === 'reminder-sheet') closeReminder();
  });
  document.getElementById('reminder-open').addEventListener('click', closeReminder);
  document.getElementById('reminder-copy').addEventListener('click', async e => {
    try {
      await navigator.clipboard.writeText(e.currentTarget.dataset.link);
      toast('Enlace copiado: pégalo en Next Appointment → Importar');
      closeReminder();
    } catch {
      toast('No se pudo copiar el enlace');
    }
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js');
  }
}

setupEvents();
render();
registerServiceWorker();
