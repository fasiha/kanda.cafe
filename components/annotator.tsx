import { useEffect, useState } from "react";
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
import {
  AdjConjugation,
  adjConjugations,
  AdjDeconjugated,
  auxiliaries,
  Auxiliary,
  Conjugation,
  conjugations,
  Deconjugated,
  conjugateAuxiliaries,
  adjConjugate,
} from "kamiya-codec";
import {
  ChinoParticlePicker,
  convertSectionToChinoLine,
  convertSectionToParticle,
} from "../components/ChinoParticlePicker";
import { SimpleCharacter } from "curtiz-japanese-nlp/kanjidic";
import { groupBy, substringInArray } from "../utils";
import { generateContextClozed, hasKanji } from "curtiz-utils";

interface Hit {
  startIdx: number;
  endIdx: number;
  word: Word;
  sense: number;
}

type PartPartial<T, K extends keyof T> = Partial<Pick<T, K>> & Omit<T, K>;
type AnnotatedConjugatedPhrase = PartPartial<ConjugatedPhrase, "morphemes"> & {
  selectedDeconj: ConjugatedPhrase["deconj"][0];
};
type AnnotatedParticle = Particle & { chinoTag: string };
type SimplifiedBunsetsu = { idx: number; parent: number; numMorphemes: number };

function isAnnotatedParticle(p: Particle | AnnotatedParticle): p is AnnotatedParticle {
  return "chinoTag" in p;
}

export interface SentenceDbEntry {
  furigana: Furigana[][];
  dictHits: Hit[];
  conjHits: AnnotatedConjugatedPhrase[];
  particles: AnnotatedParticle[];
  kanjidic: v1ResSentenceAnalyzed["kanjidic"];
  bunsetsus: SimplifiedBunsetsu[];
  // sum of all numMorphemes === furigana.length
}
export type SentenceDb = Record<string, { data: SentenceDbEntry; sentence: string; hash?: string }>;

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
  oldLine?: string;
}
// This should not work in static-generated output, ideally it won't exist.
export const Annotate = ({ line, sentencesDb, allDictHits, oldLine }: AnnotateProps) => {
  // This component will be called for lines that haven't been annotated yet.

  const [nlp, setNlp] = useState<v1ResSentenceAnalyzed | undefined>(undefined);
  const [furigana, setFurigana] = useState<Furigana[][]>(sentencesDb[line]?.data?.furigana || []);
  const [dictHits, setDictHits] = useState<Hit[]>(sentencesDb[line]?.data?.dictHits || []);
  const [conjHits, setConjHits] = useState<AnnotatedConjugatedPhrase[]>(sentencesDb[line]?.data?.conjHits || []);
  const [particles, setParticles] = useState<AnnotatedParticle[]>(sentencesDb[line]?.data?.particles || []);
  const [kanjidic, setKanjidic] = useState<undefined | SentenceDbEntry["kanjidic"]>(sentencesDb[line]?.data?.kanjidic);
  const [bunsetsus, setBunsetsus] = useState<SimplifiedBunsetsu[]>(sentencesDb[line]?.data?.bunsetsus || []);
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
        const data: v1ResSentenceAnalyzed = (await req.json())[0];
        setNlp(data);
        setKanjidic(data.kanjidic);

        if (furigana.length === 0) {
          // don't overwrite our edited custom furigana (私's わたくし vs わたし)!
          setFurigana(data.furigana);
        }
        setKanjidic(data.kanjidic);
        setBunsetsus(data.bunsetsus.map((o) => ({ idx: o.idx, parent: o.parent, numMorphemes: o.morphemes.length })));

        // if there's an `oldLine` and we've not added ANY annotations, try to recover
        // old annotations and move it here
        if (oldLine && oldLine !== line && dictHits.length === 0 && conjHits.length === 0 && particles.length === 0) {
          const oldData = sentencesDb[oldLine];
          if (oldData) {
            const newMorphemes = data.furigana.map(furiganaToString);
            const oldMorphemes = oldData.data.furigana.map(furiganaToString);

            const newDictHits: typeof dictHits = [];
            for (const oldDict of oldData.data.dictHits) {
              const oldCloze = generateContextClozed(
                oldMorphemes.slice(oldDict.startIdx).join(""),
                oldMorphemes.slice(oldDict.startIdx, oldDict.endIdx).join(""),
                oldMorphemes.slice(oldDict.endIdx).join("")
              );

              // this check uses parts of morphemes so can't move to `substringInArray`
              if (
                line.includes(oldCloze.left.slice(-1) + oldCloze.cloze) ||
                line.includes(oldCloze.cloze + oldCloze.right.slice(0, 1))
              ) {
                // New line likely includes this dict hit: find this cloze in it
                const lineIdx = substringInArray(newMorphemes, oldCloze.cloze);
                if (lineIdx) {
                  newDictHits.push({
                    startIdx: lineIdx.startIdx,
                    endIdx: lineIdx.endIdx,
                    word: oldDict.word,
                    sense: oldDict.sense,
                  });
                }
              }
            }
            setDictHits(newDictHits);

            // very similar processing to `dictHits` above
            const newParticles: typeof particles = [];
            for (const oldParticle of oldData.data.particles) {
              const oldCloze = generateContextClozed(
                oldMorphemes.slice(oldParticle.startIdx).join(""),
                oldMorphemes.slice(oldParticle.startIdx, oldParticle.endIdx).join(""),
                oldMorphemes.slice(oldParticle.endIdx).join("")
              );
              if (
                line.includes(oldCloze.left.slice(-1) + oldCloze.cloze) ||
                line.includes(oldCloze.cloze + oldCloze.right.slice(0, 1))
              ) {
                const lineIdx = substringInArray(newMorphemes, oldCloze.cloze);
                if (lineIdx) {
                  newParticles.push({ ...oldParticle, startIdx: lineIdx.startIdx, endIdx: lineIdx.endIdx });
                }
              }
            }
            setParticles(newParticles);

            const newConjHits: typeof conjHits = [];
            for (const oldConj of oldData.data.conjHits) {
              // much less risk of an unwanted collision with conjugated verbs/adjectives
              const lineIdx = substringInArray(
                newMorphemes,
                oldMorphemes.slice(oldConj.startIdx, oldConj.endIdx).join("")
              );
              if (lineIdx) {
                const nlpConj = data.clozes?.conjugatedPhrases.find(
                  (c) => c.startIdx === lineIdx.startIdx && c.endIdx === lineIdx.endIdx
                );
                if (nlpConj) {
                  newConjHits.push({ ...nlpConj, selectedDeconj: oldConj.selectedDeconj });
                }
              }
            }
            setConjHits(newConjHits);
          }
        }

        console.log("nlp", data);
      })();
    }
  }, [helper_url, line, nlp, furigana, oldLine, dictHits, conjHits, particles, sentencesDb]);

  useEffect(() => {
    saveDb(
      line,
      { dictHits, conjHits, particles, furigana, kanjidic: kanjidic || {}, bunsetsus },
      helper_url,
      sentencesDb
    );
  }, [dictHits, conjHits, particles, furigana, kanjidic, helper_url, line, sentencesDb, bunsetsus]);

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
  const selectedDictHits = renderHits(dictHits);
  const dictHitsPerMorpheme: Map<number, JSX.Element[]> = new Map();
  for (const [idx, hit] of dictHits.entries()) {
    const li = selectedDictHits[idx];
    for (const mi of range(hit.startIdx, hit.endIdx)) {
      dictHitsPerMorpheme.set(mi, (dictHitsPerMorpheme.get(mi) || []).concat(li));
    }
  }

  // Since we can add particles manually, which the NLP server won't know about, make a list of all particles
  const allParticles: (Particle | AnnotatedParticle)[] = clozes.particles;
  {
    const particleKey = (p: Particle) => `${p.startIdx}/${p.endIdx}/${p.cloze.cloze}`;
    const nlpKeys = new Set(allParticles.map(particleKey));
    allParticles.push(...particles.filter((savedParticle) => !nlpKeys.has(particleKey(savedParticle))));
  }

  return (
    <div className={styles["annotator"]}>
      <h2 lang={"ja"}>
        <Furigana vv={furigana} covered={allCovered} onFocus={(i) => setFocusedMorphemeIdx(i)} />
      </h2>
      <details open>
        <summary>All annotations</summary>
        <details>
          <Jdepp furigana={furigana} bunsetsus={bunsetsus} morphemeToJsx={dictHitsPerMorpheme} />
          <summary>J.DepP</summary>
        </details>
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
          <ul>{selectedDictHits}</ul>
          <details>
            <AddDictHit furigana={furigana} submit={(hit) => setDictHits(upsertIfNew(dictHits, hit, hitkey))} />
            <summary>Add custom dictionary hit</summary>
          </details>
        </details>
        <details open>
          <summary>All conjugated phrases</summary>
          <p>Picked:</p>
          <ol>
            {conjHits.map((conj, i) => (
              <li key={i}>
                <Furigana vv={furigana.slice(conj.startIdx, conj.endIdx)} /> = <Furigana vv={[conj.lemmas[0]]} />{" "}
                {renderDeconjugation(conj.selectedDeconj)}
              </li>
            ))}
          </ol>
          <p>Found:</p>
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
          <details>
            <ManualConjugation
              furigana={furigana}
              submit={(newConj) => setConjHits(upsertIfNew(conjHits, newConj, clozeToKey))}
            />
            <summary>Add custom conjugation</summary>
          </details>
        </details>
        <details open>
          <summary>All particles found</summary>
          <ol>
            {allParticles.map((particle, i) => {
              return (
                <li key={i}>
                  <sub>{particle.cloze.left}</sub>
                  {particle.cloze.cloze}
                  <sub>{particle.cloze.right}</sub>:{" "}
                  {particle.chino.length
                    ? particle.morphemes.map((m) => m.partOfSpeech.join("/")).join(", ")
                    : isAnnotatedParticle(particle)
                    ? "(manual particle) " + convertSectionToParticle(particle.chinoTag)
                    : "?"}{" "}
                  <ChinoParticlePicker
                    candidateNumbers={particle.chino.map(([i]) => i)}
                    candidate={particle.cloze.cloze}
                    currentValue={particles.find((x) => clozeToKey(particle) === clozeToKey(x))?.chinoTag}
                    onChange={(e) =>
                      setParticles(
                        e
                          ? upsertIfNew(particles, { ...particle, chinoTag: e }, clozeToKey)
                          : particles.filter((x) => clozeToKey(x) !== clozeToKey(particle))
                      )
                    }
                  />
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
export const RenderSentence = ({ line, sentencesDb, tags }: RenderSentenceProps) => {
  const { furigana = [], dictHits = [], conjHits = [], particles = [], kanjidic = {} } = sentencesDb[line]?.data || {};
  const className = furigana.length === 0 ? "no-furigana" : "annotated-sentence";

  // maps morpheme to a list of `<LI>` tags
  const covered: Map<number, JSX.Element[]> = new Map();

  // maps morpheme to a list of `${c}${n}` where `c` is `p` for particle,
  // `d` for dict, and `c` for conjugation, and n is a number.
  const mIdxToAnnotationIds: Map<number, string[]> = new Map();

  // Spell it out like this for speed (avoid conctenating arrays for no reason other than brevity)
  for (const [hidx, h] of dictHits.entries()) {
    for (const outerIdx of range(h.startIdx, h.endIdx)) {
      mIdxToAnnotationIds.set(outerIdx, (mIdxToAnnotationIds.get(outerIdx) || []).concat("d" + hidx));

      if (!covered.has(outerIdx)) {
        covered.set(outerIdx, []);
      }
      const v = covered.get(outerIdx) || []; // TypeScript pacification
      v.push(
        <li
          key={v.length}
          className={[styles["annotate-bullet"], v.length < 3 ? styles[`sib${v.length + 1}`] : ""].join(" ")}
        >
          {renderKanji(h.word)} 「{renderKana(h.word)}」 {circleNumber(h.sense)} {renderSenses(h.word, tags)[h.sense]}{" "}
          <sub>{h.word.id}</sub>
        </li>
      );
    }
  }
  for (const [cidx, foundConj] of conjHits.entries()) {
    for (const outerIdx of range(foundConj.startIdx, foundConj.endIdx)) {
      mIdxToAnnotationIds.set(outerIdx, (mIdxToAnnotationIds.get(outerIdx) || []).concat("c" + cidx));

      if (!covered.has(outerIdx)) {
        covered.set(outerIdx, []);
      }
      const v = covered.get(outerIdx) || []; // TypeScript pacification
      v.push(
        <li
          key={v.length}
          className={[styles["annotate-bullet"], v.length < 3 ? styles[`sib${v.length + 1}`] : ""].join(" ")}
        >
          {foundConj.cloze.cloze} = <Furigana vv={[foundConj.lemmas[0]]} />{" "}
          {renderDeconjugation(foundConj.selectedDeconj)}
        </li>
      );
    }
  }
  for (const [pidx, foundParticle] of particles.entries()) {
    for (const outerIdx of range(foundParticle.startIdx, foundParticle.endIdx)) {
      mIdxToAnnotationIds.set(outerIdx, (mIdxToAnnotationIds.get(outerIdx) || []).concat("p" + pidx));

      if (!covered.has(outerIdx)) {
        covered.set(outerIdx, []);
      }
      const v = covered.get(outerIdx) || []; // TypeScript pacification
      v.push(
        <li
          key={v.length}
          className={[styles["annotate-bullet"], v.length < 3 ? styles[`sib${v.length + 1}`] : ""].join(" ")}
        >
          <>
            <sub>{foundParticle.cloze.left}</sub>
            {foundParticle.cloze.cloze}
            <sub>{foundParticle.cloze.right}</sub>:{" "}
            {foundParticle.chino.length
              ? foundParticle.morphemes.map((m) => m.partOfSpeech.join("/")).join(", ")
              : "(manual particle) " + convertSectionToParticle(foundParticle.chinoTag)}{" "}
            {convertSectionToChinoLine(foundParticle.chinoTag)}
          </>
        </li>
      );
    }
  }

  const [activeAnnotationIds, setActiveAnnotationIds] = useState<string[]>([]);

  function mIdxToClass(idx: number): string {
    const annots = mIdxToAnnotationIds.get(idx);
    if (!annots) {
      return "";
    }
    const [a1, a2, a3] = activeAnnotationIds as (string | undefined)[];
    let ret = " ";
    for (const a of annots) {
      if (a === a1) {
        ret += styles["sib1"] + " ";
      } else if (a === a2) {
        ret += styles["sib2"] + " ";
      } else if (a === a3) {
        ret += styles["sib3"] + " ";
      }
    }
    return ret;
  }

  const kanjiPerIdx = new Map(furigana.map((fs, idx) => [idx, furiganaToString(fs).split("").filter(hasKanji)]));

  return (
    <>
      <span className={styles[className]} lang={"ja"}>
        {furigana.length
          ? furigana.map((fs, idx) => (
              <span
                className={[styles["morpheme"], covered.has(idx) ? styles["has-annotations"] : ""].join(" ")}
                onMouseEnter={() => {
                  setActiveAnnotationIds(mIdxToAnnotationIds.get(idx) || []);
                }}
                onMouseLeave={() => setActiveAnnotationIds([])}
                key={idx}
              >
                <span className={styles["topdeck"] + mIdxToClass(idx)}>
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
                </span>
                {covered.has(idx) ? (
                  <span className={styles["morpheme-annotations"]}>
                    <ul>{covered.get(idx)}</ul>
                    <Kanjidic hits={kanjidic} wantedKanji={kanjiPerIdx.get(idx)} />
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
  wantedKanji?: string[];
}
function Kanjidic({ hits, wantedKanji: onlyKanji }: KanjidicProps) {
  return (
    <ul className={styles["kanjidic-list"]}>
      {Object.values(hits)
        .filter((dic) => (onlyKanji ? onlyKanji.includes(dic.literal) : true))
        .map((dic, i) => (
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
  { dictHits, conjHits, particles, furigana, kanjidic, bunsetsus }: SentenceDbEntry,
  helper_url: string,
  sentencesDb?: SentenceDb
) {
  const post =
    dictHits.length > 0 ||
    conjHits.length > 0 ||
    particles.length > 0 ||
    furigana.length > 0 ||
    Object.keys(kanjidic).length > 0;
  const data: SentenceDbEntry = { dictHits, conjHits, particles, furigana, kanjidic, bunsetsus };
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
    sentencesDb[line] = { data, sentence: line };
  }
}

// https://stackoverflow.com/questions/70843127#comment128628953_70843200
type Ugh<T> = (T extends (infer X)[] ? X : never)[];

interface AddParticle {
  furigana: Furigana[][];
  morphemes: Morpheme[];
  submit: (hit: AnnotatedParticle) => void;
}
function AddParticle({ furigana, morphemes, submit }: AddParticle) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(furigana.length);
  const [chinoTag, setChinoTag] = useState("");
  const [candidate, setCandidate] = useState(furiganaToString(furigana.slice(start, end)));

  return (
    <p>
      <>
        Tag from{" "}
        <MorphemesSelector
          furigana={furigana}
          submit={(s, e) => {
            setStart(s);
            setEnd(e);
            setCandidate(furiganaToString(furigana.slice(s, e)));
          }}
        />{" "}
        <input type="text" placeholder="particle" value={candidate} onChange={(e) => setCandidate(e.target.value)} />{" "}
        <ChinoParticlePicker candidate={candidate} currentValue={chinoTag} onChange={(e) => setChinoTag(e)} />{" "}
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

interface ManualConjugationProps {
  furigana: Furigana[][];
  submit: (conj: AnnotatedConjugatedPhrase) => void;
}
function ManualConjugation({ furigana, submit }: ManualConjugationProps) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(furigana.length);
  const [lemma, setLemma] = useState("");

  const [conj, setConj] = useState<undefined | Conjugation | AdjConjugation>(undefined);
  const [auxText, setAuxText] = useState("");

  const [verbMode, setVerbMode] = useState(true);
  const [typeII, setTypeII] = useState(false);
  const [iAdj, setIAdj] = useState(true);

  const auxs: Auxiliary[] = auxText.split(" ").filter(isAux);
  let results: string[] = [];
  if (lemma) {
    try {
      if (verbMode && isConjugation(conj)) {
        results = conjugateAuxiliaries(lemma, auxs, conj, typeII);
      } else if (!verbMode && isAdjConjugation(conj)) {
        results = adjConjugate(lemma, conj, iAdj);
      }
    } catch (e) {
      // very likely an unallowed conjugation was asked for. Do nothing.
    }
  }

  function submitHelper() {
    const cloze = generateContextClozed(
      furiganaToString(furigana.slice(0, start)),
      furiganaToString(furigana.slice(start, end)),
      furiganaToString(furigana.slice(end))
    );
    const deconj = verbMode
      ? [{ auxiliaries: auxs, conjugation: conj, result: results } as Deconjugated]
      : [{ conjugation: conj, result: results } as AdjDeconjugated];
    const final: AnnotatedConjugatedPhrase = {
      startIdx: start,
      endIdx: end,
      lemmas: [[lemma]],
      cloze,
      deconj,
      selectedDeconj: deconj[0],
    };
    submit(final);
  }

  return (
    <p>
      Tag from{" "}
      <MorphemesSelector
        furigana={furigana}
        submit={(s, e) => {
          setStart(s);
          setEnd(e);
        }}
      />{" "}
      <input
        type="text"
        placeholder="dictionary form"
        value={lemma}
        onChange={(e) => setLemma(e.target.value.trim())}
      />{" "}
      <button onClick={() => setVerbMode(!verbMode)}>Switch to {verbMode ? "adjective" : "verb"}</button>{" "}
      <label>
        {verbMode ? "Type II ichidan verb" : "i adjective"}{" "}
        <input
          type="checkbox"
          checked={verbMode ? typeII : iAdj}
          onChange={() => (verbMode ? setTypeII(!typeII) : setIAdj(!iAdj))}
        ></input>
      </label>{" "}
      {verbMode ? (
        <label>
          Type in space-separated auxiliaries{" "}
          <input
            type="text"
            placeholder="auxiliaries"
            value={auxText}
            onChange={(e) => setAuxText(e.target.value.trim())}
          />
        </label>
      ) : (
        ""
      )}{" "}
      (Valid auxiliaries: {auxs.join("+")}){" "}
      <label>
        Pick final conjugation:{" "}
        <select
          value={conj}
          onChange={(e) => {
            const value = e.target.value;
            if (isConjugation(value) || isAdjConjugation(value)) {
              setConj(value);
            } else {
              setConj(undefined);
            }
          }}
        >
          <option key="0" value={undefined}>
            Pick
          </option>
          {(verbMode ? conjugations : adjConjugations).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>{" "}
      Results: {results.join("・")}{" "}
      <button disabled={results.length === 0} onClick={submitHelper}>
        Accept
      </button>
    </p>
  );
}

function isConjugation(x: string | undefined): x is Conjugation {
  return conjugations.includes(x as Conjugation);
}
function isAdjConjugation(x: string | undefined): x is AdjConjugation {
  return adjConjugations.includes(x as AdjConjugation);
}
function isAux(x: string | undefined): x is Auxiliary {
  return auxiliaries.includes(x as Auxiliary);
}

interface AddDictHit {
  furigana: Furigana[][];
  submit: (hit: Hit) => void;
}
function AddDictHit({ furigana, submit }: AddDictHit) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(furigana.length);
  const [wordId, setWordId] = useState("");
  const [sense, setSense] = useState(0);
  const [word, setWord] = useState<Word | undefined>(undefined);
  const [helper_url] = useState(() => `http://${window.location.hostname}:3010`);

  useEffect(() => {
    (async function main() {
      const reply = await fetch(`${helper_url}/jmdict/${wordId}`);
      if (reply.ok) {
        setWord(await reply.json());
      } else {
        console.error(`${reply.status} ${reply.statusText}`);
      }
    })();
  }, [wordId, helper_url, setWord]);

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
  useEffect(() => submit(start, end), [start, end, submit]);
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

interface JdeppProps {
  furigana: Furigana[][]; // what comes from NLP server and what we save
  bunsetsus: SimplifiedBunsetsu[];
  morphemeToJsx: Map<number, JSX.Element[]>;
}
export function Jdepp({ furigana, bunsetsus: bunsetsu, morphemeToJsx }: JdeppProps) {
  const bunsetsuIndexes: { startIdx: number; endIdx: number }[] = [];
  const bidxToJsxs: typeof morphemeToJsx = new Map();
  {
    let startIdx = 0;
    for (const [bidx, b] of bunsetsu.entries()) {
      const i = { startIdx, endIdx: startIdx + b.numMorphemes };
      bunsetsuIndexes.push(i);
      startIdx += b.numMorphemes;

      for (const n of range(i.startIdx, i.endIdx)) {
        const hits = morphemeToJsx.get(n) || [];
        bidxToJsxs.set(bidx, (bidxToJsxs.get(bidx) || []).concat(hits));
      }
    }
  }
  const idxToParentIdx: Map<number, number> = new Map();
  for (const b of bunsetsu) {
    idxToParentIdx.set(b.idx, b.parent);
  }

  function calcIdxToNumLevels(parent: number) {
    let n = 0;
    while (parent !== -1) {
      const hit = idxToParentIdx.get(parent);
      if (hit === undefined) {
        throw new Error("what");
      }
      parent = hit;
      n++;
    }
    return n;
  }
  const idxToNumLevels: Map<number, number> = new Map(bunsetsu.map((b) => [b.idx, calcIdxToNumLevels(b.idx)]));

  const maxLevels = Math.max(...Array.from(idxToNumLevels.values()));

  const parentsVisited: Set<number> = new Set();
  const prevRowIsChild = Array(maxLevels).fill(false);

  return (
    <table className={styles["jdepp"]}>
      <tbody>
        {bunsetsu.map((b, bidx) => {
          const level = idxToNumLevels.get(b.idx); // 1, 2, ...
          const parent = idxToParentIdx.get(b.idx);
          if (!level || !parent) {
            throw new Error("what2");
          }

          const parentVisited = parentsVisited.has(parent);
          parentsVisited.add(parent);

          const tds = Array.from(Array(level), (_, n) => {
            const colSpan = n === 0 ? maxLevels - level + 1 : 1;
            let boxclass = "";
            if (n === 0) {
              boxclass = styles["bunsetsu"];
            } else if (n === 1) {
              boxclass = `${styles["box-drawing"]} ${
                parentVisited ? styles["box-drawing-T"] : styles["box-drawing-7"]
              }`;
            } else if (n > 1) {
              const actualColumn = maxLevels - level + 1 + n; // 1, 2, ...
              if (prevRowIsChild[actualColumn - 1]) {
                boxclass += ` ${styles["box-drawing"]} ${styles["box-drawing-1"]}`;
              }
            }

            return (
              <td key={n} colSpan={colSpan} className={boxclass}>
                {n === 0 && (
                  <Furigana vv={furigana.slice(bunsetsuIndexes[b.idx].startIdx, bunsetsuIndexes[b.idx].endIdx)} />
                )}
              </td>
            );
          });
          tds.push(<td key="last">{bidxToJsxs.has(bidx) && <ul>{bidxToJsxs.get(bidx) || []}</ul>}</td>);

          for (let l = 0; l < maxLevels; l++) {
            if (l <= maxLevels - level) {
              // we just populated these
              prevRowIsChild[l] = false;
            } else if (l === maxLevels - level + 1) {
              // but this is a child
              prevRowIsChild[l] = true;
            }
            // don't touch any other elements
          }

          return <tr key={b.idx}>{tds}</tr>;
        })}
      </tbody>
    </table>
  );
}
