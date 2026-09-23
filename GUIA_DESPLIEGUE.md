# GestiónBar - guía de montaje y uso

## Requisitos

- Node.js 18 o superior (se recomienda la versión LTS).
- npm incluido con Node.js.
- Para acceso desde celular: computador y celular conectados a la misma red Wi-Fi.

## Instalación inicial

Abre PowerShell o una terminal en la carpeta del proyecto y ejecuta:

```bash
npm install
```

La base SQLite se crea automáticamente en `backend/data/gestionbar.sqlite`.
No es necesario instalar SQLite por separado.

## Arquitectura

- Frontend: React + Vite.
- Backend: Node.js + Express.
- Base de datos: SQLite local en `backend/data/gestionbar.sqlite`.
- Red: los celulares, tablets y computadores acceden al servidor por la IP local del equipo servidor.
- El navegador nunca accede directamente al archivo SQLite.

## Inicio recomendado

Para que cualquier persona pueda compilar y arrancar la aplicación con un solo comando:

```bash
npm start
```

Este comando compila React, inicia Express y sirve la aplicación junto con la API
SQLite. Luego abre:

```text
http://localhost:3000
```

Para entrar desde un celular u otro equipo de la red, consulta la IP del computador
servidor y abre:

```text
http://IP_DEL_SERVIDOR:3000
```

Ejemplo:

```text
http://192.168.1.20:3000
```

No uses `localhost` desde el celular: allí `localhost` apunta al propio celular.

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
