import Layout from "../Layout";

export default function Current() {
  return (
    <Layout>
      <h2 className="post-title">current</h2>
      <div className="post-container">
        <h3>i use nixos</h3>
        <p>I am studying Haskell, Python, TypeScript, and React.</p>
        <p>
          I am interested in 
          AI, homotopy type theory, category theory, type theory,
          cubical type theory, foraml verification,
          etc.
        </p>
      </div>
    </Layout>
  );
}