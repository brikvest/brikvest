import { FaInstagram, FaTiktok, FaLinkedinIn } from "react-icons/fa";

type FooterSocialLinksProps = {
  /** Use on dark footer surfaces; the default follows light/dark page themes. */
  tone?: "default" | "inverse";
};

const socialLinks = [
  { name: "Instagram", href: "https://www.instagram.com/brik.vest/", Icon: FaInstagram },
  { name: "TikTok", href: "https://www.tiktok.com/@brikvest", Icon: FaTiktok },
  { name: "LinkedIn", href: "https://www.linkedin.com/company/brikvest", Icon: FaLinkedinIn },
];

export function FooterSocialLinks({ tone = "default" }: FooterSocialLinksProps) {
  const colors = tone === "inverse"
    ? "text-slate-300 hover:text-white focus-visible:ring-white"
    : "text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white focus-visible:ring-slate-500";

  return (
    <nav aria-label="Brikvest social media" className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {socialLinks.map(({ name, href, Icon }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Brikvest on ${name} (opens in a new tab)`}
          className={`inline-flex min-h-11 items-center gap-2 rounded-sm text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${colors}`}
        >
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>{name}</span>
        </a>
      ))}
    </nav>
  );
}
