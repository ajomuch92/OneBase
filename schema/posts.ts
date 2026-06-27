import { PRESETS, defineCollection } from "../src/index.ts";

export const posts = defineCollection({
  name: "posts",

  fields: {
    title: {
      type: "string",
      required: true,
    },
    slug: {
      type: "string",
      unique: true,
    },
    body: {
      type: "text",
    },
    coverImage: {
      type: "file", // OneBase handles upload → URL automatically
    },
    published: {
      type: "boolean",
      default: false,
    },
    authorId: {
      type: "relation",
      collection: "users",
      required: true,
    },
  },

  // ── Row-level permissions ────────────────────────────────────────────────
  permissions: {
    list: "public", // anyone can list posts
    read: "public", // anyone can read a post
    create: "auth", // must be logged in to create
    update: (
      { user, record }, // only the author or admin can edit
    ) => user?.role === "admin" || user?.id === record?.authorId,
    delete: (
      { user, record }, // same rule for delete
    ) => user?.role === "admin" || user?.id === record?.authorId,
    upload: "auth", // logged-in users can upload cover images
  },

  // ── Hooks ────────────────────────────────────────────────────────────────
  hooks: {
    beforeCreate: async (data, ctx) => {
      // Auto-generate slug from title if not provided
      if (!data.slug && data.title) {
        data.slug = (data.title as string)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
      }
      // Attach the creating user as author
      if (!data.authorId && ctx.userId) {
        data.authorId = ctx.userId;
      }
      return data;
    },
  },
});
