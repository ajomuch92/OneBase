import { defineCollection, PRESETS } from '../src/index.ts'

export const comments = defineCollection({
  name: 'comments',

  fields: {
    body: {
      type:     'text',
      required: true,
    },
    postId: {
      type:       'relation',
      collection: 'posts',
      required:   true,
    },
    authorId: {
      type:       'relation',
      collection: 'users',
      required:   true,
    },
  },

  // Use the built-in OWNER preset — users can only edit/delete their own comments
  permissions: PRESETS.OWNER('authorId'),

  hooks: {
    beforeCreate: async (data, ctx) => {
      if (typeof data.body === 'string' && data.body.trim().length < 3) {
        throw new Error('Comment must be at least 3 characters')
      }
      if (!data.authorId && ctx.userId) {
        data.authorId = ctx.userId
      }
      return data
    },
  },
})
