import Layout from "../Layout";

interface Org {
  href: string;
  label: string;
}

const orgs: Org[] = [
  { href: "https://bug-free-octo-couscous.github.io/", label: "bug-free-octo-couscous" },
  { href: "https://fantastic-doodle.github.io/", label: "fantastic-doodle" },
];

export default function Organizations() {
  return (
    <Layout>
      <h2 className="post-title">my organizations</h2>
      <div className="post-container">
        {orgs.map(o => (
          <a key={o.href} href={o.href}>{o.label}</a>
        ))}
      </div>
    </Layout>
  );
}