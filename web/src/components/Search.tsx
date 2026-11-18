import { useId, useMemo, useState } from "react";
import type { Core } from "../data/types";
import { t } from "../i18n";

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Recherche de province ou de région (liste déroulante accessible au clavier). */
export default function Search({ core, onPick }: { core: Core; onPick: (code: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const items = useMemo(() => {
    const all = [
      ...Object.entries(core.meta.unites.reg).map(([code, r]) => ({ code, nom: r.nom, sub: t("search.region"), extra: r.ancienne_region })),
      ...Object.entries(core.meta.unites.prov).map(([code, p]) => ({ code, nom: p.nom, sub: p.reg_nom, extra: p.ancienne_province })),
    ];
    const n = norm(q.trim());
    if (!n) return [];
    return all.filter((x) => norm(x.nom).includes(n) || norm(x.extra).includes(n)).slice(0, 8);
  }, [core, q]);

  const pick = (code: string) => {
    onPick(code);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="search">
      <input
        type="search"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-${items[active].code}` : undefined}
        aria-label={t("search.label")}
        placeholder={t("search.placeholder")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            pick(items[active].code);
          } else if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && items.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="search-list">
          {items.map((it, i) => (
            <li
              key={it.code}
              id={`${id}-${it.code}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it.code);
              }}
            >
              <span>{it.nom}</span>
              <small>{it.sub}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
