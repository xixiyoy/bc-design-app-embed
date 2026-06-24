import {
  adminGraphql,
  type AdminGraphqlClient,
} from "./admin-graphql.server";

export type ShopifyMenuItem = {
  id: string;
  title: string;
  url?: string | null;
  type: string;
  items: ShopifyMenuItem[];
};

export type ShopifyMenu = {
  id: string;
  handle: string;
  title: string;
  items: ShopifyMenuItem[];
};

type MenusQueryData = {
  menus: {
    nodes: Array<{
      id: string;
      handle: string;
      title: string;
      items: ShopifyMenuItem[];
    }>;
  };
};

type MenuByIdQueryData = {
  menu: {
    id: string;
    handle: string;
    title: string;
    items: ShopifyMenuItem[];
  } | null;
};

const MENUS_QUERY = `#graphql
  query MenusForBcDesign($first: Int!) {
    menus(first: $first) {
      nodes {
        id
        handle
        title
        items {
          id
          title
          url
          type
          items {
            id
            title
            url
            type
            items {
              id
              title
              url
              type
            }
          }
        }
      }
    }
  }
`;

const MENU_BY_ID_QUERY = `#graphql
  query MenuByIdForBcDesign($id: ID!) {
    menu(id: $id) {
      id
      handle
      title
      items {
        id
        title
        url
        type
        items {
          id
          title
          url
          type
          items {
            id
            title
            url
            type
          }
        }
      }
    }
  }
`;

export async function loadMenus(admin: AdminGraphqlClient): Promise<ShopifyMenu[]> {
  const data = await adminGraphql<MenusQueryData>(admin, MENUS_QUERY, {
    first: 50,
  });
  return data.menus.nodes;
}

export async function loadMenu(
  admin: AdminGraphqlClient,
  idOrHandle: string,
): Promise<ShopifyMenu | null> {
  const menus = await loadMenus(admin);
  const normalized = idOrHandle.trim();
  const fromList = menus.find(
    (menu) => menu.id === normalized || menu.handle === normalized,
  );
  if (fromList) {
    return fromList;
  }

  if (normalized.startsWith("gid://")) {
    const data = await adminGraphql<MenuByIdQueryData>(admin, MENU_BY_ID_QUERY, {
      id: normalized,
    });
    return data.menu;
  }

  return menus.find((menu) => menu.handle === normalized) ?? null;
}
