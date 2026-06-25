import {
  adminGraphql,
  assertNoUserErrors,
  type AdminGraphqlClient,
} from "./admin-graphql.server";

type StagedUploadsCreateData = {
  stagedUploadsCreate: {
    stagedTargets: Array<{
      url: string;
      resourceUrl: string;
      parameters: Array<{ name: string; value: string }>;
    }>;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

type FileCreateData = {
  fileCreate: {
    files: Array<{
      id: string;
      image?: { url: string } | null;
      url?: string | null;
      sources?: Array<{ url: string }> | null;
    }>;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

const STAGED_UPLOADS_CREATE = `#graphql
  mutation StagedUploadsCreateForBcDesign($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_CREATE = `#graphql
  mutation FileCreateForBcDesign($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        ... on MediaImage {
          image {
            url
          }
        }
        ... on GenericFile {
          url
        }
        ... on Video {
          sources {
            url
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function stagedUploadResource(mimeType: string) {
  return mimeType.startsWith("image/") ? "IMAGE" : "FILE";
}

function fileUrlFromCreated(
  file: FileCreateData["fileCreate"]["files"][number],
): string | undefined {
  if (file.image?.url) {
    return file.image.url;
  }
  if (file.url) {
    return file.url;
  }
  return file.sources?.[0]?.url;
}

export async function createShopifyFileFromUpload(
  admin: AdminGraphqlClient,
  file: File,
): Promise<{ id: string; url?: string }> {
  const mimeType = file.type || "application/octet-stream";
  const stagedData = await adminGraphql<StagedUploadsCreateData>(
    admin,
    STAGED_UPLOADS_CREATE,
    {
      input: [
        {
          filename: file.name,
          mimeType,
          resource: stagedUploadResource(mimeType),
          httpMethod: "POST",
        },
      ],
    },
  );

  assertNoUserErrors(stagedData.stagedUploadsCreate.userErrors);

  const stagedTarget = stagedData.stagedUploadsCreate.stagedTargets[0];
  if (!stagedTarget) {
    throw new Error("stagedUploadsCreate returned no staged target.");
  }

  const formData = new FormData();
  for (const parameter of stagedTarget.parameters) {
    formData.append(parameter.name, parameter.value);
  }
  formData.append("file", file);

  const uploadResponse = await fetch(stagedTarget.url, {
    method: "POST",
    body: formData,
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Staged upload failed with status ${uploadResponse.status}.`,
    );
  }

  const createData = await adminGraphql<FileCreateData>(admin, FILE_CREATE, {
    files: [
      {
        originalSource: stagedTarget.resourceUrl,
        contentType: stagedUploadResource(mimeType),
      },
    ],
  });

  assertNoUserErrors(createData.fileCreate.userErrors);

  const created = createData.fileCreate.files[0];
  if (!created?.id) {
    throw new Error("fileCreate returned no file id.");
  }

  return {
    id: created.id,
    url: fileUrlFromCreated(created),
  };
}
