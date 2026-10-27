import { Hono } from 'hono'

export const hello = new Hono()
  .get(
    '/',
    (c) => c.json({ message: `Hello from Hono on ${navigator.userAgent}` }),
  )
