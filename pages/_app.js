import Head from "next/head";
import "../styles/globals.css";

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>AIキャリアデザイナー ほーぷちゃん</title>
        <meta
          name="description"
          content="AIキャリアデザイナー ほーぷちゃん - あなたのキャリアを一緒に考えるAIアシスタント"
        />
        <meta property="og:title" content="AIキャリアデザイナー ほーぷちゃん" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://hoap-ai-career-consultant.vercel.app" />
        <meta
          property="og:description"
          content="AIキャリアデザイナー ほーぷちゃんが、あなたのキャリアをやさしくナビゲートします。"
        />
      </Head>
      <Component {...pageProps} />
    </>
  );
}

export default MyApp;
