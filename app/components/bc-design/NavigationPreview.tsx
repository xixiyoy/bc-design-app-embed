import type { NavigationConfig } from "../../lib/bc-design/config-types";
import type { ShopifyMenu } from "../../lib/bc-design/menus.server";

type NavigationPreviewProps = {
  config: NavigationConfig & { logoPreviewUrl?: string };
  menu: ShopifyMenu | null;
};

export function NavigationPreview({ config, menu }: NavigationPreviewProps) {
  const logoSrc =
    config.logoType === "image"
      ? config.logoPreviewUrl ?? config.logoFile
      : undefined;

  return (
    <div className="phaetus-nav-root">
      <nav
        className="navbar"
        style={{
          backgroundColor: config.navBackgroundColor,
          color: config.primaryNavTextColor,
        }}
      >
        <div className="navbar-inner">
          <a className="logo-wrap" href="/">
            {config.logoType === "image" && logoSrc ? (
              <img
                className="logo-img"
                src={logoSrc}
                alt={config.logoText || "Logo"}
                style={{ maxHeight: 40 }}
              />
            ) : (
              <span className="logo-text" style={{ color: config.iconColor }}>
                {config.logoText || "Logo"}
              </span>
            )}
          </a>
          <ul className="nav-menu" style={{ listStyle: "none", display: "flex", gap: 16, margin: 0, padding: 0 }}>
            {(menu?.items ?? []).map((item) => (
              <li className="nav-item" key={item.id}>
                <a
                  href={item.url || "#"}
                  style={{ color: config.primaryNavTextColor, textDecoration: "none" }}
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}
