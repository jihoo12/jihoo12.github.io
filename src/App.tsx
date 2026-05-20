import { HashRouter, Routes, Route } from "react-router-dom";
import "./style.css";
import Home from "./pages/Home";
import Repo from "./pages/Repo";
import Learn from "./pages/Learn";
import Organizations from "./pages/Organizations";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/repo" element={<Repo />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/orgs" element={<Organizations />} />
      </Routes>
    </HashRouter>
  );
}