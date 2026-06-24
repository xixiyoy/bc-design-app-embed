import { useEffect, useId, useRef, useState } from "react";

type MediaFieldProps = {
  name: string;
  label: string;
  value?: string;
  previewUrl?: string;
  onChange?: (file: File | null) => void;
};

export function MediaField({
  name,
  label,
  value,
  previewUrl,
  onChange,
}: MediaFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview) {
        URL.revokeObjectURL(localPreview);
      }
    };
  }, [localPreview]);

  const displayUrl =
    localPreview ??
    previewUrl ??
    (value?.startsWith("http") ? value : undefined);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (localPreview) {
      URL.revokeObjectURL(localPreview);
    }
    if (file) {
      setLocalPreview(URL.createObjectURL(file));
    } else {
      setLocalPreview(null);
    }
    onChange?.(file);
  };

  return (
    <s-stack direction="block" gap="small">
      <s-text type="strong">{label}</s-text>
      {displayUrl ? (
        <img
          src={displayUrl}
          alt={label}
          style={{
            maxWidth: "100%",
            maxHeight: 120,
            objectFit: "contain",
            borderRadius: 4,
            border: "1px solid var(--p-color-border, #e3e3e3)",
          }}
        />
      ) : value?.startsWith("gid://") ? (
        <s-box
          padding="base"
          borderWidth="base"
          borderRadius="base"
          background="subdued"
        >
          <s-text tone="neutral">Saved file (preview unavailable)</s-text>
        </s-box>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={name}
        accept="image/*"
        onChange={handleChange}
        style={{ display: "none" }}
      />
      <s-button
        type="button"
        variant="secondary"
        onClick={() => inputRef.current?.click()}
      >
        {displayUrl || value ? "Replace file" : "Choose file"}
      </s-button>
    </s-stack>
  );
}
