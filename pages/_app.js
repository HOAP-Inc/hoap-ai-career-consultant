// pages/_app.js
import "../styles/globals.css";
import dynamic from "next/dynamic";

const HoapChat = dynamic(() => import("../components/HoapChat"), { ssr: false });

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <HoapChat />
    </>
  );
}
