import { HashRouter, Routes, Route } from "react-router-dom";
import "./style.css";
import Home from "./pages/Home";
import Proj from "./pages/projects";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Proj />} />
      </Routes>
    </HashRouter>
  );
}