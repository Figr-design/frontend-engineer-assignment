import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { installBridge } from "./bridgeHost.js";
import "./styles.css";

installBridge();
createRoot(document.getElementById("root")).render(<App />);
