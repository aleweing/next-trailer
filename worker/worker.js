const ALLOWED_COUNTRIES = new Set(['US','GB','ES','AR']);

// `id` = TMDB watch-provider id (JustWatch-sourced, reflects CURRENT
// streaming availability only — populated once a title actually goes live).
// `networkId` (TV only) = TMDB TV network id, registered when the show is
// added to TMDB, well before release. Only set this for providers whose
// catalog is overwhelmingly originals (Apple TV+) — for providers built
// mostly on licensed/third-party content (Netflix, Prime, Max...) the
// network id doesn't reliably represent "available here" and would pull in
// unrelated shows.
const STREAMING_PROVIDERS = {
  netflix:     { id: 8 },
  prime:       { id: 119 },
  skyshowtime: { id: 1773 }, // was 37 — wrong id, matched nothing
  max:         { id: 1899 }, // was 29 — wrong id, matched nothing
  disney:      { id: 337 },
  appletv:     { id: 350, networkId: 2552 },
  movistar:    { id: 149 }
};

function json(body, cors, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

function dateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
}

function normalizeText(str) {
  return (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set(['the','a','an','and','of','el','la','los','las','de','del','y','un','una','en','to','for']);

function significantWords(title) {
  return normalizeText(title).split(' ').filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

// Hardened: filters out items without a usable videoId BEFORE scoring, so a
// score-0 match (title didn't overlap significant words) still wins over
// nothing, and only returns null when truly no item has a videoId.
function pickBestVideo(title, items) {
  const withVideoId = (items || []).filter(item => item?.id?.videoId);
  if (!withVideoId.length) return null;

  const words = significantWords(title);
  if (!words.length) return withVideoId[0].id.videoId;

  const scored = withVideoId
    .map(item => ({
      videoId: item.id.videoId,
      score: words.filter(w => normalizeText(item.snippet?.title).includes(w)).length
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0].videoId;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    try {
      if (url.pathname === '/api/movies')    return await handleMovies(url, env, cors);
      if (url.pathname === '/api/series')    return await handleSeries(url, env, cors);
      if (url.pathname === '/api/streaming') return await handleStreaming(url, env, cors);
      if (url.pathname === '/api/youtube')   return await handleYoutube(url, env, cors);
      if (url.pathname === '/api/providers') return await handleProviders(url, env, cors);

      return new Response('Not found', { status: 404, headers: cors });
    } catch (err) {
      return json({ error: 'Internal error', detail: String(err) }, cors, 500);
    }
  }
};

async function tmdbFetch(path, env) {
  const res = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${env.TMDB_API_KEY}` }
  });
  if (!res.ok) throw new Error(`TMDB request failed: ${path} (${res.status})`);
  return res.json();
}

async function handleMovies(url, env, cors) {
  const category = url.searchParams.get('category') === 'upcoming' ? 'upcoming' : 'now_playing';

  if (category === 'upcoming') {
    const today = dateOffset(0);
    const oneYear = dateOffset(365);
    // Same fix as now_playing: `release_date.gte/lte` filters by Spain's
    // specific release date (not the movie's global primary_release_date),
    // and `with_release_type=2|3` requires an actual theatrical release
    // record for Spain. Without these, TMDB — an open, crowd-editable
    // database — also returns low-quality entries with no real Spanish
    // theatrical release: mislabeled Chinese web movies, duplicate or
    // placeholder listings, cancelled projects with garbage dates, etc.
    const base = `/discover/movie?language=en-US&region=ES&with_release_type=2|3&sort_by=release_date.asc&release_date.gte=${today}&release_date.lte=${oneYear}`;

    const [p1, p2] = await Promise.all([
      tmdbFetch(`${base}&page=1`, env),
      tmdbFetch(`${base}&page=2`, env)
    ]);

    const merged = [...(p1.results ?? []), ...(p2.results ?? [])];
    const byId = new Map();
    for (const m of merged) if (m?.id && !byId.has(m.id)) byId.set(m.id, m);

    const items = Array.from(byId.values()).map(movie => ({
      id: movie.id,
      mediaType: 'movie',
      title: movie.title,
      originalTitle: movie.original_title,
      date: movie.release_date,
      posterPath: movie.poster_path
    }));

    return json(items, cors);
  }

  // now_playing: instead of checking /movie/{id}/release_dates for up to 20
  // individual movies (up to 21 TMDB calls, scaling with result count), we
  // fetch /discover/movie once per allowed country to build a fixed-size
  // set of IDs already known to be released there. Total calls: 1 + 4 = 5,
  // regardless of how many results now_playing returns.
  //
  // IMPORTANT: we filter on `release_date.gte/lte` (the release date *in
  // that specific region*), not `primary_release_date.gte/lte` (the movie's
  // global earliest release date anywhere in the world). Using the primary
  // date let e.g. a Korea-only theatrical release leak into the US/GB/ES/AR
  // sets just because its worldwide primary date fell in the window, even
  // though it never played in any of those countries.
  // `with_release_type=2|3` restricts to theatrical (limited + wide) so
  // digital/physical-only releases don't count as "in theatres".
  const past = dateOffset(-30);
  const future = dateOffset(7);
  const countries = Array.from(ALLOWED_COUNTRIES);

  const [nowPlaying, ...countryLists] = await Promise.all([
    tmdbFetch(`/movie/now_playing?language=en-US&page=1`, env),
    ...countries.map(country =>
      tmdbFetch(
        `/discover/movie?language=en-US&region=${country}&with_release_type=2|3&sort_by=popularity.desc&release_date.gte=${past}&release_date.lte=${future}&page=1`,
        env
      ).catch(() => ({ results: [] })) // one country failing shouldn't kill the whole request
    )
  ]);

  const allowedIds = new Set();
  for (const list of countryLists) {
    for (const m of list.results ?? []) allowedIds.add(m.id);
  }

  const items = (nowPlaying.results ?? [])
    .filter(movie => allowedIds.has(movie.id))
    .slice(0, 20)
    .map(movie => ({
      id: movie.id,
      mediaType: 'movie',
      title: movie.title,
      originalTitle: movie.original_title,
      date: movie.release_date,
      posterPath: movie.poster_path
    }));

  return json(items, cors);
}

async function handleSeries(url, env, cors) {
  const category = url.searchParams.get('category') ?? 'on_the_air';

  if (category === 'upcoming') {
    const today = dateOffset(0);
    const oneYear = dateOffset(365);
    const base = `/discover/tv?language=en-US&watch_region=ES&sort_by=first_air_date.asc&first_air_date.gte=${today}&first_air_date.lte=${oneYear}`;

    const [p1, p2] = await Promise.all([
      tmdbFetch(`${base}&page=1`, env),
      tmdbFetch(`${base}&page=2`, env)
    ]);

    const merged = [...(p1.results ?? []), ...(p2.results ?? [])];
    const byId = new Map();
    for (const s of merged) if (s?.id && !byId.has(s.id)) byId.set(s.id, s);

    const items = Array.from(byId.values())
      .filter(show => (show.origin_country || []).some(c => ALLOWED_COUNTRIES.has(c)))
      .slice(0, 20)
      .map(show => ({
        id: show.id,
        mediaType: 'tv',
        title: show.name,
        originalTitle: show.original_name,
        date: show.first_air_date,
        posterPath: show.poster_path
      }));

    return json(items, cors);
  }

  const past   = dateOffset(-14);
  const future = dateOffset(30);
  const path = `/discover/tv?language=en-US&watch_region=ES&with_watch_monetization_types=flatrate|free|ads&sort_by=popularity.desc&air_date.gte=${past}&air_date.lte=${future}&page=1`;

  const data = await tmdbFetch(path, env);

  const items = (data.results ?? [])
    .filter(show => (show.origin_country || []).some(c => ALLOWED_COUNTRIES.has(c)))
    .filter(show => (show.vote_count ?? 0) > 0)
    .slice(0, 20)
    .map(show => ({
      id: show.id,
      mediaType: 'tv',
      title: show.name,
      originalTitle: show.original_name,
      date: show.first_air_date,
      posterPath: show.poster_path
    }));

  return json(items, cors);
}

async function handleStreaming(url, env, cors) {
  const providerKey = url.searchParams.get('provider') ?? 'netflix';
  const provider = STREAMING_PROVIDERS[providerKey];

  if (!provider) return json([], cors);

  const past   = dateOffset(-30);
  const future = dateOffset(30); // was 90 — narrower window also means fewer far-future candidates competing for the page-1 cap
  const origin = encodeURIComponent('ES|US|GB|AR');
  // sort_by must be date-based, not popularity.desc: TMDB only returns the
  // top 20 results for page 1, sorted by whatever `sort_by` says BEFORE
  // your code re-sorts by date at the end. A title added this week rarely
  // has enough votes yet to rank in the top 20 by popularity, so it never
  // even reaches the final date sort — it's dropped before that. Sorting
  // by release date at the query level guarantees the newest arrivals are
  // the ones fetched.
  const common = `watch_region=ES&with_watch_providers=${provider.id}&with_watch_monetization_types=flatrate&with_origin_country=${origin}`;

  const tvQueries = [
    // air_date (not first_air_date) filters by ANY episode airing in the
    // window — including new seasons of returning shows. first_air_date
    // only reflects season 1's premiere, so a show like Ted Lasso getting
    // a season 4 would never match on that field.
    tmdbFetch(`/discover/tv?language=en-US&${common}&sort_by=first_air_date.desc&air_date.gte=${past}&air_date.lte=${future}&page=1`, env)
  ];

  if (provider.networkId) {
    // Network assignment is registered on TMDB when the show's page is
    // created — typically well before release — unlike watch-provider
    // availability, which only appears once JustWatch detects the title is
    // actually live. This catches originals that are about to premiere.
    // sort_by is ascending (soonest first): with only page 1 (20 results)
    // and a date-range window, descending order was filling the page with
    // titles further out and pushing imminent premieres (e.g. tomorrow)
    // past the cutoff. Uses air_date, same reasoning as above.
    tvQueries.push(
      tmdbFetch(`/discover/tv?language=en-US&watch_region=ES&with_networks=${provider.networkId}&sort_by=first_air_date.asc&air_date.gte=${past}&air_date.lte=${future}&page=1`, env)
        .catch(() => ({ results: [] }))
    );
  }

  const [movieData, ...tvDataList] = await Promise.all([
    tmdbFetch(`/discover/movie?language=en-US&region=ES&${common}&sort_by=primary_release_date.desc&primary_release_date.gte=${past}&primary_release_date.lte=${future}&page=1`, env),
    ...tvQueries
  ]);

  const movies = (movieData.results ?? []).map(m => ({
    id: m.id, mediaType: 'movie',
    title: m.title, originalTitle: m.original_title,
    date: m.release_date, posterPath: m.poster_path
  }));

  const tvById = new Map();
  for (const list of tvDataList) {
    for (const s of list.results ?? []) if (s?.id && !tvById.has(s.id)) tvById.set(s.id, s);
  }

  const series = Array.from(tvById.values()).map(s => {
    // A show only matches via `air_date` (an episode airs in-window) but
    // its first_air_date can be years old — that's a returning show with a
    // new season, and discover/tv doesn't expose the new season's actual
    // air date (only /tv/{id} detail does). Showing first_air_date there
    // would be misleading (e.g. Ted Lasso S4 showing "2020"), so we only
    // keep the date when it's genuinely the show's real premiere in-window.
    const isGenuinePremiere = s.first_air_date && s.first_air_date >= past && s.first_air_date <= future;
    return {
      id: s.id, mediaType: 'tv',
      title: s.name, originalTitle: s.original_name,
      date: isGenuinePremiere ? s.first_air_date : null,
      posterPath: s.poster_path
    };
  });

  // Items without a date (returning shows with a new season) have no
  // reliable date to sort by, so they're placed first — poster-only.
  const combined = [...movies, ...series].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return -1;
    if (!b.date) return 1;
    return b.date.localeCompare(a.date);
  });

  return json(combined, cors);
}

async function searchYoutube(query, env) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(query)}&key=${env.YOUTUBE_API_KEY}`
  );
  if (!res.ok) {
    console.error(`YouTube API error: ${res.status} for query "${query}"`);
    return { ok: false, items: [] };
  }
  const data = await res.json();
  return { ok: true, items: data.items ?? [] };
}

async function tmdbLatestSeasonNumber(tvId, env) {
  const data = await tmdbFetch(`/tv/${tvId}`, env);
  if (data.next_episode_to_air?.season_number) return data.next_episode_to_air.season_number;
  if (data.last_episode_to_air?.season_number) return data.last_episode_to_air.season_number;
  const seasons = (data.seasons ?? []).filter(s => s.season_number > 0);
  if (!seasons.length) return null;
  return Math.max(...seasons.map(s => s.season_number));
}

async function handleYoutube(url, env, cors) {
  const title = url.searchParams.get('title');
  if (!title) return json({ error: 'Missing title' }, cors, 400);

  const mediaType = url.searchParams.get('mediaType');
  const tmdbId = url.searchParams.get('tmdbId');

  // For returning TV shows, a plain title search returns whatever trailer
  // has the most views/age — usually season 1's, not the one actually
  // premiering. One extra lazy TMDB call (only on tap, same pattern as the
  // trailer search itself) gets the current season number so we can search
  // for the right one specifically.
  let seasonNumber = null;
  if (mediaType === 'tv' && tmdbId) {
    try {
      seasonNumber = await tmdbLatestSeasonNumber(tmdbId, env);
    } catch {
      seasonNumber = null;
    }
  }

  const seasonEs = seasonNumber ? ` temporada ${seasonNumber}` : '';
  const seasonEn = seasonNumber ? ` season ${seasonNumber}` : '';

  // Attempt 1: Spanish-flavored trailer query
  const attempt1 = await searchYoutube(`${title}${seasonEs} tráiler subtitulado`, env);
  const videoId1 = pickBestVideo(title, attempt1.items);
  if (videoId1) return json({ videoId: videoId1 }, cors);

  // Attempt 2: English official trailer query
  const attempt2 = await searchYoutube(`${title}${seasonEn} official trailer`, env);
  const videoId2 = pickBestVideo(title, attempt2.items);
  if (videoId2) return json({ videoId: videoId2 }, cors);

  // Attempt 3: bare title (+ season if known), no "trailer" suffix —
  // last-resort net for titles where the suffix returns items with no
  // usable videoId
  const attempt3 = await searchYoutube(`${title}${seasonEn}`, env);
  const videoId3 = pickBestVideo(title, attempt3.items);

  if (!attempt1.ok && !attempt2.ok && !attempt3.ok) {
    return json({ error: 'YouTube API failed', videoId: null }, cors, 502);
  }

  return json({ videoId: videoId3 }, cors);
}

// "Dónde verlo": GET /api/providers?mediaType=movie|tv&id=<id de TMDB>
// Responde { link, flatrate, free, ads, rent, buy } con las plataformas de
// España; cada una es { id, name, logoPath }. Sin disponibilidad, las listas
// llegan vacías y link es null. La disponibilidad viene de JustWatch a través
// de TMDB: hay que mostrar su atribución (la app ya lo hace en la ficha).
async function handleProviders(url, env, cors) {
  const headers = { ...cors, 'Content-Type': 'application/json' };
  const mediaType = url.searchParams.get('mediaType') === 'tv' ? 'tv' : 'movie';
  const id = url.searchParams.get('id') || '';

  if (!/^\d+$/.test(id)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid id' }), { status: 400, headers });
  }

  const res = await fetch(`https://api.themoviedb.org/3/${mediaType}/${id}/watch/providers`, {
    headers: { Authorization: `Bearer ${env.TMDB_API_KEY}` }
  });
  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'TMDB request failed' }), { status: 502, headers });
  }

  const data = await res.json();
  const es = (data.results && data.results.ES) || {};
  const pick = list => (list || [])
    .slice()
    .sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
    .map(p => ({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path || null }));

  const body = {
    link: es.link || null,
    flatrate: pick(es.flatrate),
    free: pick(es.free),
    ads: pick(es.ads),
    rent: pick(es.rent),
    buy: pick(es.buy)
  };

  // La disponibilidad cambia poco: 6 h de caché ahorran llamadas a TMDB.
  return new Response(JSON.stringify(body), {
    headers: { ...headers, 'Cache-Control': 'public, max-age=21600' }
  });
}
