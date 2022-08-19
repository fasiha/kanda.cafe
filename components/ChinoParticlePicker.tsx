import styles from "./ChinoParticlePicker.module.css";

export interface ChinoParticle {
  leaf: boolean;
  fullLine: string;
  sectionNo: string;
  description: string;
  particle: string;
}
type TopToChinosMap = Map<number, ChinoParticle[]>;
let topToChinos: TopToChinosMap = new Map();
type NumberToChinoMap = Map<string, ChinoParticle>;
let sectionToChino: NumberToChinoMap = new Map();

export function setup(markdown: string) {
  const lines = markdown.split("\n").filter((s) => s.match(/^\t*[0-9]/));

  const flat: Pick<ChinoParticle, "description" | "fullLine" | "particle" | "sectionNo">[] = [];
  const nonleaf: Set<string> = new Set();

  let prevIndent = 0;
  let currIdx = [0];
  let particle = "";
  for (const line of lines) {
    var currIndent = line.match(/^\t*/)?.[0].length;
    if (typeof currIndent !== "number") {
      throw new Error("0 or more tabs with number not found");
    }
    if (!(currIndent <= prevIndent + 1)) {
      throw new Error("indented more than one level");
    }

    if (currIndent === prevIndent) {
      // same indent
      currIdx[currIdx.length - 1]++;
    } else if (currIndent > prevIndent) {
      // increase indent
      nonleaf.add(currIdx.join("."));
      currIdx.push(1);
    } else {
      // dedent
      currIdx = currIdx.slice(0, currIndent).concat(currIdx[currIndent] + 1);
    }
    let description = line.trim().split(" ").slice(1).join(" ").replace(/^\\/, "");
    if (currIdx.length === 1) {
      particle = description;
    }
    const sectionNo = currIdx.join(".");
    const fullLine = `#${sectionNo}. ${description}`;
    flat.push({ fullLine, sectionNo, description, particle });

    prevIndent = currIndent;
  }

  const ret = flat.map((o) => ({ ...o, leaf: !nonleaf.has(o.sectionNo) }));

  const groups: Map<number, typeof ret> = new Map();
  for (const x of ret) {
    const prefix = parseInt(x.sectionNo.split(".")[0]);
    groups.set(prefix, (groups.get(prefix) || []).concat(x));
  }

  topToChinos = groups;
  sectionToChino = new Map(
    [...topToChinos.values()].flatMap((x) => x.map((x) => [x.sectionNo, x] as [string, ChinoParticle]))
  );
}

const NO_SELECTION = "";
interface ChinoParticlePickerProps {
  candidateNumbers?: number[];
  candidate?: string;
  onChange: (x: string) => void;
  currentValue?: string;
}
/**
 * You must provide either `candidateNumbers` (from Curtiz Japanese NLP) or `candidate` (manual particle picking).
 *
 * If you provide both, `candidateNumbers` will take priority.
 */
export function ChinoParticlePicker({
  candidateNumbers = [],
  candidate = "",
  currentValue,
  onChange,
}: ChinoParticlePickerProps) {
  // same as backend
  const candidateAlt = candidate === "ん" ? "の" : "";
  const currentValueSection = currentValue?.split(".")[0];

  const candidateParticles: ChinoParticle[] = candidateNumbers.length
    ? candidateNumbers.flatMap((n) => topToChinos?.get(n) || [])
    : Array.from(topToChinos.values())
        .filter(
          (v) =>
            currentValueSection === v[0].sectionNo ||
            v[0].particle.includes(candidate) ||
            (candidateAlt && v[0].particle.includes(candidateAlt))
        )
        .flat();

  return (
    <select className={styles.select} onChange={(e) => onChange(e.target.value)} value={currentValue || NO_SELECTION}>
      <option value={NO_SELECTION}>Pick as detailed a particle as possible</option>
      {candidateParticles.map((p) => (
        <option key={p.sectionNo} value={p.sectionNo}>
          {p.sectionNo}. {p.leaf && `✅ `} {p.description}
        </option>
      ))}
    </select>
  );
}

export function convertSectionToChinoLine(section: string): string {
  return sectionToChino.get(section)?.fullLine || "";
}
export function convertSectionToParticle(section: string): string {
  return sectionToChino.get(section)?.particle || "";
}
