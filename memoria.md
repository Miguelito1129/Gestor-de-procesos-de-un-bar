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
- Respaldo automático SQLite: `backend/backup.js` crea una copia al iniciar el servidor y cada 15 minutos, conserva las 96 más recientes y replica a `%OneDrive%\GestionBar\Backups` cuando Windows tiene OneDrive configurado. La copia local adicional queda junto a los datos (`backend/data/backups` en desarrollo o `%LOCALAPPDATA%\GestionBar\data\backups` en el ejecutable). Solo se guardan copias que pasan `PRAGMA integrity_check`.
- Cliente de API: `src/lib/localApi.js`.
- Servidor integrado: `server.js`.
- Esquema y creación de base: `backend/db.js`.
- API REST: `backend/api.js`.
- Base de datos real: `backend/data/gestionbar.sqlite`.
- Acceso de otros dispositivos: mediante la IP local del computador servidor.

El navegador nunca accede directamente al archivo SQLite. Todas las operaciones pasan por la API local.

SQLite es la fuente de verdad para negocios, personal, productos, planillas y usuarios. El navegador conserva únicamente la sesión activa y algunos borradores heredados pendientes de migración.

## 3. Comandos principales

### Uso diario e impresión en Windows

En el computador que tiene enlazada por Bluetooth la impresora `Printer001`,
abre una terminal en la carpeta del proyecto y ejecuta:

```powershell
npm start
```

`npm start` compila el frontend actualizado y luego arranca Express, la API local
y la ruta de impresión en el puerto `3000`. Para imprimir, el backend debe correr
en el mismo computador Windows que está enlazado a la impresora. El puerto serial
detectado para `Printer001` es `COM3`, con velocidad predeterminada de `9600`
baudios. Si Windows asigna otro puerto, configúralo antes del inicio:

```powershell
$env:PRINTER_PORT = "COM3"
$env:PRINTER_BAUD_RATE = "9600"
npm start
```

No se debe mantener otro proceso del backend usando el puerto `3000` o el COM de
la impresora. Si se agregó o modificó una ruta de Express y el servidor ya estaba
corriendo, detenerlo con `Ctrl+C` en su terminal y volver a ejecutar el comando.

### Desarrollo

Para desarrollo, abrir dos terminales en la carpeta del mismo proyecto. Ejecutar
en la primera:

```powershell
npm run dev:server
```

Y en la segunda:

```powershell
npm run dev
```

El navegador de este computador usa `http://localhost:5173`; los dispositivos en
la misma red usan la IP del computador servidor con el puerto `5173`. En desarrollo
Vite envía las peticiones `/api` al backend del puerto `3000`. Para uso diario o
para probar la impresión desde teléfonos, se recomienda `npm start` y acceder al
puerto `3000` del computador conectado a `Printer001`.

Otros comandos:

```powershell
# Compilar frontend
npm run build

# Compilar y ejecutar la aplicación integrada
npm start
```

Después de cambiar el backend se debe reiniciar Express. Después de cambiar el
frontend en desarrollo, se recomienda recargar con `Ctrl + F5`.
El frontend de desarrollo usa el puerto fijo `5173` (`strictPort`): si ya está ocupado, Vite falla en vez de iniciar silenciosamente en otro puerto. El backend usa el puerto `3000`.

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

- El correo reservado `mdmm1100@gmail.com` es la única cuenta `administrador`; las cuentas antiguas con rol administrador pasan a `gerente`.
- El inicio de sesión y la validación de contraseñas se realizan en el backend. La API exige un token de sesión aleatorio y con vencimiento de ocho horas; SQLite conserva solo el hash del token en `sesiones`.
- `localStorage` conserva el token de sesión para restaurar el acceso en el navegador. El cierre de sesión invalida el token en el servidor.
- Las respuestas de `usuarios` no incluyen hashes ni sales de contraseña. Solo la cuenta maestra puede modificar usuarios, administrar negocios o consultar los enlaces de red.
- La licencia offline identifica el `MachineGuid` de Windows y valida firmas Ed25519. No evita modificaciones deliberadas del ejecutable ni la clonación completa de una máquina virtual o de la instalación de Windows.

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
- La barra ahora puede autorizar pedidos pendientes sin seleccionar medio de pago. Al entregar, la operación valida existencias por producto, descuenta inventario, crea movimientos y marca la comanda como pagada en una transacción SQLite. La aplicación automática de promociones de cortesía está desactivada también en el servidor; solo se contabilizan cortesías que ya estén explícitamente registradas como líneas de la comanda.
- Se creó una interfaz móvil específica para meseros: búsqueda de productos, catálogo táctil, cantidades incrementales, carrito, total actualizado en vivo, envío de pedidos y listado de pedidos de la noche.
- Los pedidos del mesero muestran estados legibles: falta autorización de Barra, pagado o pedido cancelado. El mesero puede cancelar un pedido mientras todavía está pendiente de autorización.
- La vista «Mis comandas» del mesero separa los pedidos por pestañas de estado con contador; inicia en pedidos en espera de Barra y mantiene categorías para pedidos pagados, cancelados y otros. No hay una etapa de confirmación posterior del pago.
- La barra ya no abre turnos desde su navegación. El administrador abre y cierra el turno únicamente desde Planillas; esa apertura crea el turno compartido en SQLite para barra y meseros.
- Se separaron las interfaces operativas en `MeseroWorkspace.jsx` y `BarraWorkspace.jsx`. `RoleWorkspace.jsx` quedó como enrutador y `useTurnoData.js` centraliza la carga y polling del turno, productos y comandas. El módulo de administrador no fue alterado.
- La interfaz del mesero ahora organiza el catálogo por categorías, muestra stock y cantidades seleccionadas, y permite editar o cancelar comandas pendientes. Toda modificación solicita confirmación antes de actualizar la comanda y avisar a barra.
- El inventario operativo es compartido: `productos` en SQLite es la fuente única que administra el módulo Inventario del administrador y que consultan/actualizan barra y mesero durante el turno.
- Las comandas ya no usan mesa en la interfaz. Cada turno asigna un consecutivo a cada comanda, guarda el ID de la cuenta del mesero en `mesero_id` y su nombre de usuario en `mesero_nombre`; el rol no se usa para identificar pedidos. Cada cuenta consulta solo sus comandas. Barra puede desplegar los productos antes de autorizar.
- La cola de Barra normaliza la lista de meseros con `Map.values()` antes de ordenar; esto evita una excepción de renderizado que dejaba la pantalla en negro al tener comandas.
- La cola de Barra separa pedidos en pestañas por estado: pendientes de autorización, pagados y entregados, cancelados y otros; cada pestaña muestra su contador, conserva el filtro por mesero y los cancelados no se suman en ventas.
- Los pedidos pendientes de autorización se despliegan automáticamente al llegar a Barra, mostrando sus productos; cada uno puede ocultarse manualmente.
- Las filas de la cola de Barra usan las mismas columnas y espacios de acción fijos en todos los estados; el detalle de productos se expande debajo sin desplazar el resumen ni las filas vecinas. Las pestañas por estado y la comparación alineada de productos, cantidad solicitada, stock y subtotal se conservan en el layout actual.
- La navegación de escritorio usa una barra lateral contraíble; el área principal tiene un ancho máximo ampliado para aprovechar mejor pantallas grandes. La navegación móvil y sus pestañas inferiores se mantienen independientes.
- La preferencia de contraer la barra lateral se conserva entre recargas. La interfaz usa una identidad oscura de carbón con acentos ámbar/violeta, cabecera de contexto en escritorio, superficies diferenciadas y estados de foco/hover; las transiciones respetan la preferencia del sistema para reducir movimiento.
- La sección de Promociones presenta resumen de ofertas, guía de tipos, formulario destacado y tarjetas que distinguen 2×1, cortesía, combo y precio especial, conservando creación, activación/pausa y eliminación.
- En el compositor del mesero, las ofertas tienen tarjetas compactas codificadas por tipo, descripción legible y botón claro para agregarlas al pedido; en móviles se recorren horizontalmente.
- El catálogo de productos del mesero usa búsqueda accesible, filtros de categoría con cantidades, tarjetas táctiles con precio/stock/promoción/cantidad seleccionada y estado vacío con acción para limpiar filtros; las tarjetas continúan usando `addItem` y respetan el stock.
- Las comandas no se imprimen cuando el mesero las envía ni cuando las edita; se imprimen en `Printer001` cuando Barra pulsa «Autorizar y entregar». Al entregar, las cortesías explícitamente registradas se descuentan y separan de las ventas en movimientos distintos; las promociones ya no agregan regalos automáticamente. La comanda queda pagada, sin solicitar ni registrar un medio de pago. Planillas refleja esos movimientos, permitiendo ajustar manualmente la cantidad de cortesías sin que la sincronización la restablezca. Una falla de impresora se informa sin revertir la entrega. Las comandas pagadas conservan además el botón para reimprimir el comprobante. El servidor valida que la cuenta autenticada sea la de Barra asignada al turno y envía los trabajos en cola por Bluetooth Serial Port COM3 (9600 baudios por defecto; `PRINTER_PORT` y `PRINTER_BAUD_RATE` permiten ajustar el enlace).
- Las métricas «Ventas» de los espacios de Mesero y Barra suman únicamente comandas en estado pagada (autorizadas y entregadas); las pendientes, canceladas y otros estados no se contabilizan.
- El ticket de 80 mm se titula «COMANDA», no imprime forma de pago, subtotal ni agradecimiento, y usa fuente térmica estándar de 42 caracteres conservando CR/LF. La tabla ahora usa esa misma fuente estándar, más grande que la compacta anterior, y se ajusta a 42 caracteres con margen de dos espacios; mantiene las columnas de producto, cantidad y total, calcula ancho dinámico para cantidades e importes en pesos (`$`) y envuelve nombres largos. Muestra el total general. La fecha y hora se formatean explícitamente en `America/Bogota` para no depender de la zona horaria del computador servidor. Solo el nombre del negocio se imprime en negrita; la copia de Barra se identifica en el pie y se alimentan tres líneas antes del corte.
- Los errores de impresión distinguen el endpoint no disponible (404, backend que requiere reinicio/actualización) de la impresora desconectada o el puerto Bluetooth ocupado (503), con instrucciones comprensibles para el mesero.
- La vista de Inventario destaca productos totales, bajo mínimo, agotados y con existencias suficientes; las métricas permiten filtrar por estado y la tabla muestra stock relativo, mínimo, precio y alertas con diseño adaptable. Se conserva la edición inline y Excel; tipografía, controles y espaciado se ampliaron ligeramente para mejorar la lectura.
- Mientras exista un turno abierto, el módulo Inventario bloquea edición de precios, productos, importación, eliminación y reordenamiento. En la planilla, Gerencia puede corregir la columna «Inicio»; la misma diferencia se aplica a las existencias actuales para preservar las salidas ya calculadas, sin registrar un movimiento ni una novedad. Si no se puede verificar el estado del turno, la edición se bloquea por seguridad.
- En el inventario del administrador se puede cambiar el orden manteniendo presionada el asa de arrastre y soltando cada producto en su nueva posición; el orden se guarda en `productos.sort_order`, se conserva al cargar y es el que ve el mesero en su catálogo. El catálogo vuelve a consultar productos durante su actualización periódica para reflejar los cambios sin recargar.
- El registro de Gastos guarda descripciones en la columna SQLite `desc`, adjunta comprobantes de imagen JPEG comprimidos y persistidos como datos, permite revisar las imágenes guardadas y filtrar el historial por texto, categoría, fechas y estado de cierre. Los gastos incluidos en cierres se conservan visibles y no se pueden borrar desde esta pantalla.
- En «Registro manual», al elegir la categoría Insumos se pueden agregar varias filas de compra, cada una con un producto existente o nuevo, cantidad y costo unitario de compra. El total se calcula por suma de cantidad × costo unitario y el historial conserva el desglose por producto. Los productos nuevos requieren nombre, categoría, precio de venta y stock mínimo; el gasto único, sus detalles, todos los cambios de inventario y movimientos de entrada se guardan juntos en una transacción. Esta operación se bloquea mientras haya un turno abierto y también se valida en el servidor.
- El administrador puede eliminar un negocio desde la barra lateral; exige escribir el nombre y confirmar una segunda vez. La API borra en una transacción el negocio y sus datos operativos e históricos asociados, y quita el negocio de las asignaciones explícitas de usuarios.
- Al desplegar una comanda en barra, cada producto se compara con el stock actual de `productos`, mostrando cantidad solicitada, existencia disponible y alerta de faltante. La autorización se bloquea visualmente si algún producto no alcanza, además de conservar la validación al guardar.
- Los renglones de comanda guardan las promociones aplicadas y Barra identifica su tipo (2×1, precio especial, combo, cortesía o producto + cortesía). Los pedidos existentes sin ese dato conservan una etiqueta genérica «Promoción».
- La pantalla de Barra ya no incluye el registro de entradas urgentes de inventario. Los registros históricos con estado `entregada_falta_pago` se muestran como pedidos anteriores; las comandas nuevas pasan directamente a `pagada` al entregarse.
- Administración tiene una vista de Comandas con filtro por estado, productos y marcas de tiempo de creación, autorización, entrega y pago.
- El mesero envía comandas sin medio de pago y no puede modificar ni cancelar pedidos enviados. La API bloquea sus operaciones de actualización y eliminación; los productos solo se admiten una vez al crear una comanda propia. Barra autoriza y entrega sin selector ni validación de pago; la comanda pasa a pagada y el campo legado de medio de pago no se expone a estos roles.
- En Barra, Mis comandas y el detalle de Planilla, las listas de pagados/entregados y cancelados muestran ocho comandas por página en una cuadrícula de dos columnas; las pestañas adicionales aparecen cuando se supera ese límite. Las listas de pedidos en espera de Barra y pendientes por autorizar conservan su presentación sin paginación.
- Se retiró la asociación automática heredada de productos a agua, Gatorade o gaseosa desde el cierre de Planillas. Las relaciones comerciales ahora se administran en el módulo **Promociones** del administrador y se guardan en SQLite (`promociones`).
- La pantalla inicial de Planillas del administrador presenta por separado la apertura del turno y el historial de cierres. El historial muestra por defecto las planillas de la semana actual (lunes a domingo) y permite alternar a todos los cierres anteriores; se ordena del más reciente al más antiguo, permite buscar por fecha/horario y filtrar por rango de fechas, muestra hasta 10 planillas por página y ofrece acceso al detalle y a la descarga del PDF. El historial de solo lectura de Dueño aplica el mismo filtro semanal y conserva la opción de consultar cierres anteriores. El detalle carga comandas asociadas al turno de cierre o a la fecha del turno, permite filtrarlas por mesero y por pestañas de estado (todos, pendientes por autorizar, pagados/entregados, cancelados y otros), con tarjetas y productos basados en la presentación del listado de Barra. Muestra errores de carga en pantalla; su selector tolera meseros o comandas con datos incompletos para evitar bloquear el renderizado. Las fechas y horas se guardan y visualizan con referencia a `America/Bogota`, interpretando correctamente las marcas SQLite que están en UTC.
- La apertura de planilla conserva el flujo normal de selección de personal. La autorización de cuentas de mesero se gestiona desde un módulo de Barra durante el turno: se inicia sin meseros habilitados, Barra puede activar o desactivar cuentas asociadas al negocio y la selección se persiste en `turnos.meseros_ids`. La pestaña «Personal» actualiza automáticamente, cada 1,5 segundos, el total por cuenta sumando las comandas pagadas del turno; las ventas y comisiones se muestran como valores automáticos no editables. El resumen incluye también a quienes tengan ventas pagadas aunque luego se desactive su acceso. Barra admite una comisión porcentual sobre ventas o un pago fijo. El DJ conserva su pago fijo. En «Otros pagos», Seguridad permite agregar personas con nombre y pago individual, y el botón «Agregar otro rol» permite registrar temporalmente otros nombres de rol, persona y pago. Los roles agregados se incluyen en el cierre actual, pero no se guardan como personal permanente y se eliminan al iniciar un nuevo turno. Los detalles y subtotales se reflejan en el total de personal y en el cierre. El espacio de mesero solo carga catálogo/comandas y permite operar si su cuenta está habilitada. Sin turno abierto o sin autorización se muestra un mensaje de acceso bloqueado.
- Al abrir planilla, el gerente debe elegir una cuenta con rol Barra asignada al negocio. Su ID se guarda en `turnos.barra_id`; la API limita la lectura y modificación del turno a esa cuenta, y las demás cuentas de Barra quedan bloqueadas para ese turno.
- El comando `npm run build:portable` genera `release/GestionBar.exe`, un ejecutable Windows x64 que incluye Node.js, Express y el frontend; al abrirlo inicia el servidor y el navegador sin requerir Node/npm/Visual Studio en el equipo de destino. El ejecutable mantiene la consola abierta para el servidor y usa `%LOCALAPPDATA%\GestionBar\data\gestionbar.sqlite` como base de datos independiente de cada equipo. El empaquetado no incluye la base de datos de desarrollo ni migra los datos del negocio. Para crearlo se requiere Node.js 24 x64 y conexión a Internet durante la descarga inicial del runtime.
- Los perfiles de administrador y gerente incluyen **Compartir acceso** en el menú móvil y en la barra lateral de escritorio. El backend permite a ambos consultar las direcciones IPv4 del equipo servidor y compartir enlaces con meseros y barra; ambos roles entran por el mismo enlace y su cuenta determina el espacio disponible. Los dispositivos deben estar en la misma red local que el servidor.
- Las comandas se consultan entre dispositivos con sondeo secuencial cada segundo. Al editar una comanda, el mesero guarda primero los productos y luego marca `comandas.actualizada_en`; Barra detecta esa revisión y vuelve a cargar los productos de la comanda para reflejar los cambios sin reiniciar. La columna `actualizada_en` se migra al iniciar el backend.
- Bancos en Planillas registra cada transferencia con mesero activo, banco, monto y referencia opcional; la foto comprimida del comprobante es opcional. El detalle se guarda en `transferencias` con `turno_id` y, al cerrar, se vincula mediante `planilla_id`; la vista histórica muestra el mesero, banco, fecha, valor y foto cuando se adjuntó. El total por banco se conserva en `banco_detalle` para no romper reportes. Los comprobantes consultados se cargan desde SQLite y no se duplican en `localStorage`.
- Barra incluye la pestaña **Ingresos** junto a la Cola de Barra. Permite ingresar uno o más productos ya existentes con su cantidad y un motivo predefinido (**Solicitud a proveedor** o **Préstamo**); una operación transaccional actualiza el stock, registra movimientos `entrada` vinculados al turno y guarda una novedad con hora, descripción, productos y cantidades. Planillas suma esas entradas en la columna **Entradas** sin volverlas a agregar al stock al cerrar y muestra el detalle en **Novedades**.
- Barra puede marcar una comanda pendiente como «No autorizada por Barra». El pedido sale de pendientes y aparece en «Otros estados» tanto para Barra como para el mesero; no se borra y sigue disponible en historial e informes. Solo la cuenta de Barra asignada al turno abierto puede realizar el cambio.
- Promociones permite crear, activar, pausar y eliminar reglas 2×1, precio especial, combos y producto + cortesía, aplicables a un producto o a toda una categoría. Para una cortesía se puede seleccionar cualquier producto del inventario, y las tarjetas permiten reasignar el regalo de promociones cuyo producto fue eliminado. En el espacio del mesero, Pedidos y Promociones tienen pestañas propias en la navegación. Ninguna promoción de cortesía se agrega automáticamente al carrito, a la comanda ni al inventario al entregar pedidos; las reglas de precio especial, 2×1 y combos siguen disponibles. Los datos históricos de cortesías ya registradas se conservan.
- Reportes permite filtrar por fecha inicial y final y presenta una tabla de pagos de personal con una columna por cada día del rango y una fila por persona, incluyendo el personal de Seguridad.
- En el detalle de planillas cerradas, «Planilla cerrada», «Comandas de la noche» y «Novedades» son pestañas independientes para Gerencia y Dueño.
- El módulo de promociones también admite precio especial y combos de varios productos/cantidades con precio único; las promociones activas se muestran al mesero y los combos se agregan directamente a su carrito.

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
3. Persistencia de imágenes de comprobantes en los módulos distintos a Gastos y Bancos.
4. Probar restauración/importación de SQLite desde una copia automática válida.
5. Migración completa de módulos antiguos.
6. Pruebas integrales con varios dispositivos y roles.
7. Verificación completa de productos y stock antes del conteo de apertura.

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

## 8. Roles y autorización de equipos

- El correo reservado del administrador maestro es `mdmm1100@gmail.com`. Solo se crea en el primer inicio autorizado y desde el propio computador servidor; requiere contraseña de al menos 12 caracteres. El administrador maestro administra usuarios, negocios y enlaces de red.
- Las cuentas antiguas con rol `admin`/`administrador`, excepto el correo reservado, migran a `gerente`. El gerente conserva la operación diaria, mientras barra y meseros mantienen sus roles. La interfaz no permite crear otra cuenta maestra ni modificar su correo o rol.
- Cada instalación portable requiere una licencia Ed25519 firmada para el `MachineGuid` del computador Windows. El destino descarga una solicitud JSON; el administrador la firma con `npm run license:authorize -- solicitud.json licencia.json` y devuelve la licencia por USB para instalarla en el destino.
- La clave privada se conserva fuera del repositorio y del ejecutable en `%LOCALAPPDATA%\GestionBar\licensing\private-key.pem`; debe respaldarse de forma segura y nunca compartirse. La clave pública está en `backend/license.js`.
- Las licencias/datos del ejecutable residen bajo `%LOCALAPPDATA%\GestionBar`. La activación offline impide el uso normal de una copia sin autorización, pero no es una protección absoluta frente a modificación deliberada del ejecutable o clonación completa del entorno de Windows.

## 9. Detalle de turnos cerrados

- El detalle histórico de cada planilla cerrada está separado en las pestañas «Planilla cerrada» y «Novedades», tanto para gerencia como para el rol de jefe. La pestaña de planilla muestra el inventario, pagos de personal, gastos y resumen financiero guardados, además de comandas y transferencias.
- La pestaña de novedades muestra los registros asociados a los turnos de la planilla, con hora local, además de las novedades de apertura/cierre y la nota histórica guardada en la planilla cuando exista.
- Si falla la consulta de novedades, se informa el error en la pestaña en lugar de presentar la carga como exitosa.

## 10. Ajustes de inventario con turno abierto

- Gerencia puede editar el inventario inicial desde la columna «Inicio» de la planilla abierta. Al guardar, se actualiza el inventario inicial del turno y se ajustan en el mismo sentido las existencias actuales para conservar las salidas; no se crea un registro de ajuste. Precios, productos nuevos, eliminación e importación siguen bloqueados hasta cerrar el turno.
- El backend valida rol, negocio, turno abierto, cantidades enteras y existencia del producto; persiste cada diferencia como movimiento `ajuste` y agrega una novedad fechada al turno en una misma transacción.
- La planilla activa integra esos movimientos en existencias, salidas e informe de cierre sin clasificarlos como ventas; el detalle histórico y el PDF muestran la columna de ajustes.
