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
      <h1 className="page-title">my Organizations</h1>
      <div className="chip-grid">
        {orgs.map(r => (
          <a key={r.href} href={r.href} className="chip">{r.label}</a>
        ))}
      </div>
    </Layout>
  );
}