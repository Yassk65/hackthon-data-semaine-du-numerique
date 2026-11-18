import { useEffect, useRef, useState } from "react";
import type { Core, Scale } from "../data/types";
import { t } from "../i18n";
import { shortYear } from "../lib/format";
import { LAYERS, type LayerGroup, layerLabel } from "../lib/layers";

const GROUPS: LayerGroup[] = ["risque", "scolarite", "contexte"];

export function LayerPicker({ core, value, onChange }: { core: Core; value: string; onChange: (id: string) => void }) {
  return (
    <fieldset className="layers">
      <legend className="eyebrow">{t("controls.layer")}</legend>
      {GROUPS.map((g) => (
        <div key={g} className="layers-group" role="radiogroup" aria-label={t(`group.${g}`)}>
          <p className="layers-group-title">{t(`group.${g}`)}</p>
          {LAYERS.filter((l) => l.group === g).map((l) => {
            const disabled = l.kind === "unavailable";
            return (
              <label key={l.id} className={`layer-option${value === l.id ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}>
                <input type="radio" name="layer" value={l.id} checked={value === l.id} disabled={disabled} onChange={() => onChange(l.id)} />
                <span>{layerLabel(l, core)}</span>
                {disabled && <small>{t("layer.acledNote")}</small>}
              </label>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
}

export function ScaleToggle({ value, onChange }: { value: Scale; onChange: (s: Scale) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={t("controls.scale")}>
      {(["reg", "prov"] as Scale[]).map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} className={value === s ? "is-active" : ""} onClick={() => onChange(s)}>
          {t(`scale.${s}`)}
        </button>
      ))}
    </div>
  );
}

export function YearSlider({ years, value, onChange }: { years: string[]; value: string; onChange: (y: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const idx = Math.max(0, years.indexOf(value));
  const ref = useRef({ idx, years });
  ref.current = { idx, years };
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const { idx: i, years: ys } = ref.current;
      if (i >= ys.length - 1) {
        setPlaying(false);
        return;
      }
      onChange(ys[i + 1]);
    }, 1300);
    return () => window.clearInterval(id);
  }, [playing, onChange]);
  if (years.length <= 1) {
    return <p className="year-static">{years[0] ? shortYear(years[0]) : "—"}</p>;
  }
  return (
    <div className="year">
      <div className="year-head">
        <label htmlFor="year-range" className="eyebrow">
          {t("controls.year")}
        </label>
        <output htmlFor="year-range" className="year-value">
          {shortYear(years[idx])}
        </output>
      </div>
      <div className="year-row">
        <button
          type="button"
          className="icon-btn"
          aria-pressed={playing}
          aria-label={playing ? t("controls.pause") : t("controls.play")}
          onClick={() => {
            if (!playing && idx >= years.length - 1) onChange(years[0]);
            setPlaying(!playing);
          }}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>
          )}
        </button>
        <input
          id="year-range"
          type="range"
          min={0}
          max={years.length - 1}
          step={1}
          value={idx}
          aria-valuetext={years[idx]}
          onChange={(e) => onChange(years[Number(e.target.value)])}
        />
      </div>
      <div className="year-ticks" aria-hidden="true">
        <span>{shortYear(years[0])}</span>
        <span>{shortYear(years[years.length - 1])}</span>
      </div>
    </div>
  );
}

export function CompareYear({
  years,
  year,
  value,
  enabled,
  onChange,
}: {
  years: string[];
  year: string;
  value: string | null;
  enabled: boolean;
  onChange: (y: string | null) => void;
}) {
  if (!enabled) return null;
  const options = years.filter((y) => y < year);
  return (
    <div className="compare-year">
      <label className="check">
        <input type="checkbox" checked={Boolean(value)} disabled={!options.length} onChange={(e) => onChange(e.target.checked ? options[0] : null)} />
        <span>{t("controls.beforeAfter")}</span>
      </label>
      {value && (
        <select aria-label={t("controls.refYear")} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((y) => (
            <option key={y} value={y}>
              {t("controls.since", { year: shortYear(y) })}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
