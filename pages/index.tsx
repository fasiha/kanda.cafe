import type { InferGetStaticPropsType } from "next";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { useMemo, useState } from "react";
import styles from "../styles/Home.module.css";

import { v1ResSentenceAnalyzed, Word } from "curtiz-japanese-nlp/interfaces";

import { setup } from "../components/ChinoParticlePicker";
import { hidden } from "../hidden";
import { Annotate, RenderSentence, SentenceDb, SentenceDbEntry } from "../components/annotator";

export const getStaticProps = async () => {
  const parentDir = path.join(process.cwd(), "data");
  const jsons = (await readdir(parentDir)).filter((f) => f.toLowerCase().endsWith(".json"));
  const sentences: { data: SentenceDbEntry; sentence: string }[] = await Promise.all(
    jsons.map((j) => readFile(path.join(parentDir, j), "utf8").then((x) => JSON.parse(x)))
  );
  const obj: SentenceDb = Object.fromEntries(
    sentences.map((s, idx) => [s.sentence, { ...s, hash: jsons[idx].split(".")[0] }])
  ); // TODO validate

  const particlesMarkdown = await readFile("all-about-particles.md", "utf8");
  const tags: NonNullable<v1ResSentenceAnalyzed["tags"]> = JSON.parse(await readFile("tags.json", "utf8"));
  return { props: { sentences: obj, particlesMarkdown, tags } };
};

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

  const sentenceHelper = (s: string, old?: string) =>
    !annotating.has(s) ? (
      <>
        <RenderSentence key={s} line={s} sentencesDb={sentencesDb} tags={tags} />
        <button className={styles["edit-done-edit"]} onClick={() => setAnnotating(new Set(annotating).add(s))}>
          📝
        </button>
      </>
    ) : (
      <div>
        <button
          className={styles["edit-done-edit"]}
          onClick={() => setAnnotating(new Set([...annotating].filter((x) => x !== s)))}
        >
          ✅ Done
        </button>
        <Annotate key={s} line={s} oldLine={old} sentencesDb={sentencesDb} allDictHits={allDictHits} />
        <button
          className={styles["edit-done-edit"]}
          onClick={() => setAnnotating(new Set([...annotating].filter((x) => x !== s)))}
        >
          ✅ Done
        </button>
      </div>
    );
  return hidden(sentenceHelper);
}
