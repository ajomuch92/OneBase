import { defineCollection } from '../src/index.ts'

export const tags = defineCollection({
  name: 'tags',
  fields: {
    name:      { type: 'string',  required: true },
    active:       { type: 'boolean',  default: false },
  },
  permissions: {
    list:   'public',
    read:   'public',
    // Shared taxonomy, not owned by whoever created it (there's no
    // `authorId` field here) — anyone signed in can propose a tag, but
    // only admins can edit/remove one.
    create: 'auth',
    update: 'admin',
    delete: 'admin',
  },
})