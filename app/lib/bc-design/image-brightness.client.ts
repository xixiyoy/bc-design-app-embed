/**
 * Browser-only utility. Calculates average brightness of an image using Canvas.
 * Uses alpha-channel weighting to handle transparent PNG backgrounds.
 * The .client.ts suffix prevents accidental server-side import.
 */

function appendCorsIsolationParam(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("brightness-compute", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

function appendThumbnailParam(url: string): string {
  if (url.includes("cdn.shopify.com") || url.includes("shopifycdn")) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set("width", "100");
      return parsed.toString();
    } catch {
      return url;
    }
  }
  return url;
}

export function calculateImageBrightness(imageUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    let resolved = false;
    const finish = (value: number | null) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };

    const timeoutId = setTimeout(() => finish(null), 10000);

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          clearTimeout(timeoutId);
          finish(null);
          return;
        }

        ctx.drawImage(img, 0, 0, 100, 100);
        const imageData = ctx.getImageData(0, 0, 100, 100);
        const data = imageData.data;

        let totalBrightness = 0;
        let totalWeight = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
          const weight = a / 255;
          totalBrightness += brightness * weight;
          totalWeight += weight;
        }

        clearTimeout(timeoutId);
        const averageBrightness = totalWeight > 0 ? Math.round(totalBrightness / totalWeight) : 0;
        finish(Math.min(255, Math.max(0, averageBrightness)));
      } catch {
        clearTimeout(timeoutId);
        finish(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      finish(null);
    };

    const url = appendCorsIsolationParam(appendThumbnailParam(imageUrl));
    img.src = url;
  });
}
