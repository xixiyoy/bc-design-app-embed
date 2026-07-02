import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="BC Design">
      <s-section heading="Storefront modules">
        <s-paragraph>
          Configure the storefront Navigation and Banner modules from the app
          admin.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-link href="/app/navigation">Configure navigation</s-link>
          <s-link href="/app/banner">Configure banner</s-link>
          <s-link href="/app/product-detail">Configure product detail</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
