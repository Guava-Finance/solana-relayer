import "../styles/globals.css";
import type { AppProps } from "next/app";
import { ContextProvider } from "../components/provider";
import { NextUIProvider } from "@nextui-org/react";
import { theme } from "../styles/theme";
import { ToastBar, Toaster } from "react-hot-toast";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <NextUIProvider theme={theme}>
      <ContextProvider>
        <Toaster />
        <Component {...pageProps} />
      </ContextProvider>
    </NextUIProvider>
  );
}

export default MyApp;
