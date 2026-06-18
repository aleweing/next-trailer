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
