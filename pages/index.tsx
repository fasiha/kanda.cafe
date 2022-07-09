import type { InferGetStaticPropsType, NextPage } from "next";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { createElement, useEffect, useMemo, useState } from "react";
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
import { AdjDeconjugated, Deconjugated } from "kamiya-codec";
import { ChinoParticle, ChinoParticlePicker, setup } from "../components/ChinoParticlePicker";
import { SimpleCharacter } from "curtiz-japanese-nlp/kanjidic";
import { groupBy } from "../utils";

export const getStaticProps = async () => {
  // might only print if you restart next dev server
  const parentDir = path.join(process.cwd(), "data");
  const jsons = (await readdir(parentDir)).filter((f) => f.toLowerCase().endsWith(".json"));
  console.log("ls", jsons);
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
function furiganaToString(f: Furigana | Furigana[] | Furigana[][]): string {
  if (Array.isArray(f)) {
    return f.map(furiganaToString).join("");
  }
  return typeof f === "string" ? f : f.ruby;
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

function renderDeconjugation(d: AdjDeconjugated | Deconjugated) {
  if ("auxiliaries" in d) {
    return `${d.auxiliaries.join(" + ")} + ${d.conjugation}`;
  }
  return d.conjugation;
}

const clozeToKey = (x: Pick<ConjugatedPhrase, "startIdx" | "endIdx">): string => `${x.startIdx}-${x.endIdx}`;

interface AnnotateProps {
  line: string;
  sentencesDb: SentenceDb;
}
// This should not work in static-generated output, ideally it won't exist.
const HELPER_URL = "http://localhost:3010";
const Annotate = ({ line, sentencesDb }: AnnotateProps) => {
  // This component will be called for lines that haven't been annotated yet.

  const [nlp, setNlp] = useState<v1ResSentenceAnalyzed | undefined>(undefined);
  const [furigana, setFurigana] = useState<Furigana[][]>(sentencesDb[line]?.data?.furigana || []);
  const [dictHits, setDictHits] = useState<Hit[]>(sentencesDb[line]?.data?.dictHits || []);
  const [conjHits, setConjHits] = useState<AnnotatedConjugatedPhrase[]>(sentencesDb[line]?.data?.conjHits || []);
  const [particles, setParticles] = useState<AnnotatedParticle[]>(sentencesDb[line]?.data?.particles || []);
  const [kanjidic, setKanjidic] = useState<undefined | SentenceDbEntry["kanjidic"]>(sentencesDb[line]?.data?.kanjidic);

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
        setKanjidic(data.kanjidic);
        console.log("nlp", data);
      })();
    }
  }, []);

  useEffect(() => {
    saveDb(line, { dictHits, conjHits, particles, furigana, kanjidic: kanjidic || {} });
  }, [dictHits, conjHits, particles, furigana, kanjidic]);

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
  // Skip the first morpheme, so we close the dict hits for the tail but not head
  const idxsCoveredConjForDict = new Set(conjHits.flatMap((o) => range(o.startIdx + 1, o.endIdx)));
  const wordIdsPicked = new Set(dictHits.map((o) => o.word.id));

  const hitkey = (x: Hit) => `${x.startIdx}/${x.endIdx}/${x.word.id}/${x.sense}`;
  const { tags, clozes } = nlp;
  const conjGroupedByStart = Array.from(groupBy(clozes.conjugatedPhrases, (o) => o.startIdx));

  return (
    <div>
      <h2 lang={"ja"}>
        <Furigana vv={nlp.furigana} />
      </h2>
      {furigana.length && kanjidic !== undefined ? (
        <button
          onClick={() => {
            setFurigana([]);
            setKanjidic(undefined);
          }}
        >
          Delete furigana + kanji
        </button>
      ) : (
        <button
          onClick={() => {
            setFurigana(nlp.furigana);
            setKanjidic(nlp.kanjidic);
          }}
        >
          Approve furigana + kanji
        </button>
      )}
      <details open>
        <summary>All annotations</summary>
        <details open>
          <summary>Selected dictionary entries</summary>
          <ul>
            {dictHits.map((h) => (
              <li>
                {h.startIdx}-{h.endIdx}: {renderKanji(h.word)} 「{renderKana(h.word)}」 {circleNumber(h.sense)}{" "}
                {renderSenses(h.word, tags)[h.sense]}{" "}
                <button
                  onClick={() => {
                    const removeKey = hitkey(h);
                    setDictHits(dictHits.filter((h) => hitkey(h) !== removeKey));
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <details>
            <AddDictHit
              furigana={nlp.furigana}
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
              <li>
                <details open={!idxsCoveredConj.has(startIdx)}>
                  <summary>{conjugatedPhrases[0].morphemes[0].literal[0]}…</summary>
                  <ol>
                    {conjugatedPhrases.map((foundConj) => (
                      <li>
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
                      {scoreHits.results.map((res) => {
                        const open = range(scoreHits.startIdx, res.endIdx).some(
                          (x) => !(idxsCoveredConjForDict.has(x) || idxsCoveredDict.has(x))
                        );
                        const anyPickedClass = res.results.find((hit) => wordIdsPicked.has(hit.wordId))
                          ? ""
                          : styles["no-hit-picked"];
                        return (
                          <li>
                            <details open={open}>
                              <summary className={anyPickedClass}>
                                {typeof res.run === "string" ? res.run : res.run.cloze}
                              </summary>
                              <ol>
                                {res.results.map((hit) => {
                                  if (!hit.word) {
                                    throw new Error("word expected");
                                  }
                                  const word = hit.word;
                                  return (
                                    <li>
                                      <sup>{hit.search}</sup> {renderWord(hit.word)}
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
  chinoMap: Map<string, ChinoParticle>;
}
const RenderSentence = ({ line, sentencesDb, tags, chinoMap }: RenderSentenceProps) => {
  const { furigana = [], dictHits = [], conjHits = [], particles = [], kanjidic = {} } = sentencesDb[line]?.data || {};
  const numKanji = Object.keys(kanjidic).length;
  const className = furigana.length === 0 ? "no-furigana" : "";
  return (
    <div>
      <h2 className={styles[className]} lang={"ja"}>
        {furigana.length ? <Furigana vv={furigana} /> : line}
      </h2>
      <ul>
        {dictHits.length ? (
          <li key="d">
            <ul>
              {dictHits.map((h) => (
                <li>
                  {h.startIdx}-{h.endIdx}: {renderKanji(h.word)} 「{renderKana(h.word)}」 {circleNumber(h.sense)}{" "}
                  {renderSenses(h.word, tags)[h.sense]} <sub>{h.word.id}</sub>
                </li>
              ))}
            </ul>
          </li>
        ) : (
          <></>
        )}
        {conjHits.length ? (
          <li key="c">
            <ul>
              {conjHits.map((foundConj) => (
                <li>
                  {foundConj.cloze.cloze} = <Furigana vv={[foundConj.lemmas[0]]} />{" "}
                  {(function () {
                    const key = clozeToKey(foundConj);
                    const x = conjHits.find((dec) => clozeToKey(dec) === key)?.selectedDeconj;
                    if (!x) return "0";
                    const renderedX = renderDeconjugation(x);
                    const found = (foundConj.deconj as Ugh<typeof foundConj.deconj>).find(
                      (p) => renderDeconjugation(p) === renderedX
                    );
                    if (found) {
                      return renderDeconjugation(found);
                    }
                  })()}
                </li>
              ))}
            </ul>
          </li>
        ) : (
          <></>
        )}
        {particles.length ? (
          <li key="p">
            <ul>
              {particles.map((foundParticle) => {
                return (
                  <li>
                    <>
                      <sub>{foundParticle.cloze.left}</sub>
                      {foundParticle.cloze.cloze}
                      <sub>{foundParticle.cloze.right}</sub>:{" "}
                      {foundParticle.morphemes.map((m) => m.partOfSpeech.join("/")).join(", ")}{" "}
                      {foundParticle.chino.length &&
                        chinoMap.get(particles.find((x) => clozeToKey(foundParticle) === clozeToKey(x))?.chinoTag || "")
                          ?.fullLine}
                    </>
                  </li>
                );
              })}
            </ul>
          </li>
        ) : (
          <></>
        )}
        {numKanji ? (
          <li key="k">
            <details>
              <summary>{numKanji} kanji</summary>
              <Kanjidic hits={kanjidic} />
            </details>
          </li>
        ) : (
          <></>
        )}
      </ul>
    </div>
  );
};

interface KanjidicProps {
  hits: v1ResSentenceAnalyzed["kanjidic"];
}
function Kanjidic({ hits }: KanjidicProps) {
  return (
    <ul>
      {Object.values(hits).map((dic) => (
        <li>
          {renderKanjidicRoot(dic)}
          <ul>
            {dic.dependencies.map((root) => (
              <KanjidicChild root={root} />
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
        {root.children.map((child) => (
          <KanjidicChild root={child} />
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

async function saveDb(line: string, { dictHits, conjHits, particles, furigana, kanjidic }: SentenceDbEntry) {
  const post =
    dictHits.length > 0 ||
    conjHits.length > 0 ||
    particles.length > 0 ||
    furigana.length > 0 ||
    Object.keys(kanjidic).length > 0;
  const data: SentenceDbEntry = { dictHits, conjHits, particles, furigana, kanjidic };
  const res = await fetch(`${HELPER_URL}/sentence`, {
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
}

// https://stackoverflow.com/questions/70843127#comment128628953_70843200
type Ugh<T> = (T extends (infer X)[] ? X : never)[];

export default function HomePage({
  sentences: sentencesDb,
  particlesMarkdown,
  tags,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  const chinoMap = setup(particlesMarkdown).nestedMap;

  const [annotating, setAnnotating] = useState(new Set<string>());

  const s = (s: string) =>
    !annotating.has(s) ? (
      <>
        <RenderSentence key={s} line={s} sentencesDb={sentencesDb} tags={tags} chinoMap={chinoMap} />
        <button onClick={() => setAnnotating(new Set(annotating).add(s))}>Annotate above</button>
      </>
    ) : (
      <>
        <Annotate key={s} line={s} sentencesDb={sentencesDb} />
        <button onClick={() => setAnnotating(new Set([...annotating].filter((x) => x !== s)))}>Done annotating</button>
      </>
    );
  return (
    <div>
      <p>Here's the first line of Oshiri Tantei #3.</p>
      {s("ある日の朝早く、ジリリリンとおしりたんてい事務所の電話が鳴りました。")}
      <p>And the second.</p>
      {s("ブラウンは眠い目をこすりながら受話器を取りました")}
      {s("わしじゃ！")}
      {s("今すぐワンコロ警察署に来てくれたまえ！")}
      {s("せっかちなんだから")}
      <p>We're done with the first page! Page 3 in the book—</p>
      {s("フム、どなたからでしたか？")}
      {s("「マルチーズ署長です」")}
      {s("「ワンコロ警察署まで来てくれって」おしりたんていとブラウンは急いで出かける準備をしました")}
      <p>ポフ is SFX for his hat hitting his head.</p>
      <p>Onto page 4!!</p>
      {s("階段を降りると鈴が『ラッキーキャット』の前でバイクを磨いていました")}
      {s("「おはよう。朝っぱらから仕事か？」と鈴が尋ねました")}
      {s("「ワンコロ警察署に行くんです。朝ご飯もまだだったのに」")}
      {s("ブラウンは欠伸をしながら答えました")}
      {s("かっこいいバイクですね")}
      {s("だろ？バイト掛け持ちして買ったんだ")}
      <p>Page 5</p>
      {s("おしりたんていとブラウンはワンコロ警察署に着きました")}
      {s("「お待ちしておりました！」")}
      {s("ガタイの良い刑事たちが出迎えます")}
      {s("さぁ、こちらへ。マルチーズ署長がお待ちです")}
      {s("３個のおしりを探せ")}
      {s("市民の安全")}
      {s("安全ナンバーワン")}
      {s("ワンダフルな町へ")}
      <p>Picking up the pace, are we?</p>
      {s("大きく立派な机の前にマルチーズ署長がちょこんと座っています")}
      {s("待っておったぞ！")}
      {s("おしりたんていくん。ブラウンも久しぶりじゃな")}
      {s("「フム、早速お電話をお伺いしましょうか」")}
      {s("犬")}
      {s("スタッ")}
      {s("ブラックシャドー団という面倒な奴らが現われてな。")}
      {s("諸君、詳しい説明を頼む")}
      {s("ブラックシャドー団は集団で盗みを行う窃盗団でお金持ちの家を狙い、家にある物全て根こそぎ盗んでいきます。")}
      <p>
        Learner's note: see Kamiya <em>Handbook of Japanese Verbs</em>, page 54, for more on the "Vconj + Vconj + masu"
        form.
      </p>
      {s("メンバーは沢山いて、いくら捕まえても一向に減らないのです")}
      {s("そしてついにこの町にもブラックシャドー団がやってきたようなのです")}
      {s("ブラックシャドーメンドー")}
      {s("そうなんじゃ！")}
      {s("ブラックシャドー団と思われるやつを捕まえたんじゃよ！")}
      {s("ワンコロ警察署で一番偉くて優秀なこのわしがな！")}
      {s("それは昨日のことじゃった")}
      <p>(Above, we think じゃった is だ+past tense, with the usual way the chief replaces だ with じゃ.)</p>
      {s("オレンジが")}
      {s("丸いもの！")}
      {s("ビシャー")}
      {s("器物損壊で現行犯逮捕じゃ")}
      {s("わしの丸いもの")}
      {s("マルチーズ署長は得意げな顔でえっへんと咳払いをしました")}
      {s("ほとんど言いがかりなんじゃ")}
      {s("丸い物の愛着がすごいんです")}
      {s("見境がなくなるんです")}
      {s("秘")}
      {s("フム、なぜブラックシャドー団のメンバーだと分かったのですか？")}
      {s("「これを見てくれい」")}
      {s("マルチーズ署長は、おしりたんていに資料を渡しました")}
      {s("資料はほかの町で捕らえられたブラックシャドー団のメンバーたちの写真でした")}
      {s("おしりたんていは一目見て")}
      {s("フム、そういうことですか")}
      {s("何かわかったんですか？")}
      {s("フム、メンバーたちには一つ共通しているものがあります。それはなんでしょう？")}
      {s("ブラックシャドー団逮捕者リスト")}
      {s("そうです。ペンダントですね。")}
      {s("「ペンダントはブラックシャドー団のメンバーということを示しているのではないですか？」")}
      {s("マルチーズ署長が捕まえた方もペンダントをつけていたのですね")}
      {s("さすがじゃ！")}
      {s("話が早いわい！")}
      <p>The above is an idiom: "easy to get to the point" (page 68 in Akiyama and Akiyama)</p>
      {s("これがそやつのつけていたペンダントじゃ")}
      {s("ブラックシャドー団はこのペンダントをつけているのか")}
      <p>We've finished page 12!</p>
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
