import Layout from "../Layout";
import hitakiChitose from "../assets/hitaki_chitose.jpg";

export default function Home() {
  return (
    <Layout>
      <div className="hero-image-card">
        <img src={hitakiChitose} alt="hitaki chitose" className="hero-image" />
      </div>
      <h2 className="post-title">Hello, I'm Jihoo</h2>
      <div className="post-container">
        <h3>i use nixos</h3>
        <p>I am studying Haskell, Python, Rust</p>
      </div>
    </Layout>
  );
}