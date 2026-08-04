const WORKER_BASE = 'https://next-trailer.alewein.workers.dev';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const ITEMS_LIMIT = 12;

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
  }
};

const state = {
  mediaType: 'movies',
  category: { movies: 'now_playing', series: 'on_the_air', streaming: 'netflix' },
  cache: {}
};

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

function posterCardHTML(item) {
  const img = item.posterPath
    ? `<img class="poster-img" src="${TMDB_IMAGE_BASE}${item.posterPath}" alt="${escapeHTML(item.title)}" loading="lazy" />`
    : `<div class="poster-img placeholder">🎬</div>`;

  return `
    <div class="poster-card"
         data-id="${escapeHTML(String(item.id))}"
         data-media-type="${escapeHTML(item.mediaType || '')}"
         data-original-title="${escapeHTML(item.originalTitle || item.title)}">
      ${img}
      <div class="poster-title">${escapeHTML(item.title)}</div>
      <div class="poster-date">${escapeHTML(item.date)}</div>
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

async function renderContent() {
  const content = document.getElementById('content');
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
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js');
  }
}

setupEvents();
render();
registerServiceWorker();
