import { useEffect, useMemo, useState } from "react";
import { C, s, COP } from "../../constants/theme.js";
import {
  localDelete,
  localFetch,
  localInsert,
  localUpdate,
} from "../../lib/localApi.js";
import { uid } from "../../utils/helpers.js";
import { Badge, Metric, SectionTitle } from "../common/index.jsx";
import { useTurnoData } from "../../hooks/useTurnoData.js";

const STATUS_LABEL = {
  enviada: "Esperando autorización",
  entregada_falta_pago: "Entregado · falta pago",
  pagada: "Pagado",
  cancelada: "Cancelado",
};

const STATUS_COLOR = {
  enviada: C.amber,
  pagada: C.green,
  cancelada: C.red,
};

const formatTime = value =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export default function MeseroWorkspace({ negocio, userName, userId }) {
  const { turno, comandas, setComandas, productos } =
    useTurnoData(negocio.id, userId);

  const [productSearch, setProductSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [promociones, setPromociones] = useState([]);

  useEffect(() => {
    let active = true;
    localFetch("promociones", `negocio_id=eq.${negocio.id}&activo=eq.true&select=*`).then(rows => {
      if (active) setPromociones(rows || []);
    });
    return () => { active = false; };
  }, [negocio.id]);

  const categories = useMemo(
    () => [
      "Todos",
      ...new Set(
        productos.map(product => product.cat).filter(Boolean)
      ),
    ],
    [productos]
  );

  const visibleProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();

    return productos.filter(product => {
      const name = String(product.name || "").toLowerCase();

      const matchesSearch =
        !search || name.includes(search);

      const matchesCategory =
        selectedCategory === "Todos" ||
        product.cat === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [productos, productSearch, selectedCategory]);

  const getPromotion = productId => promociones.find(promotion =>
    ["2x1", "precio_especial"].includes(promotion.tipo) && promotion.producto_principal_id === productId
  );

  const itemDiscount = item => {
    const promotion = getPromotion(item.producto_id);
    if (!promotion) return Number(item.comboDiscount || 0);
    const unitPrice = Number(item.precio_unitario || 0);
    if (promotion.tipo === "precio_especial") return Math.max(0, unitPrice - Number(promotion.precio_promocional || 0)) * Number(item.cantidad || 0) + Number(item.comboDiscount || 0);
    const groupSize = Math.max(2, Number(promotion.cantidad_compra) || 2);
    return Math.floor(Number(item.cantidad || 0) / groupSize) * (groupSize - 1) * unitPrice + Number(item.comboDiscount || 0);
  };

  const itemTotal = item => Number(item.precio_unitario || 0) * Number(item.cantidad || 0) - itemDiscount(item);

  const cartTotal = items.reduce((sum, item) => sum + itemTotal(item), 0);

  const itemsCount = items.reduce(
    (sum, item) => sum + Number(item.cantidad || 0),
    0
  );

  const ventasTotal = comandas.reduce(
    (sum, comanda) => sum + Number(comanda.total || 0),
    0
  );

  const pendingOrders = comandas.filter(
    comanda => comanda.estado === "enviada"
  ).length;

  const availableProducts = visibleProducts.filter(
    product => Number(product.stock || 0) > 0
  ).length;

  const addItem = product => {
    if (Number(product.stock || 0) < 1 || busy) return;

    setItems(current => {
      const existing = current.find(
        item => item.producto_id === product.id
      );

      if (existing) {
        if (
          existing.cantidad >= Number(product.stock || 0)
        ) {
          return current;
        }

        return current.map(item =>
          item.producto_id === product.id
            ? {
                ...item,
                cantidad: item.cantidad + 1,
              }
            : item
        );
      }

      return [
        ...current,
        {
          producto_id: product.id,
          nombre: product.name,
          cantidad: 1,
          precio_unitario: Number(product.price || 0),
        },
      ];
    });

    setMessage("");
  };

  const changeQty = (productId, delta) => {
    setItems(current =>
      current
        .map(item =>
          item.producto_id === productId
            ? {
                ...item,
                cantidad: item.cantidad + delta,
              }
            : item
        )
        .filter(item => item.cantidad > 0)
    );
  };

  const removeItem = productId => {
    setItems(current =>
      current.filter(item => item.producto_id !== productId)
    );
  };

  const promotionItems = promotion => {
    if (Array.isArray(promotion.productos_combo)) return promotion.productos_combo;
    try { return JSON.parse(promotion.productos_combo || "[]"); } catch { return []; }
  };

  const addPromotion = promotion => {
    const components = promotion.tipo === "combo"
      ? promotionItems(promotion)
      : [
        { producto_id: promotion.producto_principal_id, cantidad: promotion.cantidad_compra || 1 },
        ...(promotion.tipo === "cortesia" && promotion.producto_cortesia_id
          ? [{ producto_id: promotion.producto_cortesia_id, cantidad: promotion.cantidad_cortesia || 1, cortesia: true }]
          : []),
      ];
    if (busy || !components.length || (promotion.tipo === "combo" && components.length < 2)) return;
    const valid = components.every(component => {
      const product = productos.find(item => item.id === component.producto_id);
      const alreadyInCart = items.find(item => item.producto_id === component.producto_id)?.cantidad || 0;
      return product && Number(product.stock || 0) >= alreadyInCart + Number(component.cantidad || 0);
    });
    if (!valid) { setMessage("No hay existencias suficientes para agregar este combo."); return; }
    const regularTotal = components.reduce((sum, component) => sum + Number(component.cantidad || 0) * Number(productos.find(item => item.id === component.producto_id)?.price || 0), 0);
    const discount = promotion.tipo === "combo"
      ? Math.max(0, regularTotal - Number(promotion.precio_promocional || 0))
      : 0;
    setItems(current => {
      const next = current.map(item => ({ ...item }));
      components.forEach((component, index) => {
        const product = productos.find(item => item.id === component.producto_id);
        const existing = next.find(item => item.producto_id === component.producto_id);
        if (existing) {
          existing.cantidad += Number(component.cantidad || 0);
          if (index === 0) existing.comboDiscount = Number(existing.comboDiscount || 0) + discount;
          if (component.cortesia) existing.comboDiscount = Number(existing.comboDiscount || 0) + Number(component.cantidad || 0) * Number(product.price || 0);
        } else next.push({ producto_id: product.id, nombre: product.name, cantidad: Number(component.cantidad || 0), precio_unitario: Number(product.price || 0), comboDiscount: index === 0 ? discount : component.cortesia ? Number(component.cantidad || 0) * Number(product.price || 0) : 0 });
      });
      return next;
    });
    setMessage(`✓ ${promotion.nombre} agregado al pedido.`);
  };

  const clearComposer = () => {
    setItems([]);
    setEditingId(null);
    setMessage("");
  };

  const startEdit = async comanda => {
    if (comanda.estado !== "enviada" || busy) return;

    const confirmed = window.confirm(
      `Vas a modificar la comanda #${comanda.consecutivo || "?"}.\n\n` +
        "Barra recibirá nuevamente el pedido con los cambios realizados.\n\n" +
        "¿Deseas continuar?"
    );

    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    const details = await localFetch(
      "comanda_items",
      `comanda_id=eq.${comanda.id}&select=*`
    );

    if (!details) {
      setMessage(
        "No fue posible cargar los productos de esta comanda."
      );
      setBusy(false);
      return;
    }

    const productById = new Map(
      productos.map(product => [product.id, product])
    );

    setItems(
      details
        .map(item => ({
          id: item.id,
          producto_id: item.producto_id,
          nombre:
            productById.get(item.producto_id)?.name ||
            "Producto no disponible",
          cantidad: Number(item.cantidad || 0),
          precio_unitario: Number(
            item.precio_unitario || 0
          ),
        }))
        .filter(item => item.cantidad > 0)
    );

    setEditingId(comanda.id);

    setMessage(
      `Editando la comanda #${comanda.consecutivo || "?"}. Revisa los productos antes de guardar.`
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });

    setBusy(false);
  };

  const saveItems = async comandaId => {
    const previous = await localFetch(
      "comanda_items",
      `comanda_id=eq.${comandaId}&select=*`
    );

    if (!previous) return false;

    const currentIds = new Set(
      items.map(item => item.id).filter(Boolean)
    );

    const removed = previous.filter(
      item => !currentIds.has(item.id)
    );

    for (const item of removed) {
      if (
        !(await localDelete("comanda_items", {
          id: item.id,
        }))
      ) {
        return false;
      }
    }

    for (const item of items) {
      const payload = {
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        descuento: itemDiscount(item),
      };

      const ok = item.id
        ? await localUpdate(
            "comanda_items",
            { id: item.id },
            payload
          )
        : await localInsert("comanda_items", {
            id: uid(),
            comanda_id: comandaId,
            producto_id: item.producto_id,
            cantidad: item.cantidad,
            precio_unitario: item.precio_unitario,
            descuento: itemDiscount(item),
          });

      if (!ok) return false;
    }

    return true;
  };

  const submit = async () => {
    if (
      !turno ||
      !items.length ||
      busy
    ) {
      return;
    }

    if (editingId) {
      const confirmed = window.confirm(
        `¿Guardar cambios en la comanda #${comandas.find(row => row.id === editingId)?.consecutivo || "?"}?\n\n` +
          "Barra será notificada de que el pedido fue modificado."
      );

      if (!confirmed) return;
    }

    setBusy(true);
    setMessage("");

    if (editingId) {
      const updated = await localUpdate(
        "comandas",
        { id: editingId },
        {
          subtotal: cartTotal,
          total: cartTotal,
        }
      );

      const detailsUpdated =
        updated && (await saveItems(editingId));

      if (!updated || !detailsUpdated) {
        setMessage(
          "No fue posible guardar todos los cambios de la comanda."
        );
      } else {
        setComandas(current =>
          current.map(row =>
            row.id === editingId
              ? {
                  ...row,
                  subtotal: cartTotal,
                  total: cartTotal,
                }
              : row
          )
        );

        clearComposer();
        setMessage(
          "✓ Comanda modificada y enviada nuevamente a barra."
        );
      }

      setBusy(false);
      return;
    }

    const staff = await localFetch(
      "staff",
      `negocio_id=eq.${negocio.id}&rol=eq.mesero&select=id,name&order=name.asc&limit=20`
    );

    const assigned = (staff || []).find(person => person.id === userId)
      || (staff || []).find(
        person =>
          person.name.toLowerCase() ===
          (userName || "").toLowerCase()
      ) || staff?.[0];

    if (!assigned) {
      setMessage(
        "No hay un mesero configurado para este negocio."
      );
      setBusy(false);
      return;
    }

    const comandaId = uid();
    const previous = await localFetch(
      "comandas",
      `turno_id=eq.${turno.id}&select=consecutivo`
    );
    const consecutivo = (previous || []).reduce(
      (max, row) => Math.max(max, Number(row.consecutivo) || 0),
      0
    ) + 1;

    const created = await localInsert("comandas", {
      id: comandaId,
      turno_id: turno.id,
      mesa: "",
      mesero_id: assigned.id,
      mesero_nombre: assigned.name,
      consecutivo,
      estado: "enviada",
      subtotal: cartTotal,
      total: cartTotal,
    });

    const detailCreated =
      created &&
      (await localInsert(
        "comanda_items",
        items.map(item => ({
          id: uid(),
          comanda_id: comandaId,
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          descuento: itemDiscount(item),
        }))
      ));

    if (!created || !detailCreated) {
      setMessage(
        "No fue posible guardar la comanda."
      );
    } else {
      setComandas(current => [
        {
          id: comandaId,
          turno_id: turno.id,
          mesa: "",
          mesero_id: assigned.id,
          mesero_nombre: assigned.name,
          consecutivo,
          estado: "enviada",
          total: cartTotal,
          creado_en: new Date().toISOString(),
        },
        ...current,
      ]);

      clearComposer();

      setMessage(
        "✓ Pedido enviado a barra correctamente."
      );
    }

    setBusy(false);
  };

  const cancel = async comanda => {
    if (
      busy ||
      comanda.estado !== "enviada"
    ) {
      return;
    }

    const confirmed = window.confirm(
      `¿Cancelar la comanda #${comanda.consecutivo || "?"}?\n\n` +
        "Barra será notificada de la cancelación."
    );

    if (!confirmed) return;

    setBusy(true);
    setMessage("");

    const ok = await localUpdate(
      "comandas",
      { id: comanda.id },
      {
        estado: "cancelada",
        confirmado_en: new Date().toISOString(),
      }
    );

    if (ok) {
      setComandas(current =>
        current.map(row =>
          row.id === comanda.id
            ? {
                ...row,
                estado: "cancelada",
              }
            : row
        )
      );

      if (editingId === comanda.id) {
        clearComposer();
      }

      setMessage("Pedido cancelado correctamente.");
    } else {
      setMessage(
        "No fue posible cancelar el pedido."
      );
    }

    setBusy(false);
  };

  const confirmPayment = async (comanda, paid, method = paymentMethods[comanda.id] || "efectivo") => {
    if (busy || comanda.estado !== "entregada_falta_pago") return;
    if (paid && !["efectivo", "tarjeta", "transferencia"].includes(method)) {
      setMessage("Selecciona el medio de pago.");
      return;
    }
    setBusy(true);
    setMessage("");
    const now = new Date().toISOString();
    const payment = paid
      ? await localInsert("pagos", {
          id: uid(),
          comanda_id: comanda.id,
          tipo: method,
          monto: comanda.total,
          verificado: true,
        })
      : true;
    const updated = payment && await localUpdate("comandas", { id: comanda.id }, {
      estado: paid ? "pagada" : "entregada_falta_pago",
      pago_confirmado: paid,
      modo_pago: paid ? method : null,
      pago_registrado_por: userId || userName || null,
      pago_registrado_en: now,
      pagado_en: paid ? now : null,
    });
    if (updated) {
      setComandas(current => current.map(row => row.id === comanda.id
        ? { ...row, estado: paid ? "pagada" : "entregada_falta_pago", pago_confirmado: paid, pago_registrado_en: now }
        : row));
      setMessage(paid ? "✓ Pago confirmado y comanda cerrada." : "Pago marcado como pendiente.");
    } else {
      setMessage("No fue posible actualizar el estado del pago.");
    }
    setBusy(false);
  };

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        paddingBottom: 30,
      }}
    >
      <SectionTitle>
        🧾 Mi turno — {negocio.name}
      </SectionTitle>

      <p
        style={{
          color: C.sub,
          fontSize: 13,
          marginTop: -10,
          marginBottom: 16,
        }}
      >
        Crea pedidos rápidamente tocando los productos.
        Revisa el carrito y envíalo a barra cuando esté
        listo.
      </p>

      {/* RESUMEN DEL TURNO */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(145px,1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Metric
          label="Turno"
          value={
            turno ? "Abierto" : "Sin turno"
          }
          color={
            turno ? C.green : C.red
          }
          icon="⏱"
        />

        <Metric
          label="Mis pedidos"
          value={comandas.length}
          color={C.amber}
          icon="🧾"
        />

        <Metric
          label="Pendientes"
          value={pendingOrders}
          color={C.amber}
          icon="⏳"
        />

        <Metric
          label="Ventas"
          value={COP(ventasTotal)}
          color={C.green}
          icon="💰"
        />
      </div>

      {promociones.length > 0 && (
        <div className="waiter-promotions">
          <div className="waiter-promotions__title">🏷️ Promociones activas</div>
          <div className="waiter-promotions__list">
            {promociones.map(promotion => {
              const main = productos.find(product => product.id === promotion.producto_principal_id)?.name || "Producto";
              const combo = promotion.tipo === "combo" ? promotionItems(promotion).map(item => `${item.cantidad}× ${productos.find(product => product.id === item.producto_id)?.name || "Producto"}`).join(" + ") : "";
              const text = promotion.tipo === "2x1" ? `${main}: lleva ${promotion.cantidad_compra || 2}, paga 1` : promotion.tipo === "precio_especial" ? `${main}: ${COP(promotion.precio_promocional)}` : promotion.tipo === "combo" ? `${combo} · ${COP(promotion.precio_promocional)}` : `${main} + cortesía`;
              return <div key={promotion.id} className="waiter-promotion"><strong>{promotion.tipo === "combo" ? "🍻 Combo" : promotion.tipo === "cortesia" ? "🎁 Cortesía" : promotion.tipo === "2x1" ? "2×1" : "Precio especial"}</strong><span>{promotion.nombre} · {text}</span><button type="button" disabled={busy} onClick={() => addPromotion(promotion)}>Agregar</button></div>;
            })}
          </div>
        </div>
      )}

      {/* COMPOSITOR */}
      <div
        style={{
          ...s.card,
          marginBottom: 18,
          padding: 0,
          overflow: "hidden",
        }}
      >
        {/* CABECERA */}
        <div
          style={{
            padding: "16px 16px 12px",
            borderBottom: `1px solid ${C.border || "rgba(255,255,255,.08)"}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 18,
                }}
              >
                {editingId
                  ? "✏️ Editando pedido"
                  : "🛒 Nuevo pedido"}
              </div>

              <div
                style={{
                  color: C.sub,
                  fontSize: 12,
                  marginTop: 3,
                }}
              >
                {editingId
                  ? "Los cambios serán enviados nuevamente a barra."
                  : "Agrega productos y envía la comanda cuando esté lista."}
              </div>
            </div>

            {editingId && (
              <button
                type="button"
                onClick={clearComposer}
                disabled={busy}
                style={{
                  ...s.btn("ghost"),
                  padding: "7px 11px",
                }}
              >
                Salir de edición
              </button>
            )}
          </div>

          {/* ALERTA DE EDICIÓN */}
          {editingId && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background:
                  "rgba(255,193,7,.10)",
                border:
                  "1px solid rgba(255,193,7,.28)",
                color: C.amber,
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              ⚠️ <strong>Pedido en edición.</strong>{" "}
              Al guardar, barra recibirá el cambio
              realizado sobre esta comanda.
            </div>
          )}
        </div>

        <div style={{ padding: 16 }}>
          {/* BUSCADOR */}
          <div
            style={{
              position: "relative",
              marginBottom: 12,
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 17,
                pointerEvents: "none",
              }}
            >
              🔎
            </span>

            <input
              style={{
                ...s.inp,
                width: "100%",
                paddingLeft: 40,
                fontSize: 15,
              }}
              placeholder="Buscar producto..."
              value={productSearch}
              onChange={event =>
                setProductSearch(
                  event.target.value
                )
              }
              disabled={busy}
            />
          </div>

          {/* CATEGORÍAS */}
          <div
            style={{
              display: "flex",
              gap: 7,
              overflowX: "auto",
              paddingBottom: 8,
              marginBottom: 12,
              scrollbarWidth: "thin",
            }}
          >
            {categories.map(category => {
              const active =
                selectedCategory === category;

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() =>
                    setSelectedCategory(category)
                  }
                  disabled={busy}
                  style={{
                    flex: "0 0 auto",
                    border: active
                      ? `1px solid ${C.green}`
                      : `1px solid rgba(255,255,255,.10)`,
                    background: active
                      ? "rgba(0,210,100,.14)"
                      : "rgba(255,255,255,.035)",
                    color: active
                      ? C.green
                      : C.sub,
                    borderRadius: 999,
                    padding: "8px 13px",
                    fontSize: 12,
                    fontWeight: active ? 800 : 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {category}
                </button>
              );
            })}
          </div>

          {/* PRODUCTOS */}
          <div className="waiter-catalogue-summary">
            <div>
              <strong>Inventario disponible</strong>
              <span>{availableProducts} de {visibleProducts.length} productos para pedir</span>
            </div>
            <div className="waiter-catalogue-legend">
              <span><i className="is-available" />Disponible</span>
              <span><i className="is-low" />Pocas unidades</span>
              <span><i className="is-empty" />Agotado</span>
            </div>
          </div>
          <div
            className="waiter-product-grid"
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill,minmax(145px,1fr))",
              gap: 10,
            }}
          >
            {visibleProducts.map(product => {
              const selected = items.find(
                item =>
                  item.producto_id === product.id
              );

              const stock = Number(
                product.stock || 0
              );

              const outOfStock = stock < 1;
              const lowStock = !outOfStock && stock <= 3;
              const promotion = getPromotion(product.id);

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={
                    outOfStock || busy
                  }
                  onClick={() =>
                    addItem(product)
                  }
                  style={{
                    position: "relative",
                    textAlign: "left",
                    minHeight: 130,
                    borderRadius: 13,
                    padding: 13,
                    border: selected
                      ? `2px solid ${C.green}`
                      : "1px solid rgba(255,255,255,.09)",
                    background: selected
                      ? "linear-gradient(145deg, rgba(0,210,100,.16), rgba(0,210,100,.045))"
                      : "linear-gradient(145deg, rgba(255,255,255,.055), rgba(255,255,255,.018))",
                    opacity: outOfStock
                      ? 0.45
                      : 1,
                    cursor:
                      outOfStock || busy
                        ? "not-allowed"
                        : "pointer",
                    transition:
                      "transform .12s ease, border .12s ease, background .12s ease",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent:
                      "space-between",
                    gap: 8,
                  }}
                >
                  {selected && (
                    <span
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        minWidth: 28,
                        height: 28,
                        padding: "0 7px",
                        borderRadius: 999,
                        background: C.green,
                        color: "#06140c",
                        display: "flex",
                        alignItems: "center",
                        justifyContent:
                          "center",
                        fontSize: 13,
                        fontWeight: 900,
                      }}
                    >
                      {selected.cantidad}
                    </span>
                  )}

                  {promotion && (
                    <span style={{ position: "absolute", top: 9, left: 9, padding: "3px 6px", borderRadius: 6, background: "rgba(129,140,248,.22)", color: "#c7d2fe", fontSize: 9, fontWeight: 900 }}>
                      {promotion.tipo === "2x1" ? "2×1" : "Oferta"}
                    </span>
                  )}

                  <div
                    style={{
                      paddingRight: selected ? 28 : 0,
                      paddingTop: promotion ? 20 : 0,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 14,
                        lineHeight: 1.25,
                        minHeight: 36,
                        color: "#ffffff",
                      }}
                    >
                      {product.name}
                    </div>

                    {product.cat && (
                      <div
                        style={{
                          color: "#d1d5db",
                          fontSize: 10,
                          marginTop: 4,
                        }}
                      >
                        {product.cat}
                      </div>
                    )}
                  </div>

                  <div>
                    <div
                      style={{
                        color: C.green,
                        fontWeight: 900,
                        fontSize: 14,
                      }}
                    >
                      {COP(product.price)}
                    </div>

                    <div className={`waiter-product-stock ${outOfStock ? "is-empty" : lowStock ? "is-low" : "is-available"}`}>
                      <i />
                      {outOfStock ? "Agotado" : lowStock ? `Solo ${stock} unidades` : `${stock} disponibles`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!visibleProducts.length && (
            <div
              style={{
                textAlign: "center",
                padding: "28px 10px",
                color: C.sub,
                fontSize: 13,
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  marginBottom: 7,
                }}
              >
                🔎
              </div>
              No encontramos productos con
              esos criterios.
            </div>
          )}

          {/* CARRITO */}
          {items.length > 0 && (
            <div
              style={{
                marginTop: 18,
                borderRadius: 14,
                border:
                  "1px solid rgba(0,210,100,.20)",
                background:
                  "rgba(0,210,100,.045)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "13px 14px",
                  borderBottom:
                    "1px solid rgba(255,255,255,.07)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent:
                    "space-between",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontWeight: 800,
                    }}
                  >
                    🛒 Pedido actual
                  </div>

                  <div
                    style={{
                      color: C.sub,
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    {itemsCount} producto
                    {itemsCount === 1
                      ? ""
                      : "s"}{" "}
                    seleccionado
                    {itemsCount === 1
                      ? ""
                      : "s"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setItems([])
                  }
                  disabled={busy}
                  style={{
                    ...s.btn("ghost"),
                    padding: "6px 9px",
                    fontSize: 11,
                  }}
                >
                  Vaciar
                </button>
              </div>

              <div
                style={{
                  padding: "4px 14px",
                }}
              >
                {items.map(item => (
                  <div
                    key={item.producto_id}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "1fr auto",
                      gap: 8,
                      alignItems: "center",
                      padding:
                        "11px 0",
                      borderBottom:
                        "1px solid rgba(255,255,255,.06)",
                    }}
                  >
                    <div
                      style={{
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        {item.nombre}
                      </div>

                      <div
                        style={{
                          color: C.sub,
                          fontSize: 10,
                          marginTop: 2,
                        }}
                      >
                        {COP(
                          item.precio_unitario
                        )}{" "}
                        c/u
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems:
                          "center",
                        gap: 7,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          changeQty(
                            item.producto_id,
                            -1
                          )
                        }
                        disabled={busy}
                        style={{
                          width: 31,
                          height: 31,
                          borderRadius: 8,
                          border:
                            "1px solid rgba(255,255,255,.12)",
                          background:
                            "rgba(255,255,255,.04)",
                          color: C.text,
                          fontSize: 18,
                          cursor:
                            "pointer",
                        }}
                      >
                        −
                      </button>

                      <strong
                        style={{
                          minWidth: 22,
                          textAlign: "center",
                        }}
                      >
                        {item.cantidad}
                      </strong>

                      <button
                        type="button"
                        onClick={() =>
                          changeQty(
                            item.producto_id,
                            1
                          )
                        }
                        disabled={busy}
                        style={{
                          width: 31,
                          height: 31,
                          borderRadius: 8,
                          border:
                            "1px solid rgba(255,255,255,.12)",
                          background:
                            "rgba(255,255,255,.04)",
                          color: C.green,
                          fontSize: 18,
                          cursor:
                            "pointer",
                        }}
                      >
                        +
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          removeItem(
                            item.producto_id
                          )
                        }
                        disabled={busy}
                        aria-label={`Eliminar ${item.nombre}`}
                        style={{
                          width: 29,
                          height: 29,
                          marginLeft: 2,
                          border: "none",
                          background:
                            "transparent",
                          color: C.red,
                          fontSize: 15,
                          cursor:
                            "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </div>

                    <div
                      style={{
                        gridColumn:
                          "1 / -1",
                        textAlign: "right",
                        color: C.green,
                        fontWeight: 800,
                        fontSize: 12,
                        marginTop: -5,
                      }}
                    >
                      {itemDiscount(item) > 0 && <span style={{ color: C.purple, marginRight: 7, fontSize: 10 }}>Promoción aplicada</span>}
                      {COP(itemTotal(item))}
                    </div>
                  </div>
                ))}
              </div>

              {/* TOTAL */}
              <div
                style={{
                  padding: "13px 14px",
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                  background:
                    "rgba(0,0,0,.12)",
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                  }}
                >
                  Total del pedido
                </span>

                <strong
                  style={{
                    color: C.green,
                    fontSize: 20,
                  }}
                >
                  {COP(cartTotal)}
                </strong>
              </div>
            </div>
          )}

          {/* MENSAJE */}
          {message && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 9,
                background:
                  message.startsWith("✓")
                    ? "rgba(0,210,100,.08)"
                    : "rgba(255,70,70,.08)",
                border: message.startsWith("✓")
                  ? "1px solid rgba(0,210,100,.18)"
                  : "1px solid rgba(255,70,70,.18)",
                color: message.startsWith("✓")
                  ? C.green
                  : C.red,
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              {message}
            </div>
          )}

          {/* ACCIÓN PRINCIPAL */}
          <button
            type="button"
            disabled={
              busy ||
              !turno ||
              !items.length
            }
            onClick={submit}
            style={{
              ...s.btn("primary"),
              width: "100%",
              marginTop: 14,
              minHeight: 48,
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            {busy
              ? "Guardando..."
              : editingId
              ? "✏️ Guardar cambios y avisar a barra"
              : "🚀 Enviar pedido a barra"}
          </button>

          {!turno && (
            <div
              style={{
                textAlign: "center",
                color: C.red,
                fontSize: 11,
                marginTop: 8,
              }}
            >
              Debes tener un turno abierto
              para crear comandas.
            </div>
          )}
        </div>
      </div>

      {/* COMANDAS */}
      <div
        style={{
          ...s.card,
          padding: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "15px 16px",
            borderBottom:
              "1px solid rgba(255,255,255,.07)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 800,
                fontSize: 16,
              }}
            >
              📋 Mis comandas
            </div>

            <div
              style={{
                color: C.sub,
                fontSize: 11,
                marginTop: 2,
              }}
            >
              Pedidos realizados durante este
              turno
            </div>
          </div>

          <span
            style={{
              padding: "5px 9px",
              borderRadius: 999,
              background:
                "rgba(255,255,255,.05)",
              color: C.sub,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {comandas.length}
          </span>
        </div>

        <div style={{ padding: 12 }}>
          {!turno && (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: C.sub,
                fontSize: 13,
              }}
            >
              No hay turno abierto.
            </div>
          )}

          {turno && comandas.length === 0 && (
            <div
              style={{
                padding: "28px 15px",
                textAlign: "center",
                color: C.sub,
              }}
            >
              <div
                style={{
                  fontSize: 32,
                  marginBottom: 8,
                }}
              >
                🧾
              </div>

              <div
                style={{
                  fontWeight: 700,
                  color: C.text,
                  marginBottom: 4,
                }}
              >
                Aún no tienes comandas
              </div>

              <div
                style={{
                  fontSize: 12,
                }}
              >
                Selecciona productos y comienza
                a agregar la comanda.
              </div>
            </div>
          )}

          {comandas.map(comanda => {
            const isPending =
              comanda.estado === "enviada";

            const isEditing =
              editingId === comanda.id;

            return (
              <div
                key={comanda.id}
                style={{
                  borderRadius: 13,
                  border: isEditing
                    ? `1px solid ${C.amber}`
                    : "1px solid rgba(255,255,255,.08)",
                  background:
                    "rgba(255,255,255,.025)",
                  padding: 13,
                  marginBottom: 9,
                }}
              >
                {/* CABECERA COMANDA */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent:
                      "space-between",
                    gap: 10,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 15,
                      }}
                    >
                      Comanda #{comanda.consecutivo || "—"}
                    </div>

                    <div
                      style={{
                        color: C.sub,
                        fontSize: 10,
                        marginTop: 3,
                      }}
                    >
                      Mesero: {comanda.mesero_nombre || userName} · Pedido de las{" "}
                      {formatTime(
                        comanda.creado_en
                      )}
                    </div>
                  </div>

                  <Badge
                    color={
                      STATUS_COLOR[
                        comanda.estado
                      ] || C.sub
                    }
                    small
                  >
                    {STATUS_LABEL[
                      comanda.estado
                    ] || comanda.estado}
                  </Badge>
                </div>

                {/* TOTAL */}
                <div
                  style={{
                    display: "flex",
                    justifyContent:
                      "space-between",
                    alignItems: "center",
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop:
                      "1px solid rgba(255,255,255,.06)",
                  }}
                >
                  <span
                    style={{
                      color: C.sub,
                      fontSize: 11,
                    }}
                  >
                    Total
                  </span>

                  <strong
                    style={{
                      color: C.green,
                      fontSize: 16,
                    }}
                  >
                    {COP(comanda.total)}
                  </strong>
                </div>

                {/* ACCIONES */}
                {isPending && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "1fr 1fr",
                      gap: 8,
                      marginTop: 11,
                    }}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        startEdit(comanda)
                      }
                      style={{
                        ...s.btn("ghost"),
                        minHeight: 38,
                        fontSize: 12,
                      }}
                    >
                      ✏️ Modificar
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        cancel(comanda)
                      }
                      style={{
                        ...s.btn("danger"),
                        minHeight: 38,
                        fontSize: 12,
                      }}
                    >
                      ✕ Cancelar
                    </button>
                  </div>
                )}

                {comanda.estado === "entregada_falta_pago" && (
                  <div style={{ marginTop: 11, padding: 10, borderRadius: 9, background: "rgba(245,158,11,.10)", border: `1px solid ${C.amber}45` }}>
                    <div style={{ color: C.amber, fontSize: 12, marginBottom: 8 }}>
                      Barra entregó esta comanda. Confirma si el cliente realizó el pago.
                    </div>
                    <select
                      style={{ ...s.sel, width: "100%", marginBottom: 8 }}
                      value={paymentMethods[comanda.id] || "efectivo"}
                      onChange={event => setPaymentMethods(current => ({
                        ...current,
                        [comanda.id]: event.target.value,
                      }))}
                      disabled={busy}
                    >
                      <option value="efectivo">Pago en efectivo</option>
                      <option value="tarjeta">Pago con tarjeta</option>
                      <option value="transferencia">Pago por transferencia (API próximamente)</option>
                    </select>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button type="button" disabled={busy} onClick={() => confirmPayment(comanda, true)} style={{ ...s.btn("success"), minHeight: 38, fontSize: 12 }}>
                        ✓ Pago recibido
                      </button>
                      <button type="button" disabled={busy} onClick={() => confirmPayment(comanda, false)} style={{ ...s.btn("danger"), minHeight: 38, fontSize: 12 }}>
                        ✕ Falta pago
                      </button>
                    </div>
                  </div>
                )}

                {isEditing && (
                  <div
                    style={{
                      marginTop: 8,
                      color: C.amber,
                      fontSize: 10,
                      textAlign: "center",
                    }}
                  >
                    Esta comanda está siendo
                    modificada arriba.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
