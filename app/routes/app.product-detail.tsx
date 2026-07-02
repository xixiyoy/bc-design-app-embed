import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  return { shop };
};

export default function ProductDetailPage() {
  const { shop } = useLoaderData<typeof loader>();
  const productsUrl = `https://${shop}/admin/products`;

  return (
    <div style={{ padding: "40px", fontFamily: "system-ui", maxWidth: "800px", margin: "0 auto" }}>
      <div
        style={{
          background: "#ffffff",
          padding: "32px",
          borderRadius: "16px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
          border: "1px solid #e1e3e5",
        }}
      >
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "700",
            color: "#1a1a1a",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span>✨</span> BC Design Custom Product Detail
        </h1>
        <p style={{ fontSize: "16px", color: "#5c5f62", lineHeight: "1.6", marginBottom: "24px" }}>
          本 App 已完美接入 Shopify 官方商品自定义属性（Metafields）。您无需再在 App 内进行任何繁杂的二套配置。所有定制内容均已直接在您的 Shopify 商品编辑页面中置顶固定（Pinned）！
        </p>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px" }}>
          <a
            href={productsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#008060",
              color: "#ffffff",
              fontWeight: "600",
              padding: "16px 32px",
              borderRadius: "8px",
              textDecoration: "none",
              boxShadow: "0 4px 12px rgba(0, 128, 96, 0.2)",
              transition: "all 0.2s ease",
            }}
          >
            👉 直达 Shopify 商品列表编辑商品
          </a>
        </div>

        <h2
          style={{
            fontSize: "20px",
            fontWeight: "600",
            color: "#202223",
            marginBottom: "16px",
            borderBottom: "1px solid #f1f2f3",
            paddingBottom: "10px",
          }}
        >
          ⚙️ 字段使用说明 (置顶固定项目)
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", padding: "12px", borderBottom: "1px solid #f1f2f3" }}>
            <strong style={{ width: "240px", color: "#008060", flexShrink: 0 }}>
              bc-design-product-detail-enabled
            </strong>
            <span style={{ color: "#5c5f62" }}>
              是否启用自定义产品详情页（启用后本商品将自动启用 BC 定制风格，隐藏默认详情）。
            </span>
          </div>
          <div style={{ display: "flex", padding: "12px", borderBottom: "1px solid #f1f2f3" }}>
            <strong style={{ width: "240px", color: "#008060", flexShrink: 0 }}>
              bc-design-product-detail-subtitle
            </strong>
            <span style={{ color: "#5c5f62" }}>商品副标题。</span>
          </div>
          <div style={{ display: "flex", padding: "12px", borderBottom: "1px solid #f1f2f3" }}>
            <strong style={{ width: "240px", color: "#008060", flexShrink: 0 }}>
              bc-design-product-detail-rating
            </strong>
            <span style={{ color: "#5c5f62" }}>商品评分（小数形式，例如 4.9）。</span>
          </div>
          <div style={{ display: "flex", padding: "12px", borderBottom: "1px solid #f1f2f3" }}>
            <strong style={{ width: "240px", color: "#008060", flexShrink: 0 }}>
              bc-design-product-detail-features
            </strong>
            <span style={{ color: "#5c5f62" }}>商品核心特色列表（直接输入多行文本列表）。</span>
          </div>
          <div style={{ display: "flex", padding: "12px", borderBottom: "1px solid #f1f2f3" }}>
            <strong style={{ width: "240px", color: "#008060", flexShrink: 0 }}>
              bc-design-product-detail-three_d_image
            </strong>
            <span style={{ color: "#5c5f62" }}>3D Tab 大图。</span>
          </div>
          <div style={{ display: "flex", padding: "12px", borderBottom: "1px solid #f1f2f3" }}>
            <strong style={{ width: "240px", color: "#008060", flexShrink: 0 }}>
              bc-design-product-detail-parts_image
            </strong>
            <span style={{ color: "#5c5f62" }}>
              物品清单大图（若上传，则前台自动显现“物品清单” Tab）。
            </span>
          </div>
          <div style={{ display: "flex", padding: "12px", borderBottom: "1px solid #f1f2f3" }}>
            <strong style={{ width: "240px", color: "#008060", flexShrink: 0 }}>
              bc-design-product-detail-video
            </strong>
            <span style={{ color: "#5c5f62" }}>
              商品演示视频（若上传，则前台自动显现“Video” Tab，点击可直接静音轮播）。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
