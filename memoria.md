# Memoria del proyecto GestionBar

## 1. Evolución del proyecto

El proyecto comenzó con la intención de usar Telegram para compartir información operativa de bares y discotecas. La visión evolucionó hacia una aplicación web propia, accesible desde computadores, tabletas y teléfonos dentro de una red local.

La plataforma debe permitir interfaces específicas para:

- Administrador.
- Dueño.
- Personal de barra.
- Meseros.

El objetivo actual es trabajar primero con una base de datos local, sin costos de servicios externos. La conexión a Supabase y Telegram fue retirada del flujo principal.

## 2. Arquitectura actual

- Frontend: React + Vite.
- Backend: Node.js + Express.
- Base de datos: SQLite local.
- Cliente de API: `src/lib/localApi.js`.
- Servidor integrado: `server.js`.
- Esquema y creación de base: `backend/db.js`.
- API REST: `backend/api.js`.
- Base de datos real: `backend/data/gestionbar.sqlite`.
- Acceso de otros dispositivos: mediante la IP local del computador servidor.

El navegador nunca accede directamente al archivo SQLite. Todas las operaciones pasan por la API local.

SQLite es la fuente de verdad para negocios, personal, productos, planillas y usuarios. El navegador conserva únicamente la sesión activa y algunos borradores heredados pendientes de migración.

## 3. Comandos principales

```powershell
# Servidor/API local
npm run dev:server

# Frontend Vite accesible por red
npm run dev -- --host 0.0.0.0

# Compilar frontend
npm run build

# Ejecutar la aplicación compilada
npm start
```

Después de cambiar el backend se debe reiniciar el servidor. Después de cambiar el frontend se recomienda recargar con `Ctrl + F5`.

## 4. Cambios realizados

### Migración y eliminación de servicios externos

- Se eliminó la carpeta `telegram-bot`.
- Se retiraron las referencias principales a Telegram.
- Se eliminaron los archivos principales de Supabase.
- Se reemplazaron las operaciones de datos por llamadas a la API local.
- Se actualizó la documentación de despliegue.
- Se conservaron los datos históricos mediante migraciones no destructivas.

### Base de datos

Se añadieron o adaptaron tablas para:

- `negocios`
- `staff`
- `productos`
- `planillas`
- `turnos`
- `comandas`
- `comanda_items`
- `pagos`
- `movimientos_inventario`
- `gastos_turno`
- `descorches`
- `novedades`
- `gastos_semanales`
- `cierres_semanales`
- `usuarios`

Los históricos de planillas y gastos se conservan. Las migraciones usan identificadores heredados para evitar duplicados.

### Roles y autenticación

- Se añadieron los roles `administrador`, `dueño`, `barra` y `mesero`.
- Se normalizaron roles antiguos.
- Las cuentas de acceso se guardan en la tabla SQLite `usuarios`.
- Durante la primera migración se importan los usuarios existentes de `localStorage` si todavía no existen usuarios en SQLite.
- El hash de contraseñas tiene un fallback para funcionar mediante HTTP en la red local.
- La sesión activa continúa en `localStorage` como solución temporal del navegador.

### Apertura de turnos

La apertura operativa se realiza desde `src/components/Planilla/Planilla.jsx`, que permite:

- Elegir modo discoteca o cantina.
- Registrar la base de caja.
- Seleccionar responsable de barra.
- Seleccionar uno o más meseros.
- Registrar conteo inicial de inventario.
- Guardar novedades de apertura.
- Crear el turno en estado abierto.
- Registrar los responsables en `staff`.

Los perfiles de barra y mesero creados localmente se combinan con los registros de `staff` para que puedan seleccionarse.

### Comandas e inventario

- El mesero puede crear comandas.
- Barra puede consultar comandas.
- Se pueden registrar pagos en efectivo o transferencia.
- Se valida el stock antes del despacho.
- El despacho descuenta inventario.
- Se registra el movimiento de inventario.
- La actualización entre dispositivos usa polling local cada tres segundos, porque SQLite no ofrece Realtime nativo.

### Último error corregido

Al abrir turno aparecía:

> No fue posible guardar los responsables del turno.

La causa era que el frontend enviaba `activo: true`, pero SQLite no acepta booleanos JavaScript como parámetros. `backend/db.js` ahora convierte automáticamente:

- `true` a `1`.
- `false` a `0`.

También se mejoraron los mensajes de error de `src/lib/localApi.js` para mostrar la respuesta real del backend.

La compilación fue validada con `npm run build`.

### Conexión general a SQLite

- `useAuth.jsx` consulta, crea, actualiza y elimina usuarios mediante `/api/usuarios`.
- `MainApp.jsx` inicializa los datos de demostración en SQLite cuando la base está vacía.
- Negocios, personal, productos, gastos fijos, cuentas por cobrar y planillas se cargan desde SQLite.
- Se eliminó el botón superior de `Abrir turno` del menú de escritorio. La vista sigue disponible en la navegación móvil.
- Se validó la persistencia de usuarios y la compilación del proyecto.
- Se crearon cuentas iniciales de prueba en SQLite para administrador, dueño, barra y mesero. Las contraseñas fueron almacenadas únicamente como hashes PBKDF2.
- Se corrigió el login por red local HTTP: la verificación ahora acepta el hash PBKDF2 y el hash fallback compatible con navegadores sin `crypto.subtle`; las cuentas iniciales se actualizaron al modo compatible.
- Se eliminaron los datos operativos ficticios de SQLite: negocios, personal, productos, inventario, planillas, turnos, comandas, pagos, gastos, transferencias, cuentas por cobrar y cierres. Se conserva únicamente la cuenta administrativa de acceso.
- Se retiró la carga automática de datos de demostración del frontend. La aplicación muestra una pantalla vacía hasta que el administrador cree el negocio real.
- La barra ahora puede autorizar pedidos pendientes. La autorización valida existencias, registra el pago, descuenta exactamente las cantidades de la comanda y crea movimientos de inventario.
- La barra puede registrar entradas urgentes de productos existentes, siempre con turno abierto y justificación obligatoria. La factura es opcional y se guarda como comprobante local en el movimiento de inventario.
- Se creó una interfaz móvil específica para meseros: búsqueda de productos, catálogo táctil, cantidades incrementales, carrito, total actualizado en vivo, envío de pedidos y listado de pedidos de la noche.
- Los pedidos del mesero muestran estados legibles: falta confirmación de barra, pagado o pedido cancelado. El mesero puede cancelar un pedido mientras todavía está pendiente de autorización.
- La barra ya no abre turnos desde su navegación. El administrador abre y cierra el turno únicamente desde Planillas; esa apertura crea el turno compartido en SQLite para barra y meseros.
- Se separaron las interfaces operativas en `MeseroWorkspace.jsx` y `BarraWorkspace.jsx`. `RoleWorkspace.jsx` quedó como enrutador y `useTurnoData.js` centraliza la carga y polling del turno, productos y comandas. El módulo de administrador no fue alterado.
- La interfaz del mesero ahora organiza el catálogo por categorías, muestra stock y cantidades seleccionadas, y permite editar o cancelar comandas pendientes. Toda modificación solicita confirmación antes de actualizar la comanda y avisar a barra.
- El inventario operativo es compartido: `productos` en SQLite es la fuente única que administra el módulo Inventario del administrador y que consultan/actualizan barra y mesero durante el turno.
- Las comandas ya no usan mesa en la interfaz. Cada turno asigna un consecutivo a cada comanda y guarda `mesero_nombre`; el mesero consulta únicamente sus propias comandas y barra puede desplegar los productos antes de autorizar.
- Al desplegar una comanda en barra, cada producto se compara con el stock actual de `productos`, mostrando cantidad solicitada, existencia disponible y alerta de faltante. La autorización se bloquea visualmente si algún producto no alcanza, además de conservar la validación al guardar.
- La entrada urgente de inventario de barra quedó dentro de un panel desplegable. La autorización de una comanda descuenta inventario y la deja como `entregada_falta_pago`; el mesero confirma `pago recibido` o mantiene `falta pago`, y solo la confirmación positiva cambia el estado a `pagada`.
- Administración tiene una vista de Comandas con filtro por estado, productos y marcas de tiempo de creación, autorización, entrega y pago.
- Al confirmar el pago, el mesero debe seleccionar efectivo, tarjeta o transferencia. El medio se guarda en `comandas.modo_pago` y `pagos.tipo`; transferencia queda registrada localmente como preparación para la futura integración API.

### Adaptación responsive

- Se añadió una hoja de estilos global en `src/index.css`.
- Se estableció `box-sizing`, prevención de desbordamiento horizontal y tamaños táctiles mínimos.
- En teléfonos, los campos se muestran con tamaño legible y las tablas permiten desplazamiento horizontal.
- El formulario de nuevas comandas se apila en una sola columna en pantallas pequeñas.
- El contenido móvil usa padding adaptable y respeta el área segura inferior de dispositivos con navegación por gestos.

## 5. Estado actual

Ya está disponible:

- Aplicación web local.
- API Express.
- SQLite local.
- Roles básicos.
- Gestión inicial de negocios, personal y productos.
- Apertura de turnos.
- Comandas.
- Pagos y despacho.
- Descuento de inventario.
- Conservación de históricos.

Todavía está pendiente:

1. Cierre de turno local.
2. Gastos, descorches y novedades completas.
3. Persistencia real de imágenes de comprobantes.
4. Respaldo e importación de la base SQLite.
5. Autenticación y autorización en el backend.
6. Migración completa de módulos antiguos.
7. Pruebas integrales con varios dispositivos.
8. Verificación completa de productos y stock antes del conteo de apertura.

## 6. Reglas para usar los tokens al mínimo

Estas reglas deben aplicarse en futuras sesiones:

1. Leer primero este archivo antes de explorar el proyecto.
2. No volver a investigar decisiones ya documentadas.
3. Usar búsquedas específicas con `rg` o `glob`, no listar todo el proyecto.
4. Leer únicamente los rangos necesarios de los archivos.
5. Agrupar lecturas independientes en una sola llamada paralela.
6. No delegar tareas pequeñas que puedan resolverse con una o dos búsquedas.
7. No repetir pruebas ya ejecutadas si el código relacionado no cambió.
8. Ejecutar primero validaciones pequeñas y dirigidas.
9. Usar `npm run build` después de cambios relevantes del frontend.
10. Probar la API directamente solo cuando el error esté relacionado con backend o SQLite.
11. No pegar archivos completos en la conversación si basta con indicar rutas y líneas relevantes.
12. Mantener las respuestas breves y orientadas a acciones.
13. No crear planes o archivos adicionales si el usuario no los solicita.
14. No modificar archivos no relacionados con la tarea.
15. Antes de editar, buscar si ya existe una función reutilizable.
16. Después de cada cambio, comprobar solo el comportamiento afectado.
17. No instalar dependencias salvo que una validación lo requiera.
18. No volver a explicar toda la arquitectura; resumir solo lo nuevo.
19. Mantener este archivo actualizado únicamente cuando cambien decisiones, arquitectura o estado importante.
20. Si falta información crítica, hacer una sola pregunta concreta antes de explorar ampliamente.

## 7. Procedimiento recomendado para futuras tareas

1. Leer `memoria.md`.
2. Identificar el archivo o módulo directamente relacionado.
3. Buscar símbolos concretos.
4. Leer solo el contexto necesario.
5. Aplicar un cambio pequeño y completo.
6. Ejecutar la validación más corta que cubra el cambio.
7. Actualizar esta memoria solo si el estado del proyecto cambió.
