import type { InferGetStaticPropsType } from "next";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { useEffect, useMemo, useState } from "react";
import styles from "../styles/Home.module.css";

import {
  v1ResSentenceAnalyzed,
  Furigana,
  Xref,
  Word,
  Sense,
  ConjugatedPhrase,
  Particle,
  Morpheme,
} from "curtiz-japanese-nlp/interfaces";
import { AdjDeconjugated, Deconjugated } from "kamiya-codec";
import { ChinoParticlePicker, convertSectionToChinoLine, setup } from "../components/ChinoParticlePicker";
import { SimpleCharacter } from "curtiz-japanese-nlp/kanjidic";
import { groupBy } from "../utils";
import { generateContextClozed } from "curtiz-utils";

export const getStaticProps = async () => {
  // might only print if you restart next dev server
  const parentDir = path.join(process.cwd(), "data");
  const jsons = (await readdir(parentDir)).filter((f) => f.toLowerCase().endsWith(".json"));
  const sentences = await Promise.all(
    jsons.map((j) => readFile(path.join(parentDir, j), "utf8").then((x) => JSON.parse(x)))
  );
  const obj: SentenceDb = Object.fromEntries(sentences.map((s) => [s.sentence, s])); // TODO validate

  const particlesMarkdown = await readFile("all-about-particles.md", "utf8");
  const tags: NonNullable<v1ResSentenceAnalyzed["tags"]> = JSON.parse(await readFile("tags.json", "utf8"));
  return { props: { sentences: obj, particlesMarkdown, tags } };
};

interface Hit {
  startIdx: number;
  endIdx: number;
  word: Word;
  sense: number;
}

type AnnotatedConjugatedPhrase = ConjugatedPhrase & { selectedDeconj: ConjugatedPhrase["deconj"][0] };
type AnnotatedParticle = Particle & { chinoTag: string };
interface SentenceDbEntry {
  furigana: Furigana[][];
  dictHits: Hit[];
  conjHits: AnnotatedConjugatedPhrase[];
  particles: AnnotatedParticle[];
  kanjidic: v1ResSentenceAnalyzed["kanjidic"];
}
type SentenceDb = Record<string, { data: SentenceDbEntry }>;

const furiganaV = (v: Furigana[]) => {
  return v.map((f, i) =>
    typeof f === "string" ? (
      f
    ) : (
      <ruby key={i}>
        {f.ruby}
        <rt>{f.rt}</rt>
      </ruby>
    )
  );
};
interface FuriganaProps {
  vv: Furigana[][];
  covered?: Set<number>;
  onFocus?: (moprhemeIdx: number) => void;
}
const Furigana = ({ vv, covered, onFocus }: FuriganaProps) => {
  return (
    <>
      {vv.map((v, i) => (
        <span
          key={i}
          onMouseLeave={onFocus ? () => onFocus(-1) : undefined}
          onMouseEnter={onFocus ? () => onFocus(i) : undefined}
          className={covered && !covered.has(i) ? styles["no-annotation-morpheme"] : undefined}
        >
          {furiganaV(v)}
        </span>
      ))}
    </>
  );
};

function furiganaToString(f: Furigana | Furigana[] | Furigana[][]): string {
  if (Array.isArray(f)) {
    return f.map(furiganaToString).join("");
  }
  return typeof f === "string" ? f : f.ruby;
}
function furiganaToRt(f: Furigana): string {
  return typeof f === "string" ? "" : f.rt;
}

function renderKanji(w: Word) {
  return w.kanji.map((k) => k.text).join("・");
}
function renderKana(w: Word) {
  return w.kana.map((k) => k.text).join("・");
}
function renderWord(w: Word) {
  return `${renderKanji(w)} 「${renderKana(w)}」 (#${w.id})`;
}
function printXrefs(v: Xref[]) {
  return v.map((x) => x.join(",")).join(";");
}
function renderSenses(w: Word, tags: Record<string, string>): string[] {
  type Tag = string;
  type TagKey = {
    [K in keyof Sense]: Sense[K] extends Tag[] ? K : never;
  }[keyof Sense];
  const tagFields: Partial<Record<TagKey, string>> = {
    dialect: "🗣",
    field: "🀄️",
    misc: "✋",
  };
  return w.sense.map(
    (sense) =>
      sense.gloss.map((gloss) => gloss.text).join("/") +
      ` (${sense.partOfSpeech.map((p) => tags[p]).join(", ")})` +
      (sense.related.length ? ` (👉 ${printXrefs(sense.related)})` : "") +
      (sense.antonym.length ? ` (👈 ${printXrefs(sense.antonym)})` : "") +
      Object.entries(tagFields)
        .map(([k, v]) =>
          sense[k as TagKey].length ? ` (${v} ${sense[k as TagKey].map((k) => tags[k]).join("; ")})` : ""
        )
        .join("")
  );
}
function range(start: number, endExclusive: number, step = 1) {
  const ret: number[] = [];
  if (step === 0) {
    return ret;
  } else if (step > 0) {
    for (let i = start; i < endExclusive; i += step) {
      ret.push(i);
    }
  } else {
    for (let i = start; i > endExclusive; i += step) {
      ret.push(i);
    }
  }
  return ret;
}
function upsertIfNew<X, Y>(v: X[], newx: X, key: (x: X) => Y) {
  const newy = key(newx);
  for (const [i, x] of v.entries()) {
    const y = key(x);
    if (y === newy) {
      if (x === newx) {
        return v;
      }
      const copy = v.slice();
      copy[i] = newx;
      return copy;
    }
  }
  return v.concat(newx);
}
function circleNumber(n: number): string {
  const circledNumbers = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿";
  return circledNumbers[n] || "" + n;
}

function renderDeconjugation(d: AdjDeconjugated | Deconjugated) {
  if ("auxiliaries" in d) {
    return `${d.auxiliaries.join(" + ")} + ${d.conjugation}`;
  }
  return d.conjugation;
}

const clozeToKey = (x: Pick<ConjugatedPhrase, "startIdx" | "endIdx">): string => `${x.startIdx}-${x.endIdx}`;
function isFocused(h: { startIdx: number; endIdx: number }, idx: number): boolean {
  return idx >= h.startIdx && idx < h.endIdx;
}

interface AnnotateProps {
  line: string;
  sentencesDb: SentenceDb;
  allDictHits: Map<string, { sense: number; word: Word }>;
}
// This should not work in static-generated output, ideally it won't exist.
const Annotate = ({ line, sentencesDb, allDictHits }: AnnotateProps) => {
  // This component will be called for lines that haven't been annotated yet.

  const [nlp, setNlp] = useState<v1ResSentenceAnalyzed | undefined>(undefined);
  const [furigana, setFurigana] = useState<Furigana[][]>(sentencesDb[line]?.data?.furigana || []);
  const [dictHits, setDictHits] = useState<Hit[]>(sentencesDb[line]?.data?.dictHits || []);
  const [conjHits, setConjHits] = useState<AnnotatedConjugatedPhrase[]>(sentencesDb[line]?.data?.conjHits || []);
  const [particles, setParticles] = useState<AnnotatedParticle[]>(sentencesDb[line]?.data?.particles || []);
  const [kanjidic, setKanjidic] = useState<undefined | SentenceDbEntry["kanjidic"]>(sentencesDb[line]?.data?.kanjidic);
  const [focusedMorphemeIdx, setFocusedMorphemeIdx] = useState(-1);
  const [helper_url] = useState(() => `http://${window.location.hostname}:3010`);

  useEffect(() => {
    // Yes this will run twice in dev mode, see
    // https://reactjs.org/blog/2022/03/29/react-v18.html#new-strict-mode-behaviors
    if (!nlp) {
      (async function parse() {
        const req = await fetch(`${helper_url}/sentence/${line}`, {
          headers: { Accept: "application/json" },
        });
        const data = await req.json();
        setNlp(data);
        setKanjidic(data.kanjidic);

        if (furigana.length === 0) {
          // don't overwrite our edited custom furigana (私's わたくし vs わたし)!
          setFurigana(data.furigana);
        }
        setKanjidic(data.kanjidic);

        console.log("nlp", data);
      })();
    }
  }, [helper_url, line, nlp, furigana]);

  useEffect(() => {
    saveDb(line, { dictHits, conjHits, particles, furigana, kanjidic: kanjidic || {} }, helper_url, sentencesDb);
  }, [dictHits, conjHits, particles, furigana, kanjidic, helper_url, line, sentencesDb]);

  if (!nlp) {
    return <h2 lang={"ja"}>{furigana.length ? <Furigana vv={furigana} /> : line}</h2>;
  }
  if (!nlp.tags || !nlp.clozes) {
    throw new Error("tags/clozes expected");
  }

  const coveredHelper = (v: { startIdx: number; endIdx: number }[]) =>
    new Set(v.flatMap((o) => range(o.startIdx, o.endIdx)));
  const idxsCoveredDict = coveredHelper(dictHits);
  const idxsCoveredConj = coveredHelper(conjHits);
  const idxsCoveredPart = coveredHelper(particles);
  const allCovered = new Set([idxsCoveredDict, idxsCoveredConj, idxsCoveredPart].flatMap((v) => Array.from(v)));
  // Skip the first morpheme, so we close the dict hits for the tail but not head
  const idxsCoveredConjForDict = new Set(conjHits.flatMap((o) => range(o.startIdx + 1, o.endIdx)));
  const wordIdsPicked = new Set(dictHits.map((o) => o.word.id));

  const hitkey = (x: Hit) => `${x.startIdx}/${x.endIdx}/${x.word.id}/${x.sense}`;
  const { tags, clozes } = nlp;
  const conjGroupedByStart = Array.from(groupBy(clozes.conjugatedPhrases, (o) => o.startIdx));

  // Two requirements to be considered for autopick: (1) word used before and (2) literal exactly matches kana/kanji listing.
  // So of course this will omit conjugated verbs, etc. Fine.
  const dictHitsAutoPick: typeof dictHits = [];
  for (const outer of nlp.hits) {
    for (const inner of outer.results) {
      const { run, endIdx, results } = inner;
      // same as `open` below
      const open = range(outer.startIdx, endIdx).some(
        (x) => !(idxsCoveredConjForDict.has(x) || idxsCoveredPart.has(x) || idxsCoveredDict.has(x))
      );
      if (!open) {
        continue;
      }

      for (const hit of results.slice(0, 5)) {
        const pickedHit = allDictHits.get(hit.wordId);
        if (pickedHit && hit.word) {
          if (hit.word.kana.find((o) => o.text === run) || hit.word.kanji.find((o) => o.text === run)) {
            dictHitsAutoPick.push({
              startIdx: outer.startIdx,
              endIdx: endIdx,
              word: hit.word,
              sense: pickedHit.sense,
            });
          }
        }
      }
    }
  }

  const renderHits = (v: Hit[]) =>
    v.map((h, i) => {
      const thisFocused = isFocused(h, focusedMorphemeIdx);
      const thisKey = hitkey(h);
      const alreadyPicked = !!dictHits.find((h) => hitkey(h) === thisKey);
      return (
        <li key={i} className={thisFocused ? styles["focused-morpheme"] : undefined}>
          {h.startIdx}-{h.endIdx}: {renderKanji(h.word)} 「{renderKana(h.word)}」 {circleNumber(h.sense)}{" "}
          {renderSenses(h.word, tags)[h.sense]}{" "}
          <button
            onClick={() => {
              if (alreadyPicked) {
                const removeKey = hitkey(h);
                setDictHits(dictHits.filter((h) => hitkey(h) !== removeKey));
              } else {
                setDictHits(upsertIfNew(dictHits, h, hitkey));
              }
            }}
          >
            {alreadyPicked ? "Remove" : "Add"}
          </button>
        </li>
      );
    });

  return (
    <div className={styles["annotator"]}>
      <h2 lang={"ja"}>
        <Furigana vv={furigana} covered={allCovered} onFocus={(i) => setFocusedMorphemeIdx(i)} />
      </h2>
      <details open>
        <summary>All annotations</summary>
        <details>
          <summary>Furigana editor</summary>
          <ul>
            {furigana.flatMap((fVec, outerIdx) =>
              fVec.map((f, innerIdx) =>
                typeof f === "string" ? (
                  ""
                ) : (
                  <li key={`${outerIdx}/${innerIdx}`}>
                    {f.ruby}:{" "}
                    <input
                      type="text"
                      value={f.rt}
                      onChange={(e) =>
                        setFurigana(
                          furigana.map((oldOuter, oldOuterIdx) =>
                            oldOuterIdx === outerIdx
                              ? oldOuter.map((oldInner, oldInnerIdx) =>
                                  oldInnerIdx === innerIdx && typeof oldInner !== "string"
                                    ? { ruby: oldInner.ruby, rt: e.target.value }
                                    : oldInner
                                )
                              : oldOuter
                          )
                        )
                      }
                    />
                    {furiganaToRt(nlp.furigana[outerIdx][innerIdx]) !== f.rt ? (
                      <> (was: {furiganaToRt(nlp.furigana[outerIdx][innerIdx])})</>
                    ) : (
                      ""
                    )}
                  </li>
                )
              )
            )}
          </ul>
        </details>
        <details open>
          <summary>Selected dictionary entries</summary>
          <ul>{renderHits(dictHits)}</ul>
          <details>
            <AddDictHit
              furigana={furigana}
              submit={(hit) => setDictHits(upsertIfNew(dictHits, hit, hitkey))}
              sentencesDb={sentencesDb}
            />
            <summary>Add custom dictionary hit</summary>
          </details>
        </details>
        <details open>
          <summary>All conjugated phrases found</summary>
          <ol>
            {conjGroupedByStart.map(([startIdx, conjugatedPhrases]) => (
              <li key={startIdx}>
                <details open={!idxsCoveredConj.has(startIdx)}>
                  <summary>{conjugatedPhrases[0].morphemes[0].literal[0]}…</summary>
                  <ol>
                    {conjugatedPhrases.map((foundConj, i) => (
                      <li key={i}>
                        {foundConj.cloze.cloze} = <Furigana vv={[foundConj.lemmas[0]]} />{" "}
                        {
                          <select
                            value={(function () {
                              const key = clozeToKey(foundConj);
                              const x = conjHits.find((dec) => clozeToKey(dec) === key)?.selectedDeconj;
                              if (!x) return "0";
                              const renderedX = renderDeconjugation(x);
                              return foundConj.deconj.findIndex((p) => renderDeconjugation(p) === renderedX) + 1;
                            })()}
                            onChange={(e) => {
                              const idx = +e.target.value;
                              const phraseKey = clozeToKey(foundConj);
                              setConjHits(
                                idx
                                  ? upsertIfNew(
                                      conjHits,
                                      { ...foundConj, selectedDeconj: foundConj.deconj[idx - 1] },
                                      clozeToKey
                                    )
                                  : conjHits.filter((p) => clozeToKey(p) !== phraseKey)
                              );
                            }}
                          >
                            <option value="0">Pick one of {foundConj.deconj.length}</option>
                            {foundConj.deconj.map((dec, idx) => {
                              const readable = renderDeconjugation(dec);
                              return (
                                <option key={idx + 1} value={idx + 1}>
                                  {readable}
                                </option>
                              );
                            })}
                          </select>
                        }
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ol>
        </details>
        <details open>
          <summary>All particles found</summary>
          <ol>
            {clozes.particles.map((foundParticle, i) => {
              return (
                <li key={i}>
                  <sub>{foundParticle.cloze.left}</sub>
                  {foundParticle.cloze.cloze}
                  <sub>{foundParticle.cloze.right}</sub>:{" "}
                  {foundParticle.morphemes.map((m) => m.partOfSpeech.join("/")).join(", ")}{" "}
                  {foundParticle.chino.length && (
                    <ChinoParticlePicker
                      candidateNumbers={foundParticle.chino.map(([i]) => i)}
                      currentValue={particles.find((x) => clozeToKey(foundParticle) === clozeToKey(x))?.chinoTag}
                      onChange={(e) =>
                        setParticles(
                          e
                            ? upsertIfNew(particles, { ...foundParticle, chinoTag: e }, clozeToKey)
                            : particles.filter((x) => clozeToKey(x) !== clozeToKey(foundParticle))
                        )
                      }
                    />
                  )}
                </li>
              );
            })}
          </ol>
          <details>
            <summary>Add a particle</summary>
            <AddParticle
              furigana={furigana}
              morphemes={nlp.bunsetsus.flatMap((b) => b.morphemes)}
              submit={(particle) => setParticles(upsertIfNew(particles, particle, clozeToKey))}
            />
          </details>
        </details>
        <details open>
          <summary>All dictionary entries matched</summary>
          {dictHitsAutoPick.length ? (
            <>
              <p>Autopick</p>
              <ul>{renderHits(dictHitsAutoPick)}</ul>
            </>
          ) : undefined}
          <ol>
            {nlp.hits.map(
              (scoreHits, outerIdx) =>
                scoreHits.results.length > 0 && (
                  <li key={outerIdx} value={outerIdx}>
                    <ol>
                      {scoreHits.results.map((res, i) => {
                        const open = range(scoreHits.startIdx, res.endIdx).some(
                          (x) => !(idxsCoveredConjForDict.has(x) || idxsCoveredPart.has(x) || idxsCoveredDict.has(x))
                        );
                        const anyPickedClass = res.results.find((hit) => wordIdsPicked.has(hit.wordId))
                          ? ""
                          : styles["no-hit-picked"];
                        return (
                          <li key={i}>
                            <details open={open}>
                              <summary className={anyPickedClass}>
                                {typeof res.run === "string" ? res.run : res.run.cloze}
                              </summary>
                              <ol>
                                {res.results.map((hit, i) => {
                                  if (!hit.word) {
                                    throw new Error("word expected");
                                  }
                                  const word = hit.word;
                                  return (
                                    <li key={i}>
                                      <sup>{hit.search}</sup> {renderWord(hit.word)}
                                      <ol>
                                        {renderSenses(hit.word, tags).map((s, senseIdx) => (
                                          <li key={senseIdx}>
                                            <>
                                              {s}{" "}
                                              <button
                                                onClick={() => {
                                                  setDictHits(
                                                    upsertIfNew(
                                                      dictHits,
                                                      {
                                                        startIdx: scoreHits.startIdx,
                                                        endIdx: res.endIdx,
                                                        word: word,
                                                        sense: senseIdx,
                                                      },
                                                      hitkey
                                                    )
                                                  );
                                                }}
                                              >
                                                Pick
                                              </button>
                                            </>
                                          </li>
                                        ))}
                                      </ol>
                                    </li>
                                  );
                                })}
                              </ol>
                            </details>
                          </li>
                        );
                      })}
                    </ol>
                  </li>
                )
            )}
          </ol>
        </details>
        {Object.keys(nlp.kanjidic).length ? (
          <details open>
            <summary>Kanji</summary>
            <Kanjidic hits={nlp.kanjidic} />
          </details>
        ) : (
          <></>
        )}
      </details>
    </div>
  );
};

interface RenderSentenceProps {
  line: string;
  sentencesDb: SentenceDb;
  tags: Record<string, string>;
}
const RenderSentence = ({ line, sentencesDb, tags }: RenderSentenceProps) => {
  const { furigana = [], dictHits = [], conjHits = [], particles = [], kanjidic = {} } = sentencesDb[line]?.data || {};
  const className = furigana.length === 0 ? "no-furigana" : "annotated-sentence";

  const covered: Map<number, JSX.Element[]> = new Map();
  // Spell it out like this for speed (avoid conctenating arrays for no reason other than brevity)
  for (const h of dictHits) {
    for (const outerIdx of range(h.startIdx, h.endIdx)) {
      if (!covered.has(outerIdx)) {
        covered.set(outerIdx, []);
      }
      const v = covered.get(outerIdx) || []; // TypeScript pacification
      v.push(
        <li key={v.length}>
          {renderKanji(h.word)} 「{renderKana(h.word)}」 {circleNumber(h.sense)} {renderSenses(h.word, tags)[h.sense]}{" "}
          <sub>{h.word.id}</sub>
        </li>
      );
    }
  }
  for (const foundConj of conjHits) {
    for (const outerIdx of range(foundConj.startIdx, foundConj.endIdx)) {
      if (!covered.has(outerIdx)) {
        covered.set(outerIdx, []);
      }
      const v = covered.get(outerIdx) || []; // TypeScript pacification
      v.push(
        <li key={v.length}>
          {foundConj.cloze.cloze} = <Furigana vv={[foundConj.lemmas[0]]} />{" "}
          {renderDeconjugation(foundConj.selectedDeconj)}
        </li>
      );
    }
  }
  for (const foundParticle of particles) {
    for (const outerIdx of range(foundParticle.startIdx, foundParticle.endIdx)) {
      if (!covered.has(outerIdx)) {
        covered.set(outerIdx, []);
      }
      const v = covered.get(outerIdx) || []; // TypeScript pacification
      v.push(
        <li key={v.length}>
          <>
            <sub>{foundParticle.cloze.left}</sub>
            {foundParticle.cloze.cloze}
            <sub>{foundParticle.cloze.right}</sub>:{" "}
            {foundParticle.chino.length
              ? foundParticle.morphemes.map((m) => m.partOfSpeech.join("/")).join(", ")
              : "(manual particle)"}{" "}
            {convertSectionToChinoLine(foundParticle.chinoTag)}
          </>
        </li>
      );
    }
  }

  return (
    <>
      <span className={styles[className]} lang={"ja"}>
        {furigana.length
          ? furigana.map((fs, idx) => (
              <span
                className={[styles["morpheme"], covered.has(idx) ? styles["has-annotations"] : ""].join(" ")}
                key={idx}
              >
                {fs.map((f, i) =>
                  typeof f === "string" ? (
                    f
                  ) : (
                    <ruby key={i}>
                      {f.ruby}
                      <rt>{f.rt}</rt>
                    </ruby>
                  )
                )}
                {covered.has(idx) ? (
                  <span className={styles["morpheme-annotations"]}>
                    <ul>{covered.get(idx)}</ul>
                  </span>
                ) : (
                  ""
                )}
              </span>
            ))
          : line}
      </span>
    </>
  );
};

interface KanjidicProps {
  hits: v1ResSentenceAnalyzed["kanjidic"];
}
function Kanjidic({ hits }: KanjidicProps) {
  return (
    <ul>
      {Object.values(hits).map((dic, i) => (
        <li key={i}>
          {renderKanjidicRoot(dic)}
          <ul>
            {dic.dependencies.map((root, i) => (
              <KanjidicChild key={i} root={root} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
interface KanjidicChildProps {
  root: v1ResSentenceAnalyzed["kanjidic"][string]["dependencies"][number];
}
function KanjidicChild({ root }: KanjidicChildProps) {
  if (!root.nodeMapped) {
    return <li>{root.node}</li>;
  }
  return (
    <li>
      {renderKanjidicRoot(root.nodeMapped)}
      <ul>
        {root.children.map((child, i) => (
          <KanjidicChild root={child} key={i} />
        ))}
      </ul>
    </li>
  );
}
function renderKanjidicRoot(k: SimpleCharacter) {
  const ret = `${k.literal} 「${k.readings.join("・")}」 ${k.meanings.join("; ")}`;
  if (k.nanori.length) {
    return ret + ` (名: ${k.nanori.join("・")})`;
  }
  return ret;
}

async function saveDb(
  line: string,
  { dictHits, conjHits, particles, furigana, kanjidic }: SentenceDbEntry,
  helper_url: string,
  sentencesDb?: SentenceDb
) {
  const post =
    dictHits.length > 0 ||
    conjHits.length > 0 ||
    particles.length > 0 ||
    furigana.length > 0 ||
    Object.keys(kanjidic).length > 0;
  const data: SentenceDbEntry = { dictHits, conjHits, particles, furigana, kanjidic };
  const res = await fetch(`${helper_url}/sentence`, {
    method: post ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sentence: line,
      data,
    }),
  });
  if (!res.ok) {
    console.error(`${res.status} ${res.statusText}`);
  } else {
    console.log("saved");
  }
  if (sentencesDb) {
    // VERY evil: we shouldn't be messing with props to Homepage like this but we're already pushing the boundary of Next in this direction so...
    sentencesDb[line] = { data };
  }
}

// https://stackoverflow.com/questions/70843127#comment128628953_70843200
type Ugh<T> = (T extends (infer X)[] ? X : never)[];

export default function HomePage({
  sentences: sentencesDb,
  particlesMarkdown,
  tags,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  setup(particlesMarkdown);

  const [annotating, setAnnotating] = useState(new Set<string>());
  const allDictHits: Map<string, { sense: number; word: Word }> = useMemo(
    () =>
      new Map(
        Object.values(sentencesDb).flatMap((o) =>
          o.data.dictHits.map((o) => [o.word.id, { sense: o.sense, word: o.word }])
        )
      ),
    [sentencesDb]
  );

  const s = (s: string) =>
    !annotating.has(s) ? (
      <>
        <RenderSentence key={s} line={s} sentencesDb={sentencesDb} tags={tags} />
        <button className={styles["edit-done-edit"]} onClick={() => setAnnotating(new Set(annotating).add(s))}>
          📝
        </button>
      </>
    ) : (
      <>
        <Annotate key={s} line={s} sentencesDb={sentencesDb} allDictHits={allDictHits} />
        <button
          className={styles["edit-done-edit"]}
          onClick={() => setAnnotating(new Set([...annotating].filter((x) => x !== s)))}
        >
          ✅
        </button>
      </>
    );
  return (
    <div>
      <blockquote>Let&apos;s do Oshiri Tantei #1!</blockquote>
      <div>
        {s("紫婦人の暗号事件")}
        {s("賑やかな街の真ん中に、１軒の探偵事務所がありました")}
        {s("そこにはおしりたんていと助手のブラウンが住んでいました")}
      </div>
    </div>
  );
}

function searchSentencesDbForJmdictId(db: SentenceDb, id: string) {
  if (!id) {
    return undefined;
  }
  for (const key in db) {
    const hit = db[key].data.dictHits.find((h) => h.word.id === id);
    if (hit) {
      return hit?.word;
    }
  }
}

interface AddParticle {
  furigana: Furigana[][];
  morphemes: Morpheme[];
  submit: (hit: AnnotatedParticle) => void;
}
function AddParticle({ furigana, morphemes, submit }: AddParticle) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(furigana.length);
  const [chinoTag, setChinoTag] = useState("");

  return (
    <p>
      <>
        Tag from{" "}
        <MorphemesSelector
          furigana={furigana}
          submit={(s, e) => {
            setStart(s);
            setEnd(e);
          }}
        />{" "}
        {
          <ChinoParticlePicker
            candidate={furiganaToString(furigana.slice(start, end))}
            currentValue={chinoTag}
            onChange={(e) => setChinoTag(e)}
          />
        }{" "}
        <button
          disabled={!chinoTag}
          onClick={() => {
            const cloze = generateContextClozed(
              furiganaToString(furigana.slice(0, start)),
              furiganaToString(furigana.slice(start, end)),
              furiganaToString(furigana.slice(end))
            );
            const p: AnnotatedParticle = {
              chinoTag,
              cloze,
              startIdx: start,
              endIdx: end,
              morphemes: morphemes.slice(start, end),
              chino: [],
            };
            submit(p);
          }}
        >
          Submit
        </button>
      </>
    </p>
  );
}

interface AddDictHit {
  furigana: Furigana[][];
  submit: (hit: Hit) => void;
  sentencesDb: SentenceDb;
}
function AddDictHit({ furigana, submit, sentencesDb }: AddDictHit) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(furigana.length);
  const [wordId, setWordId] = useState("");
  const [sense, setSense] = useState(0);
  const word = useMemo(() => (wordId ? searchSentencesDbForJmdictId(sentencesDb, wordId) : undefined), [wordId]);

  return (
    <p>
      <>
        Tag from{" "}
        <MorphemesSelector
          furigana={furigana}
          submit={(s, e) => {
            setStart(s);
            setEnd(e);
          }}
        />{" "}
        <input type="text" placeholder="Jmdict word id" value={wordId} onChange={(e) => setWordId(e.target.value)} />{" "}
        {wordId && word ? (
          <>
            {renderWord(word)}{" "}
            <select value={sense} onChange={(e) => setSense(+e.target.value)}>
              {word.sense.map((s, i) => (
                <option key={i} value={i}>
                  {s.gloss.map((g) => g.text).join("/")}
                </option>
              ))}
            </select>{" "}
          </>
        ) : (
          <>waiting for valid ID</>
        )}{" "}
        <button
          disabled={!(word && sense >= 0)}
          onClick={() => {
            if (word && sense >= 0) {
              const res = { startIdx: start, endIdx: end, word: word, sense };
              submit(res);
            }
          }}
        >
          Submit
        </button>
      </>
    </p>
  );
}

interface MorphemesSelectorProps {
  furigana: Furigana[][];
  submit: (startIdx: number, endIdx: number) => void;
}
function MorphemesSelector({ furigana, submit }: MorphemesSelectorProps) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(furigana.length);
  useEffect(() => submit(start, end), [start, end]);
  return (
    <>
      <select
        value={start}
        onChange={(e) => {
          const x = +e.target.value;
          setStart(x);
          setEnd(Math.max(end, x + 1));
        }}
      >
        {range(0, furigana.length).map((n) => (
          <option key={n} value={n}>
            {furigana[n].map(furiganaToString).join("")}…
          </option>
        ))}
      </select>{" "}
      to{" "}
      <select value={end} onChange={(e) => setEnd(+e.target.value)}>
        {range(start + 1, furigana.length + 1).map((n) => (
          <option key={n} value={n}>
            {furigana
              .slice(start, n)
              .flatMap((v) => v.map(furiganaToString))
              .join("")}
          </option>
        ))}
      </select>
    </>
  );
}
