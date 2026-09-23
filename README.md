# GestiónBar

Aplicación web para administrar turnos, inventario, comandas, pagos y promociones
de un bar. Usa React/Vite en el frontend, Express en la API y SQLite como base de
datos local.

## Puesta en marcha rápida

Requiere Node.js 18 o superior.

```bash
npm install
npm start
```

Después abre `http://localhost:3000`. Para usar la aplicación desde un celular,
abre `http://IP_DEL_SERVIDOR:3000` desde la misma red Wi-Fi.

La guía completa está en [GUIA_DESPLIEGUE.md](./GUIA_DESPLIEGUE.md).

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
