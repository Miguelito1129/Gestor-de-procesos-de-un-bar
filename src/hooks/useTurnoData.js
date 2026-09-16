import { useEffect, useState } from "react";
import { localFetch } from "../lib/localApi.js";

export function useTurnoData(negocioId, meseroId = "") {
  const [turno, setTurno] = useState(null);
  const [comandas, setComandas] = useState([]);
  const [productos, setProductos] = useState([]);

  useEffect(() => {
    if (!negocioId) return undefined;
    let active = true;
    let poll;

    (async () => {
      const turnos = await localFetch(
        "turnos",
        `negocio_id=eq.${negocioId}&estado=eq.abierto&select=*&order=fecha_apertura.desc&limit=1`,
      );
      if (!active) return;
      if (!turnos?.[0]) {
        setTurno(null);
        setComandas([]);
        setProductos([]);
        return;
      }
      setTurno(turnos[0]);

      const [products, rows] = await Promise.all([
        localFetch("productos", `negocio_id=eq.${negocioId}&select=*&order=name.asc`),
        localFetch("comandas", `turno_id=eq.${turnos[0].id}${meseroId ? `&mesero_id=eq.${meseroId}` : ""}&select=*&order=creado_en.desc`),
      ]);
      if (active) {
        setProductos(products || []);
        setComandas(rows || []);
      }

      poll = window.setInterval(async () => {
        const latest = await localFetch(
          "comandas",
          `turno_id=eq.${turnos[0].id}${meseroId ? `&mesero_id=eq.${meseroId}` : ""}&select=*&order=creado_en.desc`,
        );
        if (active && latest) setComandas(latest);
      }, 3000);
    })();

    return () => {
      active = false;
      if (poll) window.clearInterval(poll);
    };
  }, [negocioId, meseroId]);

  return { turno, comandas, setComandas, productos, setProductos };
}
