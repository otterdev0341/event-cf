type BrandSize = "header" | "hero" | "card";
type BrandTone = "light" | "dark";

interface BrandProps {
  href?: string;
  size?: BrandSize;
  tone?: BrandTone;
}

export function Brand({
  href,
  size = "header",
  tone = "light",
}: BrandProps) {
  const className = `brand brand--${size} brand--${tone}`;
  const content = (
    <>
      <span className="brand__mark" aria-hidden="true">
        <img src="/assets/audio-lines.svg" width="20" height="20" alt="" />
      </span>
      <span className="brand__name">Voice Confirm</span>
    </>
  );

  if (href) {
    return (
      <a className={className} href={href} aria-label="Voice Confirm หน้าหลัก">
        {content}
      </a>
    );
  }

  return <div className={className}>{content}</div>;
}

