// ─────────────────────────────────────────────────────────────────────────────
// Front Row · endpoint "Dónde verlo"  →  GET /api/providers?mediaType=movie|tv&id=123
//
// Este archivo NO se despliega solo: es un trozo para pegar en el Worker
// `next-trailer` (dashboard de Cloudflare → Edit code).
//
//   1. Pega la función handleProviders (entera) al final del Worker.
//   2. Añade esta línea junto a las demás rutas, dentro de fetch():
//
//        if (url.pathname === '/api/providers') return await handleProviders(url, env, cors);
//
//   3. Deploy. Usa el mismo secret TMDB_API_KEY que ya tienes; no hace falta nada más.
//
// Respuesta: { link, flatrate: [...], free: [...], ads: [...], rent: [...], buy: [...] }
// donde cada plataforma es { id, name, logoPath }. Sin disponibilidad en España,
// todas las listas llegan vacías y link es null.
// La disponibilidad viene de JustWatch a través de TMDB: hay que mostrar su
// atribución (la app ya lo hace en la ficha).
// ─────────────────────────────────────────────────────────────────────────────

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
