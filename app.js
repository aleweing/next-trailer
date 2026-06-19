// Sustituye esto por la URL real de tu Worker en Cloudflare.
const WORKER_BASE = 'https://next-trailer.alewein.workers.dev';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const ITEMS_LIMIT = 10;

const CONFIG = {
  movies: {
    endpoint: '/api/movies',
    categories: [
      { id: 'now_playing', label: 'En cartelera' },
      { id: 'upcoming', label: 'Próximos' }
    ]
  },
  series: {
    endpoint: '/api/series',
    categories: [
      { id: 'on_the_air', label: 'En emisión' },
      { id: 'upcoming', label: 'Próximos' }
    ]
  }
};

const state = {
  mediaType: 'movies',
  category: { movies: 'now_playing', series: 'on_the_air' },
  cache: {}
};

async function fetchJSON(path) {
  const res = await fetch(`${WORKER_BASE}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json();
}

async function loadList(mediaType, category) {
  const cacheKey = `${mediaType}-${category}`;
  if (state.cache[cacheKey]) return state.cache[cacheKey];

  const items = await fetchJSON(`${CONFIG[mediaType].endpoint}?category=${category}`);

  const enriched = await Promise.all(
    items.slice(0, ITEMS_LIMIT).map(async item => {
      const { videoId } = await fetchJSON(
        `/api/youtube?title=${encodeURIComponent(item.originalTitle || item.title)}`
      );
      return { ...item, videoId };
    })
  );

  state.cache[cacheKey] = enriched;
  return enriched;
}

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function posterCardHTML(item) {
  const bg = item.posterPath
    ? `background-image: url('${TMDB_IMAGE_BASE}${item.posterPath}');`
    : '';

  return `
    <div class="poster-card" style="${bg}" data-video="${escapeHTML(item.videoId)}">
      <div class="poster-play">▶</div>
      <div class="poster-overlay">
        <div class="poster-title">${escapeHTML(item.title)}</div>
        <div class="poster-date">${escapeHTML(item.date)}</div>
      </div>
    </div>
  `;
}

function renderSegmented() {
  const segmented = document.getElementById('segmented');
  segmented.innerHTML = CONFIG[state.mediaType].categories
    .map(
      cat => `
        <button class="segment ${cat.id === state.category[state.mediaType] ? 'active' : ''}" data-category="${cat.id}">
          ${escapeHTML(cat.label)}
        </button>
      `
    )
    .join('');
}

async function renderContent() {
  const content = document.getElementById('content');
  content.innerHTML = '<p class="loading">Cargando…</p>';

  const category = state.category[state.mediaType];

  try {
    const items = await loadList(state.mediaType, category);
    content.innerHTML = items.map(posterCardHTML).join('');
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
  document.getElementById('player-frame').src = `https://www.youtube.com/embed/${videoId}`;
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

  document.getElementById('content').addEventListener('click', e => {
    const card = e.target.closest('.poster-card');
    if (card) openPlayer(card.dataset.video);
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
