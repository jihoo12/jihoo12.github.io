import Layout from "../Layout";

export default function Home() {
  return (
    <Layout>
      <h2 className="post-title">jihoo website</h2>
      <div className="post-container">
        <div className="pink-container">
          こんにちは
          <br />
          これは私のウェブサイトです。
        </div>
      </div>
    </Layout>
  );
}