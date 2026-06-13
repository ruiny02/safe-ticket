import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { ensureContentRoot, keepContentRootMounted } from "./content-root";
import "./styles.css";

const rootElement = ensureContentRoot();
keepContentRootMounted(rootElement);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App pageUrl={window.location.href} />
  </React.StrictMode>,
);
