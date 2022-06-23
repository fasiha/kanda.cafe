import type { NextPage } from "next";
import Head from "next/head";
import Image from "next/image";
import styles from "../styles/Home.module.css";

const Line1 = () => {
  const line =
    "ある日の朝早く、ジリリリんとおしりたんてい事務所の電話が鳴りました。";

  return <>{line}</>;
};

const Home: NextPage = () => {
  return (
    <div>
      <p>Here's the first line of Oshiri Tantei #3.</p>
      <Line1 />
    </div>
  );
};

export default Home;
