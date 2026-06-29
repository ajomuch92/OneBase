import { defineCollection, PRESETS } from '../src/index.ts'

export const posts = defineCollection({
  name: 'posts',
  fields: {
    title:      { type: 'string',  required: true },
    slug:       { type: 'string',  unique: true },
    body:       { type: 'text' },
    coverImage: { type: 'file' },
    published:  { type: 'boolean', default: false },
    authorId:   { type: 'relation', collection: 'users', required: true },
  },
  permissions: {
    list:   'public',
    read:   'public',
    create: 'auth',
    update: ({ user, record }) => user?.role === 'admin' || user?.id === record?.authorId,
    delete: ({ user, record }) => user?.role === 'admin' || user?.id === record?.authorId,
    upload: 'auth',
  },
  hooks: {
    beforeCreate: async (data, ctx) => {
      if (!data.slug && data.title) {
        data.slug = (data.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      }
      if (!data.authorId && ctx.userId) data.authorId = ctx.userId
      return data
    },
  },
})
