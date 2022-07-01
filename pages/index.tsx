import type { InferGetStaticPropsType, NextPage } from "next";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { createElement, useEffect, useState } from "react";
import styles from "../styles/Home.module.css";

import {
  v1ResSentenceAnalyzed,
  Furigana,
  Xref,
  Word,
  Sense,
  ConjugatedPhrase,
  Particle,
} from "curtiz-japanese-nlp/interfaces";
import { AdjDeconjugated, Deconjugated, DeconjugatedAuxiliary } from "kamiya-codec";
import { ChinoParticlePicker, setup } from "../components/ChinoParticlePicker";

interface FuriganaProps {
  vv: Furigana[][];
}
const Furigana = ({ vv }: FuriganaProps) => {
  return createElement(
    "span",
    null,
    ...vv.flatMap((v) =>
      v.map((f) =>
        typeof f === "string" ? (
          f
        ) : (
          <ruby>
            {f.ruby}
            <rt>{f.rt}</rt>
          </ruby>
        )
      )
    )
  );
};

function renderKanji(w: Word) {
  return w.kanji.map((k) => k.text).join("・");
}
function renderKana(w: Word) {
  return w.kana.map((k) => k.text).join("・");
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
    (sense, n) =>
      sense.gloss.map((gloss) => gloss.text).join("/") +
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

function renderDeconjugation(d: AdjDeconjugated | DeconjugatedAuxiliary | Deconjugated) {
  if ("auxiliary" in d) {
    return `${d.auxiliary}/${d.conjugation}`;
  }
  return d.conjugation;
}

interface Hit {
  startIdx: number;
  endIdx: number;
  word: Word;
  sense: number;
}

const clozeToKey = (x: Pick<ConjugatedPhrase, "startIdx" | "endIdx">): string => `${x.startIdx}-${x.endIdx}`;

type AnnotatedConjugatedPhrase = ConjugatedPhrase & { selectedDeconj: ConjugatedPhrase["deconj"][0] };
type AnnotatedParticle = Particle & { chinoTag: string };
interface AnnotateProps {
  line: string;
  sentencesDb: Record<
    string,
    { data: { dictHits: Hit[]; conjHits: AnnotatedConjugatedPhrase[]; particles: AnnotatedParticle[] } }
  >;
  particlesMarkdown: string;
}
const Annotate = ({ line, sentencesDb, particlesMarkdown }: AnnotateProps) => {
  // This component will be called for lines that haven't been annotated yet.
  // This should not work in static-generated output, ideally it won't exist.
  const HELPER_URL = "http://localhost:3010";

  const [nlp, setNlp] = useState<v1ResSentenceAnalyzed | undefined>(undefined);
  const [dictHits, setDictHits] = useState<Hit[]>(sentencesDb[line]?.data?.dictHits || []);
  const [conjHits, setConjHits] = useState<AnnotatedConjugatedPhrase[]>(sentencesDb[line]?.data?.conjHits || []);
  const [particles, setParticles] = useState<AnnotatedParticle[]>(sentencesDb[line]?.data?.particles || []);
  const idxsCovered = new Set(dictHits.flatMap((o) => range(o.startIdx, o.endIdx)));

  useEffect(() => {
    // Yes this will run twice in dev mode, see
    // https://reactjs.org/blog/2022/03/29/react-v18.html#new-strict-mode-behaviors
    if (!nlp) {
      (async function parse() {
        const req = await fetch(`${HELPER_URL}/sentence/${line}`, {
          headers: { Accept: "application/json" },
        });
        const data = await req.json();
        setNlp(data);
        console.log("nlp", data);
      })();
    }
  }, []);

  useEffect(() => {
    (async function save() {
      const post = dictHits.length > 0 || conjHits.length > 0 || particles.length > 0;

      const res = await fetch(`${HELPER_URL}/sentence`, {
        method: post ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence: line,
          data: { dictHits, conjHits, particles },
        }),
      });
      if (!res.ok) {
        console.error(`${res.status} ${res.statusText}`);
      } else {
        console.log("saved");
      }
    })();
  }, [dictHits, conjHits, particles]);

  if (!nlp) {
    return <h2>{line}</h2>;
  }
  if (!nlp.tags || !nlp.clozes) {
    throw new Error("tags/clozes expected");
  }
  const { tags, clozes } = nlp;
  return (
    <div>
      <h2 lang={"ja"}>
        <Furigana vv={nlp.furigana} />
      </h2>
      <details open>
        <summary>All annotations</summary>
        <details open>
          <summary>Selected dictionary entries</summary>
          <ul>
            {dictHits.map((h) => (
              <li>
                {h.startIdx}-{h.endIdx}: {renderKanji(h.word)} 「{renderKana(h.word)}」 {circleNumber(h.sense)}{" "}
                {renderSenses(h.word, tags)[h.sense]}
              </li>
            ))}
          </ul>
        </details>
        <details open>
          <summary>All conjugated phrases found</summary>
          <ol>
            {clozes.conjugatedPhrases.map((foundConj) => (
              <li>
                {foundConj.cloze.cloze}{" "}
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
        <details open>
          <summary>All particles found</summary>
          <ol>
            {clozes.particles.map((foundParticle) => {
              return (
                <li>
                  <sub>{foundParticle.cloze.left}</sub>
                  {foundParticle.cloze.cloze}
                  <sub>{foundParticle.cloze.right}</sub>:{" "}
                  {foundParticle.morphemes.map((m) => m.partOfSpeech.join("/")).join(", ")}{" "}
                  {foundParticle.chino.length && (
                    <ChinoParticlePicker
                      particleNumbers={foundParticle.chino.map(([i]) => i)}
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
        </details>
        <details open>
          <summary>All dictionary entries matched</summary>
          <ol>
            {nlp.hits.map(
              (scoreHits, outerIdx) =>
                scoreHits.results.length > 0 && (
                  <li key={outerIdx} value={outerIdx}>
                    <ol>
                      {scoreHits.results.map((res, innerIdx) => (
                        <li>
                          <details open={range(scoreHits.startIdx, res.endIdx).some((x) => !idxsCovered.has(x))}>
                            <summary>{typeof res.run === "string" ? res.run : res.run.cloze}</summary>
                            <ol>
                              {res.results.map((hit, wordIdx) => {
                                if (!hit.word) {
                                  throw new Error("word expected");
                                }
                                const word = hit.word;
                                return (
                                  <li>
                                    <sup>{hit.search}</sup> {renderKanji(hit.word)} 「{renderKana(hit.word)}」 (#
                                    {hit.word.id})
                                    <ol>
                                      {renderSenses(hit.word, tags).map((s, senseIdx) => (
                                        <li>
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
                                                    (x) => `${x.startIdx}/${x.endIdx}/${x.word.id}`
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
                      ))}
                    </ol>
                  </li>
                )
            )}
          </ol>
        </details>
      </details>
    </div>
  );
};

export default function HomePage({
  sentences: sentencesDb,
  particlesMarkdown,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  setup(particlesMarkdown);
  const sentences = [
    "ある日の朝早く、ジリリリンとおしりたんてい事務所の電話が鳴りました。",
    "ブラウンは眠い目をこすりながら受話器を取りました",
    // "静かなホテル",
    // "このホテルは静かだ",
    // "このホテルは静かじゃなかった",
    // "鳥の鳴き声が森の静かさを破った",
    // "昨日は寒かった",
    // "動物でも人間の心が分かります",
  ];
  return (
    <div>
      <p>Here's the first line of Oshiri Tantei #3.</p>
      <Annotate
        key={sentences[0]}
        line={sentences[0]}
        sentencesDb={sentencesDb}
        particlesMarkdown={particlesMarkdown}
      />
      <p>And the second.</p>
      <Annotate
        key={sentences[1]}
        line={sentences[1]}
        sentencesDb={sentencesDb}
        particlesMarkdown={particlesMarkdown}
      />
    </div>
  );
}

export const getStaticProps = async () => {
  // might only print if you restart next dev server
  const parentDir = path.join(process.cwd(), "data");
  const jsons = (await readdir(parentDir)).filter((f) => f.toLowerCase().endsWith(".json"));
  console.log("ls", jsons);
  const sentences = await Promise.all(
    jsons.map((j) => readFile(path.join(parentDir, j), "utf8").then((x) => JSON.parse(x)))
  );
  const obj = Object.fromEntries(sentences.map((s) => [s.sentence, s]));

  const particlesMarkdown = await readFile("all-about-particles.md", "utf8");
  return { props: { sentences: obj, particlesMarkdown } };
};
