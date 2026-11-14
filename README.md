# Next Show

PWA vanilla (sin frameworks) para ver tráilers de películas y series: cartelera actual y próximos estrenos, en pestañas. Mismo patrón que tus otros proyectos "Next": sin backend propio, estática en GitHub Pages, con un Worker de Cloudflare como proxy para ocultar las claves de TMDB y YouTube.

## 1. Desplegar el Worker (proxy)

1. `npm install -g wrangler` (si no lo tienes ya).
2. Dentro de `worker/`, ejecuta `wrangler init` o simplemente despliega `cloudflare-worker.js` como un Worker nuevo desde el dashboard de Cloudflare (Workers & Pages → Create → Importar este archivo).
3. Añade los secretos:
   ```
   wrangler secret put TMDB_API_KEY
   wrangler secret put YOUTUBE_API_KEY
   ```
   `TMDB_API_KEY` debe ser el token v4 de lectura (Bearer), no el api_key v3.
4. Despliega con `wrangler deploy` y copia la URL que te da (algo como `https://next-show-proxy.tu-usuario.workers.dev`).

## 2. Conectar la app al Worker

Abre `app.js` y cambia la primera línea:

```js
const WORKER_BASE = 'https://next-show-proxy.YOUR-SUBDOMAIN.workers.dev';
```

por la URL real que te dio Wrangler.

## 3. Publicar en GitHub Pages

1. Crea un repo nuevo (o usa uno existente) y sube `index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js` y la carpeta `icons/` a la raíz (no subas `worker/`, eso vive solo en Cloudflare).
2. En el repo: Settings → Pages → Source: rama `main`, carpeta `/ (root)`.
3. Espera el deploy y abre la URL que te da (`https://tu-usuario.github.io/next-show/`).

## 4. Instalar en el iPhone

1. Abre esa URL en **Safari** (no Chrome).
2. Toca el icono de compartir → "Añadir a pantalla de inicio".
3. Listo: se abre en modo standalone, sin la barra de Safari.

## Notas

- Los iconos en `icons/` son un placeholder simple (triángulo de play); sustitúyelos cuando tengas un diseño definitivo, manteniendo los mismos nombres y tamaños (192×192 y 512×512).
- El nombre "Next Show" es solo una propuesta para seguir tu convención (Next Match, Next Flight, Next Train...); cámbialo en `index.html`, `manifest.json` y aquí si prefieres otro.

## Mi lista y aviso de estreno

- Cada póster tiene una estrella ☆ para guardarlo en **Mi lista** (pestaña ⭐). Se guarda solo en el dispositivo (`localStorage`, clave `next-trailer:watchlist`).
- Mi lista separa **Por estrenar** y **Ya estrenados** según la fecha del título.
- En los títulos por estrenar, **⏰ Avísame del estreno** crea una cuenta atrás en [Next Appointment](https://aleweing.github.io/next-appointment/) mediante su enlace `?import=`, y desde ahí se activa el aviso. Si Next Appointment está instalada en el iPhone, hay que usar "Copiar enlace" y pegarlo en «Importar» dentro de la app.

## Ficha del título y "Dónde verlo"

Al tocar un póster se abre una ficha con **▶ Ver tráiler**, **☆ Guardar**, **⏰ Avísame** (solo si aún no se ha estrenado) y **Dónde verlo**: las plataformas de España donde está el título (suscripción, gratis, alquiler y compra) y, si la película lleva menos de 90 días estrenada, un botón para buscar entradas de cine.

### Activar las plataformas (una vez, en Cloudflare)

La app pide las plataformas a `GET /api/providers?mediaType=movie|tv&id=<id de TMDB>`. Ese endpoint hay que añadirlo al Worker `next-trailer`:

1. Dashboard de Cloudflare → Worker `next-trailer` → **Edit code**.
2. Pega al final la función `handleProviders` de [`worker/providers-endpoint.js`](worker/providers-endpoint.js).
3. Añade su ruta junto a las demás, dentro de `fetch()`:
   ```js
   if (url.pathname === '/api/providers') return await handleProviders(url, env, cors);
   ```
4. **Deploy**. Usa el secret `TMDB_API_KEY` que ya existe.

Mientras el Worker no tenga ese endpoint, la ficha funciona igual y en "Dónde verlo" muestra un enlace de búsqueda en JustWatch.

### Enlaces

TMDB no da enlaces directos a cada plataforma. Netflix, Prime Video / Amazon, Apple TV, Rakuten TV y Google Play abren su buscador con el título; el resto abre la página del título en TMDB, que enlaza a cada plataforma vía JustWatch.

### Afiliación

En `app.js`, constante `AFFILIATE` (vacía por defecto = enlaces normales):

| Campo | Qué es |
|---|---|
| `amazonTag` | Tag de Amazon Afiliados (ej. `frontrow-21`). Se añade a los enlaces de Prime Video y Amazon. |
| `cinemaUrl` | Enlace de entradas de cine con `{title}` donde va el título (ej. enlace de afiliado de Atrápalo vía Awin). Vacío = búsqueda de cartelera en Google. |

Con cualquiera de los dos relleno, la ficha muestra el aviso de enlaces de afiliado.

### Licencia de datos

- La ficha muestra la atribución obligatoria de TMDB y JustWatch. No la quites.
- La API de TMDB es gratuita solo para uso no comercial: **antes de rellenar `AFFILIATE` hay que pedir a TMDB su licencia comercial.**
