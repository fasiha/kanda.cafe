import type { NextPage } from "next";
import Head from "next/head";
import Image from "next/image";
import { createElement, useEffect, useState } from "react";
import styles from "../styles/Home.module.css";

import {
  v1ResSentenceAnalyzed,
  Furigana,
  Xref,
  Word,
  Sense,
} from "curtiz-japanese-nlp/interfaces";

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
          sense[k as TagKey].length
            ? ` (${v} ${sense[k as TagKey].map((k) => tags[k]).join("; ")})`
            : ""
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
function concatIfNew<X, Y>(v: X[], x: X, key: (x: X) => Y) {
  const ys = new Set(v.map(key));
  const y = key(x);
  if (ys.has(y)) {
    return v;
  }
  return v.concat(x);
}
function circleNumber(n: number): string {
  const circledNumbers =
    "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿";
  return circledNumbers[n] || "" + n;
}

const Annotate = () => {
  // This component will be called for lines that haven't been annotated yet.
  // This should not work in static-generated output, ideally it won't exist.
  const line =
    "ある日の朝早く、ジリリリンとおしりたんてい事務所の電話が鳴りました。";

  const [nlp, setNlp] = useState<v1ResSentenceAnalyzed | undefined>(undefined);
  const [hits, setHits] = useState<
    {
      startIdx: number;
      endIdx: number;
      word: Word;
      sense: number;
    }[]
  >([]);
  const idxsCovered = new Set(hits.flatMap((o) => range(o.startIdx, o.endIdx)));

  useEffect(() => {
    // Yes this will run twice in dev mode, see
    // https://reactjs.org/blog/2022/03/29/react-v18.html#new-strict-mode-behaviors
    if (!nlp) {
      (async function main() {
        const req = await fetch(`http://localhost:3010/sentence/${line}`, {
          headers: { Accept: "application/json" },
        });
        const data = await req.json();
        setNlp(data);
      })();
    }
  }, []);

  if (!nlp) {
    return <>{line}</>;
  }
  console.log(nlp);
  if (!nlp.tags) {
    throw new Error("tags expected");
  }
  const { tags } = nlp;
  return (
    <div>
      <p lang={"ja"}>
        <Furigana vv={nlp.furigana} />
      </p>
      <p>Hits</p>
      <ul>
        {hits.map((h) => (
          <li>
            {h.startIdx}-{h.endIdx}: {renderKanji(h.word)} 「
            {renderKana(h.word)}」 {circleNumber(h.sense)}{" "}
            {renderSenses(h.word, tags)[h.sense]}
          </li>
        ))}
      </ul>
      <ol>
        {nlp.hits.map(
          (scoreHits, outerIdx) =>
            scoreHits.results.length > 0 && (
              <li key={outerIdx} value={outerIdx}>
                <ol>
                  {scoreHits.results.map((res, innerIdx) => (
                    <li>
                      <details
                        open={range(scoreHits.startIdx, res.endIdx).some(
                          (x) => !idxsCovered.has(x)
                        )}
                      >
                        <summary>
                          {typeof res.run === "string"
                            ? res.run
                            : res.run.cloze}
                        </summary>
                        <ol>
                          {res.results.map((hit, wordIdx) => {
                            if (!hit.word) {
                              throw new Error("word expected");
                            }
                            const word = hit.word;
                            return (
                              <li>
                                <sup>{hit.search}</sup> {renderKanji(hit.word)}{" "}
                                「{renderKana(hit.word)}」 (#{hit.word.id})
                                <ol>
                                  {renderSenses(hit.word, tags).map(
                                    (s, senseIdx) => (
                                      <li>
                                        <>
                                          {s}{" "}
                                          <button
                                            onClick={() => {
                                              setHits(
                                                concatIfNew(
                                                  hits,
                                                  {
                                                    startIdx:
                                                      scoreHits.startIdx,
                                                    endIdx: res.endIdx,
                                                    word: word,
                                                    sense: senseIdx,
                                                  },
                                                  (x) =>
                                                    `${x.startIdx}/${x.endIdx}/${x.word.id}`
                                                )
                                              );
                                            }}
                                          >
                                            Pick
                                          </button>
                                        </>
                                      </li>
                                    )
                                  )}
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
    </div>
  );
};

const Home: NextPage = () => {
  return (
    <div>
      <p>Here's the first line of Oshiri Tantei #3.</p>
      <Annotate />
    </div>
  );
};

export default Home;
