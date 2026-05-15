import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "./ThemeContext";
import "./style.css";
import Home from "./pages/Home";
import Repo from "./pages/Repo";
import Current from "./pages/Current";
import Learn from "./pages/Learn";
import Organizations from "./pages/Organizations";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/repo" element={<Repo />} />
          <Route path="/current" element={<Current />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/orgs" element={<Organizations />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}