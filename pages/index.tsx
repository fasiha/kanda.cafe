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

function renderKanji(w: Word | undefined) {
  if (!w) {
    throw new Error("undefined input");
  }
  return w.kanji.map((k) => k.text).join("・");
}
function renderKana(w: Word | undefined) {
  if (!w) {
    throw new Error("undefined input");
  }
  return w.kana.map((k) => k.text).join("・");
}
function printXrefs(v: Xref[]) {
  return v.map((x) => x.join(",")).join(";");
}
function renderSenses(
  w: Word | undefined,
  tags: Record<string, string> | undefined
): string[] {
  if (!w || !tags) {
    throw new Error("undefined input");
  }
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

const Annotate = () => {
  // This component will be called for lines that haven't been annotated yet.
  // This should not work in static-generated output, ideally it won't exist.
  const line =
    "ある日の朝早く、ジリリリンとおしりたんてい事務所の電話が鳴りました。";

  const [nlp, setNlp] = useState<v1ResSentenceAnalyzed | undefined>(undefined);

  useEffect(() => {
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
  // Yes the above will run twice in dev mode, see
  // https://reactjs.org/blog/2022/03/29/react-v18.html#new-strict-mode-behaviors

  if (!nlp) {
    return <>{line}</>;
  }
  console.log(nlp);
  return (
    <div>
      <p lang={"ja"}>
        <Furigana vv={nlp.furigana} />
      </p>
      <ol>
        {nlp.hits.map(
          (scoreHits, i) =>
            scoreHits.results.length > 0 && (
              <li key={i} value={i}>
                <ol>
                  {scoreHits.results.map((res) => (
                    <li>
                      <ol>
                        {res.results.map((r) => (
                          <li>
                            <sup>{r.search}</sup> {renderKanji(r.word)} 「
                            {renderKana(r.word)}」 (#{r.word?.id})
                            <ol>
                              {renderSenses(r.word, nlp.tags).map((s) => (
                                <li>{s}</li>
                              ))}
                            </ol>
                          </li>
                        ))}
                      </ol>
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
