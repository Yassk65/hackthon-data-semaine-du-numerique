import fr from "./fr.json";

// Les textes de l'interface sont dans fr.json. Pour ajouter l'anglais, créer en.json avec les
// mêmes clés et l'ajouter à DICTS : la langue est choisie par ?lang=en dans l'URL.
type Dict = Record<string, string>;
const DICTS: Record<string, Dict> = { fr: flatten(fr) };

function flatten(obj: Record<string, unknown>, prefix = ""): Dict {
  const out: Dict = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

const lang = (() => {
  const m = typeof location !== "undefined" ? /[?&]lang=(\w+)/.exec(location.search) : null;
  return m && DICTS[m[1]] ? m[1] : "fr";
})();

export function t(key: string, vars?: Record<string, string | number>): string {
  const s = DICTS[lang][key] ?? DICTS.fr[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export const LANG = lang;
