import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./style.css";
import Home from "./pages/Home";
import Repo from "./pages/Repo";
import Learn from "./pages/Learn";
import Organizations from "./pages/Organizations";

export default function App() {
  return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/repo" element={<Repo />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/orgs" element={<Organizations />} />
        </Routes>
      </BrowserRouter>
  );
}