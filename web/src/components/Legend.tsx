import { t } from "../i18n";
import type { LayerResult } from "../lib/layers";

export default function Legend({ result, year }: { result: LayerResult; year: string }) {
  const { legend } = result;
  return (
    <div className="legend" aria-label={t("legend.aria")}>
      <p className="legend-title">
        {legend.title} <span className="legend-year">{year}</span>
      </p>
      {legend.kind === "bivariate" ? (
        <div className="bivariate">
          <div className="bivariate-grid" aria-hidden="true">
            {[2, 1, 0].map((r) =>
              [0, 1, 2].map((c) => <span key={`${r}${c}`} style={{ background: legend.items[r * 3 + c].color }} />),
            )}
          </div>
          <div className="bivariate-axes">
            <span>↑ {legend.axes?.[0]}</span>
            <span>→ {legend.axes?.[1]}</span>
          </div>
        </div>
      ) : (
        <ul className="legend-items">
          {legend.items.map((it) => (
            <li key={it.label}>
              <i style={{ background: it.color }} />
              {it.label}
            </li>
          ))}
        </ul>
      )}
      <ul className="legend-items legend-items--extra">
        <li>
          <i className="swatch-hatch" />
          {t("legend.missing")}
        </li>
        <li>
          <i className="swatch-dots" />
          {t("legend.fragile")}
        </li>
      </ul>
      {result.note && <p className="legend-note">{result.note}</p>}
    </div>
  );
}
