export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

export async function adminGraphql<TData>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as {
    data?: TData;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  if (!json.data) {
    throw new Error("Shopify Admin GraphQL returned no data.");
  }

  return json.data;
}

export function assertNoUserErrors(errors: ShopifyUserError[] | undefined) {
  if (errors?.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
}
