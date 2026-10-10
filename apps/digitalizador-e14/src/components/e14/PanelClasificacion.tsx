"use client";

/**
 * Panel de corrección manual de ubicación (SPEC-cabecera-clasificacion §5).
 * Se muestra cuando el acta está EN_REVISION_HUMANA con clasificación
 * pendiente (§4.2: calidad OK pero la cabecera no llegó a AUTO) — la foto
 * era buena: lo único fallido fue leer la cabecera, y esto lo corrige el
 * operador en 5 toques.
 *
 * · Selects en cascada con datos de la base DIVIPOL: Departamento (34) →
 *   Municipio/PAÍS del dep → Zona del mun → Puesto de la zona → Mesa
 *   (1..countTable, input numérico) + toggle tipo TRANSMISIÓN/DELEGADOS +
 *   páginas 1/2 (2 deshabilitada si el formato es de 1 página — «Ver/Pag/de»).
 * · Cada select muestra «código — nombre» (p. ej. `335 — EGIPTO`).
 * · GUARDAR UBICACIÓN → store.guardarUbicacion (persiste nivel AUTO-manual,
 *   archiva el hueco Fase B §6 y pasa a flujo normal de envío).
 *   REPETIR FOTO → rescaneo actual.
 * · Sin base cargada (§1.3): los 5 campos como TEXTO LIBRE (degradación —
 *   nunca RECHAZADA por falta de base).
 *
 * Estilo: sistema de componentes del e14 (primitives + tokens; selects
 * nativos estilizados — touch ≥ 44 px, campos en max-h-96 con scroll).
 */
import { useEffect, useMemo, useState } from "react";
import { useE14Store } from "@/lib/e14/store";
import {
  cargarDivipol,
  departamentosDe,
  estadoDivipol,
  municipiosDe,
  puestosDe,
  zonasDe,
  type DivipolBase,
} from "@/lib/e14/divipol";
import type { ClasificacionE14, TipoCopia } from "@/lib/e14/clasificador";
import { CheckIcon, MapPinIcon, RefreshIcon } from "./icons";
import { PrimaryBtn } from "./primitives";

const CLASE_CAMPO =
  "w-full h-11 min-h-11 rounded-lg bg-surface-4 border border-outline-dim px-3 text-sm font-semibold text-ink " +
  "appearance-none cursor-pointer focus:outline-none focus:border-ok-tint/60 transition-colors";

const CLASE_LABEL = "label-caps !text-[10px] text-ink-dim mb-1 block";

function FilaCampo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={CLASE_LABEL}>{label}</span>
      {children}
    </label>
  );
}

/** Segmento (toggle tipo / página) — touch 44 px, estilo e14. */
function Segmento<T extends string | number>({
  opciones,
  valor,
  onCambiar,
  deshabilitadas = [],
}: {
  opciones: Array<{ valor: T; label: string }>;
  valor: T | "";
  onCambiar: (v: T) => void;
  deshabilitadas?: T[];
}) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${opciones.length}, minmax(0, 1fr))` }}>
      {opciones.map((o) => {
        const activo = valor === o.valor;
        const off = deshabilitadas.includes(o.valor);
        return (
          <button
            key={String(o.valor)}
            type="button"
            disabled={off}
            aria-pressed={activo}
            onClick={() => onCambiar(o.valor)}
            className={`h-11 min-h-11 rounded-lg border text-xs font-bold uppercase tracking-wide transition-all active:scale-[0.97] ${
              activo
                ? "border-ok-tint/60 bg-ok-tint/10 text-ok-tint"
                : off
                  ? "border-outline-dim bg-surface-4/50 text-ink-faint cursor-not-allowed"
                  : "border-outline-dim bg-surface-4 text-ink-dim"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PanelClasificacion() {
  const acta = useE14Store((s) => s.actaActual);
  const guardarUbicacion = useE14Store((s) => s.guardarUbicacion);
  const repetirFoto = useE14Store((s) => s.repetirFoto);

  const [base, setBase] = useState<DivipolBase | null>(null);
  const [dep, setDep] = useState("");
  const [mun, setMun] = useState("");
  const [zon, setZon] = useState("");
  const [std, setStd] = useState("");
  const [mesa, setMesa] = useState("");
  const [tipo, setTipo] = useState<TipoCopia | "">("");
  const [pag, setPag] = useState<1 | 2>(1);

  // §1.3: carga en arranque (idempotente, caché de módulo). Nunca falla:
  // base vacía → estado "fallo" → panel en texto libre.
  useEffect(() => {
    void cargarDivipol().then(setBase);
  }, []);

  // Precargar la sugerencia del clasificador (§5: "precargados con la
  // sugerencia SUGERIDA"). Sugerencia sin zona → deduce la zona del puesto
  // sugerido (misma regla 4 §3.3 del clasificador).
  const sugerencia = acta?.clasificacion;
  useEffect(() => {
    if (!sugerencia) return;
    setDep(sugerencia.departamento?.codigo ?? "");
    setMun(sugerencia.municipio?.codigo ?? "");
    setZon(sugerencia.zona?.codigo ?? "");
    setStd(sugerencia.puesto?.codigo ?? "");
    setMesa(sugerencia.mesa !== null ? String(sugerencia.mesa) : "");
    setTipo(sugerencia.tipo ?? "");
    setPag((sugerencia.pagina?.index ?? 1) === 2 ? 2 : 1);
  }, [sugerencia]);
  useEffect(() => {
    if (!base || !sugerencia) return;
    if (zon || !std) return;
    const dep2 = sugerencia.departamento?.codigo;
    const mun3 = sugerencia.municipio?.codigo;
    const std2 = sugerencia.puesto?.codigo;
    if (!dep2 || !mun3 || !std2) return;
    for (const z of zonasDe(base, dep2, mun3)) {
      if (puestosDe(base, dep2, mun3, z.codigo).some((p) => p.codigo === std2)) {
        setZon(z.codigo);
        return;
      }
    }
  }, [base, sugerencia, zon, std]);

  // Opciones en cascada (§5: hijos del padre ya resuelto).
  const deps = useMemo(() => (base ? departamentosDe(base) : []), [base]);
  const muns = useMemo(
    () => (base && dep ? municipiosDe(base, dep) : []),
    [base, dep],
  );
  const zonas = useMemo(
    () => (base && dep && mun ? zonasDe(base, dep, mun) : []),
    [base, dep, mun],
  );
  const puestos = useMemo(
    () => (base && dep && mun && zon ? puestosDe(base, dep, mun, zon) : []),
    [base, dep, mun, zon],
  );
  const mesasMax = useMemo(
    () => puestos.find((p) => p.codigo === std)?.mesas ?? 0,
    [puestos, std],
  );
  // «Ver/Pag/de»: total leído (default 2) — deshabilita la página 2 si el
  // formato de esta mesa es de 1 página.
  const totalPags = sugerencia?.pagina?.total ?? 2;

  const sinBase = base !== null && estadoDivipol() === "fallo";
  const mesaNum = Number.parseInt(mesa, 10);
  const completa = sinBase
    ? Boolean(dep && mun && zon && std && mesaNum >= 1 && tipo)
    : Boolean(dep && mun && zon && std && mesasMax > 0 && mesaNum >= 1 && mesaNum <= mesasMax && tipo);

  if (!acta) return null;

  const guardar = () => {
    let clasif: ClasificacionE14;
    if (sinBase) {
      // Degradación §1.3/§5: texto libre — códigos = lo escrito.
      clasif = {
        departamento: dep ? { codigo: dep, nombre: dep } : null,
        municipio: mun ? { codigo: mun, nombre: mun } : null,
        zona: zon ? { codigo: zon } : null,
        puesto: std ? { codigo: std, nombre: std } : null,
        mesa: Number.isFinite(mesaNum) ? mesaNum : null,
        tipo: (tipo || null) as TipoCopia | null,
        pagina: { index: pag, total: totalPags },
        kit: sugerencia?.kit ?? null,
        nivel: "AUTO",
        confianzas: { departamento: 1, municipio: 1, puesto: 1, tipo: 1 },
      };
    } else {
      const depObj = base?.[dep];
      const munObj = depObj?.m?.[mun];
      const puestoObj = puestos.find((p) => p.codigo === std);
      clasif = {
        departamento: depObj ? { codigo: dep, nombre: depObj.n } : null,
        municipio: munObj ? { codigo: mun, nombre: munObj.n } : null,
        zona: zon ? { codigo: zon } : null,
        puesto: puestoObj ? { codigo: std, nombre: puestoObj.nombre } : null,
        mesa: Number.isFinite(mesaNum) ? mesaNum : null,
        tipo: (tipo || null) as TipoCopia | null,
        pagina: { index: pag, total: totalPags },
        kit: sugerencia?.kit ?? null,
        nivel: "AUTO",
        confianzas: { departamento: 1, municipio: 1, puesto: 1, tipo: 1 },
      };
    }
    guardarUbicacion(clasif);
  };

  return (
    <section
      aria-label="Corrección de ubicación del acta"
      className="shrink-0 w-full max-w-md mx-auto border-t border-line bg-surface-2/60 px-4 pt-2.5 pb-1"
    >
      {/* Cabecera del panel */}
      <div className="flex items-center gap-2 pb-2">
        <MapPinIcon className="w-4 h-4 text-warn shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-bold tracking-wide uppercase text-white font-mono">
            CORREGIR UBICACIÓN
          </span>
          <span className="text-[10px] text-ink-dim font-mono">
            {sinBase
              ? "SIN BASE DIVIPOL — modo texto libre"
              : sugerencia
                ? `SUGERENCIA PRECARGADA (${sugerencia.nivel}) — corrige y guarda`
                : "CABECERA SIN LEER — elige dónde va y guarda"}
          </span>
        </div>
      </div>

      {/* Campos — §5: max-h con scroll si crece (max-h-96 overflow-y-auto). */}
      <div className="max-h-96 overflow-y-auto pr-0.5 flex flex-col gap-2.5 pb-2">
        {sinBase ? (
          <>
            <FilaCampo label="Departamento / Consulado">
              <input
                value={dep}
                onChange={(e) => setDep(e.target.value)}
                className={CLASE_CAMPO}
                placeholder="88"
                inputMode="numeric"
                aria-label="Código de departamento o consulado"
              />
            </FilaCampo>
            <FilaCampo label="Municipio / País">
              <input
                value={mun}
                onChange={(e) => setMun(e.target.value)}
                className={CLASE_CAMPO}
                placeholder="120"
                inputMode="numeric"
                aria-label="Código de municipio o país"
              />
            </FilaCampo>
            <div className="grid grid-cols-2 gap-2">
              <FilaCampo label="Zona">
                <input
                  value={zon}
                  onChange={(e) => setZon(e.target.value)}
                  className={CLASE_CAMPO}
                  placeholder="15"
                  inputMode="numeric"
                  aria-label="Código de zona"
                />
              </FilaCampo>
              <FilaCampo label="Puesto">
                <input
                  value={std}
                  onChange={(e) => setStd(e.target.value)}
                  className={CLASE_CAMPO}
                  placeholder="02"
                  inputMode="numeric"
                  aria-label="Código de puesto"
                />
              </FilaCampo>
            </div>
          </>
        ) : (
          <>
            <FilaCampo label="Departamento / Consulado">
              <select
                value={dep}
                onChange={(e) => {
                  setDep(e.target.value);
                  setMun("");
                  setZon("");
                  setStd("");
                }}
                className={CLASE_CAMPO}
                aria-label="Departamento o consulado"
              >
                <option value="">— Elige —</option>
                {deps.map((d) => (
                  <option key={d.codigo} value={d.codigo}>
                    {d.codigo} — {d.nombre}
                  </option>
                ))}
              </select>
            </FilaCampo>
            <FilaCampo label="Municipio / País">
              <select
                value={mun}
                onChange={(e) => {
                  setMun(e.target.value);
                  setZon("");
                  setStd("");
                }}
                disabled={!dep}
                className={`${CLASE_CAMPO} ${!dep ? "opacity-50 cursor-not-allowed" : ""}`}
                aria-label="Municipio o país"
              >
                <option value="">{dep ? "— Elige —" : "— Elige departamento —"}</option>
                {muns.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.codigo} — {m.nombre}
                  </option>
                ))}
              </select>
            </FilaCampo>
            <div className="grid grid-cols-2 gap-2">
              <FilaCampo label="Zona">
                <select
                  value={zon}
                  onChange={(e) => {
                    setZon(e.target.value);
                    setStd("");
                  }}
                  disabled={!mun}
                  className={`${CLASE_CAMPO} ${!mun ? "opacity-50 cursor-not-allowed" : ""}`}
                  aria-label="Zona"
                >
                  <option value="">{mun ? "— Elige —" : "— Elige municipio —"}</option>
                  {zonas.map((z) => (
                    <option key={z.codigo} value={z.codigo}>
                      ZONA {z.codigo}
                    </option>
                  ))}
                </select>
              </FilaCampo>
              <FilaCampo label="Puesto">
                <select
                  value={std}
                  onChange={(e) => setStd(e.target.value)}
                  disabled={!zon}
                  className={`${CLASE_CAMPO} ${!zon ? "opacity-50 cursor-not-allowed" : ""}`}
                  aria-label="Puesto"
                >
                  <option value="">{zon ? "— Elige —" : "— Elige zona —"}</option>
                  {puestos.map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.codigo} — {p.nombre}
                    </option>
                  ))}
                </select>
              </FilaCampo>
            </div>
          </>
        )}

        {/* Mesa (1..countTable, input numérico — §5) */}
        <FilaCampo
          label={
            sinBase || !mesasMax
              ? "Mesa"
              : `Mesa (1–${mesasMax})`
          }
        >
          <input
            type="number"
            value={mesa}
            onChange={(e) => setMesa(e.target.value)}
            min={1}
            max={sinBase ? undefined : mesasMax || undefined}
            className={`${CLASE_CAMPO} ${mesa && mesasMax && (mesaNum < 1 || mesaNum > mesasMax) ? "border-crit/60" : ""}`}
            placeholder="12"
            inputMode="numeric"
            aria-label="Número de mesa"
          />
        </FilaCampo>

        {/* Toggle tipo (TRANSMISIÓN / DELEGADOS — §D.4: prohibido asumir) */}
        <FilaCampo label="Tipo de copia (banda)">
          <Segmento<TipoCopia>
            opciones={[
              { valor: "TRANSMISION", label: "Transmisión" },
              { valor: "DELEGADOS", label: "Delegados" },
            ]}
            valor={tipo}
            onCambiar={setTipo}
          />
        </FilaCampo>

        {/* Páginas 1/2 (2 deshabilitada si el formato es de 1 página) */}
        <FilaCampo label="Página (Ver/Pag/de)">
          <Segmento<1 | 2>
            opciones={[
              { valor: 1 as const, label: "Página 1" },
              { valor: 2 as const, label: "Página 2" },
            ]}
            valor={pag}
            onCambiar={setPag}
            deshabilitadas={totalPags < 2 ? [2] : []}
          />
        </FilaCampo>
      </div>

      {/* Acciones §5: GUARDAR UBICACIÓN (primario) + REPETIR FOTO (secundario,
          comportamiento actual de rescaneo). */}
      <div className="flex flex-row items-center gap-2 w-full pb-2">
        <PrimaryBtn variant="ok" onClick={guardar} disabled={!completa}>
          <CheckIcon className="w-4 h-4" />
          <span>GUARDAR UBICACIÓN</span>
        </PrimaryBtn>
        <PrimaryBtn variant="outline" onClick={repetirFoto}>
          <RefreshIcon className="w-3.5 h-3.5" />
          <span>REPETIR FOTO</span>
        </PrimaryBtn>
      </div>
    </section>
  );
}
