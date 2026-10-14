const SECTIONS = [
  { href: "/", id: "storms", label: "Storms" },
  { href: "/traced", id: "traced", label: "Traced" },
  { href: "/messages", id: "messages", label: "Messages" },
  { href: "/costs", id: "costs", label: "Costs" },
] as const;

export function AppNav({ current }: { current: (typeof SECTIONS)[number]["id"] }) {
  return (
    <nav aria-label="Sections" className="flex shrink-0 border border-[#3a342e]">
      {SECTIONS.map((section, index) => {
        const live = current === section.id;
        return (
          <span key={section.id} className="flex">
            {index > 0 ? <span className="w-px bg-[#3a342e]" aria-hidden="true" /> : null}
            <a
              href={section.href}
              aria-current={live ? "page" : undefined}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4783b] ${
                live
                  ? "bg-[#d4783b] text-[#161412]"
                  : "text-[#b7aaa0] hover:bg-[#2a2622] hover:text-[#f3ece3]"
              }`}
            >
              {section.label}
            </a>
          </span>
        );
      })}
    </nav>
  );
}
