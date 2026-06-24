import {
  adminGraphql,
  assertNoUserErrors,
  type AdminGraphqlClient,
} from "./admin-graphql.server";

const METAFIELD_NAMESPACE = "custom";

const PRODUCT_BADGE_DEFINITIONS = [
  {
    namespace: "custom",
    key: "nav_tag",
    name: "Navigation tag",
    description:
      "Badge image at the top-left of this product in the navigation mega menu. Leave empty to hide.",
  },
  {
    namespace: "custom",
    key: "tips_tag",
    name: "Tips tag",
    description:
      "Badge image at the top-right of this product in the navigation mega menu (e.g. NEW). Leave empty to hide.",
  },
] as const;

type MetafieldDefinitionNode = {
  id: string;
  pinnedPosition?: number | null;
};

type DefinitionListData = {
  metafieldDefinitions: {
    nodes: MetafieldDefinitionNode[];
  };
};

type DefinitionCreateData = {
  metafieldDefinitionCreate: {
    createdDefinition?: MetafieldDefinitionNode | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

type DefinitionPinData = {
  metafieldDefinitionPin: {
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

const DEFINITION_LIST_QUERY = `#graphql
  query ProductBadgeMetafieldDefinition($namespace: String!, $key: String!) {
    metafieldDefinitions(
      first: 1
      ownerType: PRODUCT
      namespace: $namespace
      key: $key
    ) {
      nodes {
        id
        pinnedPosition
      }
    }
  }
`;

const DEFINITION_CREATE_MUTATION = `#graphql
  mutation CreateProductBadgeMetafieldDefinition(
    $definition: MetafieldDefinitionInput!
  ) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        pinnedPosition
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const DEFINITION_PIN_MUTATION = `#graphql
  mutation PinProductBadgeMetafieldDefinition($definitionId: ID!) {
    metafieldDefinitionPin(definitionId: $definitionId) {
      pinnedDefinition {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function ensurePinnedProductBadgeDefinition(
  admin: AdminGraphqlClient,
  spec: (typeof PRODUCT_BADGE_DEFINITIONS)[number],
): Promise<{ ok: boolean; message: string }> {
  const listData = await adminGraphql<DefinitionListData>(
    admin,
    DEFINITION_LIST_QUERY,
    {
      namespace: spec.namespace,
      key: spec.key,
    },
  );

  let definitionId: string | null =
    listData.metafieldDefinitions.nodes[0]?.id ?? null;
  const pinnedPosition =
    listData.metafieldDefinitions.nodes[0]?.pinnedPosition ?? null;

  if (!definitionId) {
    const createData = await adminGraphql<DefinitionCreateData>(
      admin,
      DEFINITION_CREATE_MUTATION,
      {
        definition: {
          name: spec.name,
          namespace: METAFIELD_NAMESPACE,
          key: spec.key,
          type: "file_reference",
          ownerType: "PRODUCT",
          pin: true,
          description: spec.description,
          access: {
            storefront: "PUBLIC_READ",
          },
        },
      },
    );

    assertNoUserErrors(createData.metafieldDefinitionCreate.userErrors);

    definitionId =
      createData.metafieldDefinitionCreate.createdDefinition?.id ?? null;
    if (!definitionId) {
      return {
        ok: false,
        message: `${spec.name}: metafieldDefinitionCreate returned no id.`,
      };
    }

    return {
      ok: true,
      message: `${spec.name} created and pinned.`,
    };
  }

  if (pinnedPosition != null) {
    return {
      ok: true,
      message: `${spec.name} is ready.`,
    };
  }

  const pinData = await adminGraphql<DefinitionPinData>(
    admin,
    DEFINITION_PIN_MUTATION,
    { definitionId },
  );
  assertNoUserErrors(pinData.metafieldDefinitionPin.userErrors);

  return {
    ok: true,
    message: `${spec.name} pinned.`,
  };
}

export async function ensureProductBadgeMetafieldDefinitions(
  admin: AdminGraphqlClient,
): Promise<{ ok: boolean; message: string }> {
  const messages: string[] = [];
  let allOk = true;

  for (const spec of PRODUCT_BADGE_DEFINITIONS) {
    const result = await ensurePinnedProductBadgeDefinition(admin, spec);
    messages.push(result.message);
    if (!result.ok) {
      allOk = false;
    }
  }

  return {
    ok: allOk,
    message: allOk
      ? `Navigation tag and Tips tag are ready. ${messages.join(" ")} Refresh the product editor.`
      : messages.join(" "),
  };
}

export { PRODUCT_BADGE_DEFINITIONS };
