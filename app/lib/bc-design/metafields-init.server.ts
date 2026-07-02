import { adminGraphql, type AdminGraphqlClient } from "./admin-graphql.server";

export async function ensureMetafieldDefinitions(admin: AdminGraphqlClient) {
  const query = `#graphql
    query {
      metafieldDefinitions(first: 100, ownerType: PRODUCT) {
        edges {
          node {
            id
            name
            namespace
            key
            pinnedPosition
          }
        }
      }
    }
  `;
  try {
    const res = await adminGraphql<any>(admin, query);
    const existing = new Map<string, { id: string; name: string; pinned: boolean }>();
    const edges = res.metafieldDefinitions?.edges || [];
    for (const edge of edges) {
      if (edge.node) {
        existing.set(
          `${edge.node.namespace}.${edge.node.key}`,
          {
            id: edge.node.id,
            name: edge.node.name,
            pinned: edge.node.pinnedPosition !== null && edge.node.pinnedPosition !== undefined
          }
        );
      }
    }

    const requiredDefinitions = [
      {
        name: "BC Enabled",
        namespace: "bc_design",
        key: "enabled",
        ownerType: "PRODUCT",
        type: "boolean",
        description: "Turn on/off BC Design custom product detail for this product."
      },
      {
        name: "BC Subtitle",
        namespace: "bc_design",
        key: "subtitle",
        ownerType: "PRODUCT",
        type: "single_line_text_field",
        description: "Used for BC Design custom product detail subtitle."
      },
      {
        name: "BC Rating",
        namespace: "bc_design",
        key: "rating",
        ownerType: "PRODUCT",
        type: "number_decimal",
        description: "Used for BC Design custom product rating."
      },
      {
        name: "BC Features",
        namespace: "bc_design",
        key: "features",
        ownerType: "PRODUCT",
        type: "list.single_line_text_field",
        description: "Used for BC Design product features bullet points."
      },
      {
        name: "BC 3D Image",
        namespace: "bc_design",
        key: "three_d_image",
        ownerType: "PRODUCT",
        type: "file_reference",
        description: "File reference for 3D tab picture."
      },
      {
        name: "BC Parts Image",
        namespace: "bc_design",
        key: "parts_image",
        ownerType: "PRODUCT",
        type: "file_reference",
        description: "File reference for Parts List tab picture."
      },
      {
        name: "BC Video",
        namespace: "bc_design",
        key: "video",
        ownerType: "PRODUCT",
        type: "file_reference",
        description: "File reference for Video tab mp4 file."
      }
    ];

    const createMutation = `#graphql
      mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const updateMutation = `#graphql
      mutation UpdateMetafieldDefinition($definition: MetafieldDefinitionUpdateInput!) {
        metafieldDefinitionUpdate(definition: $definition) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    const pinMutation = `#graphql
      mutation PinMetafieldDefinition($id: ID!) {
        metafieldDefinitionPin(definitionId: $id) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    for (const def of requiredDefinitions) {
      const fullKey = `${def.namespace}.${def.key}`;
      const existInfo = existing.get(fullKey);

      if (!existInfo) {
        console.log(`[BC Design] Creating missing metafield definition: ${fullKey}`);
        const mRes = await adminGraphql<any>(admin, createMutation, { definition: def });
        const error = mRes.metafieldDefinitionCreate?.userErrors;
        if (error && error.length > 0) {
          console.error(`[BC Design] Failed to create definition ${fullKey}:`, error);
        } else {
          const newId = mRes.metafieldDefinitionCreate?.createdDefinition?.id;
          if (newId) {
            console.log(`[BC Design] Pinning newly created definition: ${fullKey}`);
            await adminGraphql<any>(admin, pinMutation, { id: newId });
          }
        }
      } else {
        if (existInfo.name !== def.name) {
          const uRes = await adminGraphql<any>(admin, updateMutation, {
            definition: {
              namespace: def.namespace,
              key: def.key,
              ownerType: "PRODUCT",
              name: def.name
            }
          });
          const error = uRes.metafieldDefinitionUpdate?.userErrors;
          if (error && error.length > 0) {
            console.error(`[BC Design] Failed to update definition name for ${fullKey}:`, error);
          }
        }
        if (!existInfo.pinned) {
          console.log(`[BC Design] Pinning existing definition: ${fullKey}`);
          const pRes = await adminGraphql<any>(admin, pinMutation, { id: existInfo.id });
          const error = pRes.metafieldDefinitionPin?.userErrors;
          if (error && error.length > 0) {
            console.error(`[BC Design] Failed to pin definition ${fullKey}:`, error);
          }
        }
      }
    }
  } catch (e) {
    console.error("[BC Design] Failed to verify, update or pin metafield definitions:", e);
  }
}
