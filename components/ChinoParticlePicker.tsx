import styles from "./ChinoParticlePicker.module.css";

let chinoList: Map<
  number,
  {
    leaf: boolean;
    fullLine: string;
    sectionNo: string;
    description: string;
  }[]
> = new Map();

export function setup(markdown: string): typeof chinoList {
  const lines = markdown.split("\n").filter((s) => s.match(/^\t*[0-9]/));

  const flat: { fullLine: string; sectionNo: string; description: string }[] = [];
  const nonleaf: Set<string> = new Set();

  let prevIndent = 0;
  let currIdx = [0];
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
    let description = line.trim().split(" ").slice(1).join(" ");
    if (description.startsWith("\\*")) {
      description = description.slice(2);
    }
    const sectionNo = currIdx.join(".");
    const fullLine = `#${sectionNo}. ${description}`;
    flat.push({ fullLine, sectionNo, description });

    prevIndent = currIndent;
  }

  const ret = flat.map((o) => ({ ...o, leaf: !nonleaf.has(o.sectionNo) }));

  const groups: Map<number, typeof ret> = new Map();
  for (const x of ret) {
    const prefix = parseInt(x.sectionNo.split(".")[0]);
    groups.set(prefix, (groups.get(prefix) || []).concat(x));
  }

  chinoList = groups;

  return groups;
}

interface ChinoParticlePickerProps {
  particleNumber: number;
  onChange: (x: string) => void;
  currentValue?: string;
  data?: typeof chinoList;
}
export function ChinoParticlePicker({ particleNumber, currentValue, onChange, data }: ChinoParticlePickerProps) {
  data = data || chinoList;
  return (
    <>
      <select className={styles.select} onChange={(e) => onChange(e.target.value)} value={currentValue || ""}>
        <option value="">Pick as detailed a particle as possible</option>
        {(data.get(particleNumber) || []).map((p) => (
          <option key={p.sectionNo} value={p.sectionNo}>
            {p.sectionNo}. {p.leaf && `✅ `} {p.description}
          </option>
        ))}
      </select>
    </>
  );
}
