import { Link } from "react-router-dom";
import Layout from "../Layout";

export default function Current() {
  return (
    <Layout>
      <h2 className="post-title">current</h2>
      <div className="post-container">
        <h2 className="pink-pink">Now i use nixos as daily driver</h2>
      </div>
      <div className="post-container">
        <Link to="/learn">learn</Link>
      </div>
    </Layout>
  );
}