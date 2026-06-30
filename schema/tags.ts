import { defineCollection } from '../src/index.ts'

export const posts = defineCollection({
  name: 'tags',
  fields: {
    name:      { type: 'string',  required: true },
    active:       { type: 'boolean',  default: false },
  },
  permissions: {
    list:   'public',
    read:   'public',
    create: 'auth',
    update: ({ user, record }) => user?.role === 'admin' || user?.id === record?.authorId,
    delete: ({ user, record }) => user?.role === 'admin' || user?.id === record?.authorId,
    upload: 'auth',
  },
})