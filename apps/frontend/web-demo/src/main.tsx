import React from "react";
import ReactDOM from "react-dom/client";

import { isSupportedJoongnaPage } from "../../shared/page-target";
import { App } from "./App";
import { ensureContentRoot } from "./content-root";
import "./styles.css";

if (isSupportedJoongnaPage(window.location.href)) {
  const rootElement = ensureContentRoot();

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App pageHtml={document.documentElement.outerHTML} pageUrl={window.location.href} />
    </React.StrictMode>,
  );
}
