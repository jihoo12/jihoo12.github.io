import { Link } from "react-router-dom";
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
      <div className="post-container">
        <Link to="/current">current my status</Link>
        <Link to="/repo">my projects</Link>
        <Link to="/orgs">my organizations</Link>
      </div>
    </Layout>
  );
}