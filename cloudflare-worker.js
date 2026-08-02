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
      if (url.pathname === '/api/movies') return await handleMovies(url, env, cors);
      if (url.pathname === '/api/series') return await handleSeries(url, env, cors);
      if (url.pathname === '/api/youtube') return await handleYoutube(url, env, cors);

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

// Allowed regions: US + common European country codes (includes GB)
const ALLOWED_COUNTRIES = new Set([
  'US','GB','FR','DE','ES','IT','NL','BE','SE','NO','DK','FI','IE','AT','CH','PT','PL','CZ','HU','GR','RO','BG','HR','SI','SK','LT','LV','EE','MT','LU'
]);

async function handleMovies(url, env, cors) {
  const category = url.searchParams.get('category') === 'upcoming' ? 'upcoming' : 'now_playing';
  // fetch first page for performance
  const data = await tmdbFetch(`/movie/${category}?language=en-US&page=1`, env);

  const results = data.results ?? [];

  // For each movie, fetch release_dates and include only if any release country is in ALLOWED_COUNTRIES
  const checked = await Promise.all(
    results.slice(0, 20).map(async movie => {
      try {
        const rd = await tmdbFetch(`/movie/${movie.id}/release_dates?`, env);
        const hasAllowed = (rd.results || []).some(r => ALLOWED_COUNTRIES.has(r.iso_3166_1));
        if (!hasAllowed) return null;

        return {
          id: movie.id,
          mediaType: 'movie',
          title: movie.title,
          originalTitle: movie.original_title,
          date: movie.release_date,
          posterPath: movie.poster_path,
        };
      } catch (e) {
        return null;
      }
    })
  );

  const items = checked.filter(Boolean);
  return json(items, cors);
}

async function handleSeries(url, env, cors) {
  const category = url.searchParams.get('category') ?? 'on_the_air';
  let path;

  if (category === 'upcoming') {
    const today = new Date().toISOString().split('T')[0];
    path = `/discover/tv?language=en-US&sort_by=first_air_date.asc&first_air_date.gte=${today}&page=1`;
  } else {
    path = '/tv/on_the_air?language=en-US&page=1';
  }

  const data = await tmdbFetch(path, env);
  const results = data.results ?? [];

  // Filter TV shows by origin_country intersecting allowed countries (approximation)
  const items = results
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

async function handleYoutube(url, env, cors) {
  const title = url.searchParams.get('title');
  if (!title) return json({ error: 'Missing title' }, cors, 400);

  const query = encodeURIComponent(`${title} tráiler oficial`);
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${query}&key=${env.YOUTUBE_API_KEY}`
  );
  const data = await res.json();
  const videoId = data.items?.[0]?.id?.videoId ?? null;

  return json({ videoId }, cors);
}

function json(body, cors, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}
