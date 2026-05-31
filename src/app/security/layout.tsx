import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security Threat Model — RepoLense",
  description:
    "Attack surface analyzer and security threat model for repository infrastructure. Visualize potential attack vectors, assess vulnerabilities, and generate remediation plans.",
};

export default function SecurityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
