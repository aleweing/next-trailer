// Sustituye esto por la URL real de tu Worker en Cloudflare una vez lo despliegues.
const WORKER_BASE = 'https://next-trailer.alewein.workers.dev';

const state = {
  activeTab: 'movies',
  cache: {}
};

const ROWS = {
  movies: [
    { key: 'movies-now', title: 'En cartelera', endpoint: '/api/movies?category=now_playing' },
    { key: 'movies-upcoming', title: 'Próximos estrenos', endpoint: '/api/movies?category=upcoming' }
  ],
  series: [
    { key: 'series-air', title: 'En emisión', endpoint: '/api/series?category=on_the_air' },
    { key: 'series-upcoming', title: 'Próximos estrenos', endpoint: '/api/series?category=upcoming' }
  ]
};

async function fetchJSON(path) {
  const res = await fetch(`${WORKER_BASE}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json();
}

async function loadRow(row) {
  if (state.cache[row.key]) return state.cache[row.key];

  const items = await fetchJSON(row.endpoint);

  const enriched = await Promise.all(
    items.slice(0, 5).map(async item => {
      const { videoId } = await fetchJSON(`/api/youtube?title=${encodeURIComponent(item.title)}`);
      return { ...item, videoId };
    })
  );

  state.cache[row.key] = enriched;
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

function cardHTML(item) {
  return `
    <div class="card">
      <div>
        <div class="card-title">${escapeHTML(item.title)}</div>
        <div class="card-date">${escapeHTML(item.date)}</div>
      </div>
      <button class="card-play" data-video="${escapeHTML(item.videoId)}">▶ Ver tráiler</button>
    </div>
  `;
}

function rowHTML(row) {
  return `
    <section class="row" data-row="${row.key}">
      <div class="row-header">
        <h2>${escapeHTML(row.title)}</h2>
        <button class="see-all" data-row="${row.key}">Ver todos</button>
      </div>
      <div class="cards" id="cards-${row.key}">
        <p class="loading">Cargando…</p>
      </div>
    </section>
  `;
}

async function renderTab(tab) {
  const content = document.getElementById('content');
  content.innerHTML = ROWS[tab].map(rowHTML).join('');

  ROWS[tab].forEach(row => {
    loadRow(row)
      .then(items => {
        document.getElementById(`cards-${row.key}`).innerHTML = items.map(cardHTML).join('');
      })
      .catch(() => {
        document.getElementById(`cards-${row.key}`).innerHTML =
          '<p class="loading">No se pudo cargar. Revisa la URL del Worker.</p>';
      });
  });
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

function openSheet(rowKey) {
  const items = state.cache[rowKey] || [];
  document.getElementById('sheet-list').innerHTML = items
    .map(
      item => `
        <li data-video="${escapeHTML(item.videoId)}">
          <div class="t">${escapeHTML(item.title)}</div>
          <div class="d">${escapeHTML(item.date)}</div>
        </li>
      `
    )
    .join('');
  document.getElementById('sheet-overlay').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('open');
}

function setupEvents() {
  document.getElementById('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    state.activeTab = btn.dataset.tab;
    renderTab(state.activeTab);
  });

  document.getElementById('content').addEventListener('click', e => {
    const playBtn = e.target.closest('.card-play');
    if (playBtn) {
      openPlayer(playBtn.dataset.video);
      return;
    }

    const seeAll = e.target.closest('.see-all');
    if (seeAll) {
      openSheet(seeAll.dataset.row);
    }
  });

  document.getElementById('sheet-overlay').addEventListener('click', e => {
    if (e.target.id === 'sheet-overlay') closeSheet();
  });

  document.getElementById('sheet-list').addEventListener('click', e => {
    const li = e.target.closest('li');
    if (!li) return;
    closeSheet();
    openPlayer(li.dataset.video);
  });

  document.getElementById('player-close').addEventListener('click', closePlayer);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js');
  }
}

setupEvents();
renderTab(state.activeTab);
registerServiceWorker();
