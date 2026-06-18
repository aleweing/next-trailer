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
      return json({ error: 'Internal error' }, cors, 500);
    }
  }
};

async function tmdbFetch(path, env) {
  const res = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${env.TMDB_API_KEY}` }
  });
  if (!res.ok) throw new Error('TMDB request failed');
  return res.json();
}

async function handleMovies(url, env, cors) {
  const category = url.searchParams.get('category') === 'upcoming' ? 'upcoming' : 'now_playing';
  const data = await tmdbFetch(`/movie/${category}?language=es-ES&region=ES&page=1`, env);

  const items = (data.results ?? []).map(movie => ({
    id: movie.id,
    mediaType: 'movie',
    title: movie.title,
    date: movie.release_date
  }));

  return json(items, cors);
}

async function handleSeries(url, env, cors) {
  const category = url.searchParams.get('category') ?? 'on_the_air';
  let path;

  if (category === 'upcoming') {
    const today = new Date().toISOString().split('T')[0];
    path = `/discover/tv?language=es-ES&sort_by=first_air_date.asc&first_air_date.gte=${today}&page=1`;
  } else {
    path = '/tv/on_the_air?language=es-ES&page=1';
  }

  const data = await tmdbFetch(path, env);

  const items = (data.results ?? []).map(show => ({
    id: show.id,
    mediaType: 'tv',
    title: show.name,
    date: show.first_air_date
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
