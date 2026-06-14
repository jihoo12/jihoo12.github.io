import Layout from "../Layout";
import hitakiChitose from "../assets/jihoo.jpg";

export default function Home() {
  return (
    <Layout>
      <div className="hero-image-card">
        <img src={hitakiChitose} alt="jihoo" className="hero-image" />
      </div>
      <h2 className="post-title">Jihoo</h2>
      <div className="post-container">
        <h3>about me</h3>
        <p>I am studying Python, Rust</p>
      </div>
    </Layout>
  );
}