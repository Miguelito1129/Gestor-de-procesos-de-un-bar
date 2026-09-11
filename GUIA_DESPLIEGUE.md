# GestiónBar - servidor local

## Arquitectura

- Frontend: React + Vite.
- Backend: Node.js + Express.
- Base de datos: SQLite local en `backend/data/gestionbar.sqlite`.
- Red: los celulares, tablets y computadores acceden al servidor por la IP local del equipo servidor.
- El navegador nunca accede directamente al archivo SQLite.

## Inicio en desarrollo

En una terminal inicia el backend:

```bash
npm run dev:server
```

En otra terminal inicia Vite:

```bash
npm run dev
```

Para probar desde otro dispositivo en la misma red, abre la dirección que muestre
Vite usando la IP del equipo servidor, por ejemplo `http://192.168.1.20:5173`.

## Inicio integrado

Para servir la aplicación compilada desde Express:

```bash
npm run build
npm start
```

El servidor escucha en todas las interfaces de red (`0.0.0.0`) y expone la API
local bajo `/api`.

## Persistencia y respaldo

El archivo de datos se crea automáticamente en:

`backend/data/gestionbar.sqlite`

Para respaldarlo, detén el servidor y copia ese archivo a un lugar seguro. No lo
borres mientras la aplicación esté escribiendo datos.

## Modelo de operación

La API conserva las tablas históricas (`planillas`, `productos`, `gastos` y
`staff`) y las tablas nuevas (`turnos`, `comandas`, `pagos`, inventario,
descorches, gastos y cierres). El esquema se inicializa en [backend/db.js](./backend/db.js).
