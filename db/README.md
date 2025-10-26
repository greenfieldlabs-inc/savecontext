# ContextKeeper Database

Shared Prisma database schema for ContextKeeper multi-tenant SaaS.

## Setup

```bash
# Install dependencies
npm install

# Generate Prisma Client
npm run generate

# Create database and run migrations (development)
npm run migrate

# Seed development data
npm run seed

# Open Prisma Studio (database GUI)
npm run studio
```

## Production Deployment

```bash
# Deploy migrations (no seed data)
npm run migrate:deploy
```

## Schema Overview

### Core Tables
- **users** - User accounts with email verification
- **api_keys** - Multiple API keys per user (bcrypt hashed)
- **sessions** - Coding sessions with structured data
- **session_files** - Searchable file content per session
- **session_tasks** - Current work items per session
- **session_memories** - Key-value pairs per session

### Analytics
- **usage_stats** - Daily aggregated usage metrics
- **audit_logs** - Track all sensitive actions (GDPR)

### Payments
- **subscription_events** - Stripe webhook history

### Optional
- **git_snapshots** - Git state tracking
- **feature_flags** - Feature rollout management

## Key Features

✅ **Multi-tenant** - Isolated data per user
✅ **Structured data** - No JSON blobs, fully searchable
✅ **Email verification** - Required before API access
✅ **API key rotation** - Multiple keys with expiration
✅ **Soft deletes** - GDPR-compliant data retention
✅ **Audit trail** - All actions logged
✅ **Proper indexes** - Optimized for performance

## Environment Variables

```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
```

## Migrations

### Create new migration

```bash
npx prisma migrate dev --name add_new_feature
```

### View migration status

```bash
npx prisma migrate status
```

### Reset database (development only)

```bash
npm run migrate:reset
```

⚠️ **Warning:** Never run `migrate:reset` in production!

## Security

- API keys are **hashed with bcrypt** (never plain text)
- Sensitive session data should be **encrypted before storage**
- Soft deletes preserve data for **30 days** (GDPR compliance)
- Audit logs track **all data access**

## Import in Other Packages

### From Next.js app:

```typescript
import { PrismaClient } from '@prisma/client';
// or import from '../db' if you create a client wrapper
```

### From MCP server:

```typescript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});
```

## Troubleshooting

### "Can't reach database server"

1. Check `DATABASE_URL` is correct
2. Verify database is running
3. Check firewall/security groups allow connection

### "Table does not exist"

```bash
npm run migrate:deploy
```

### "Module not found: @prisma/client"

```bash
npm run generate
```

## References

- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Best Practices](https://wiki.postgresql.org/wiki/Don%27t_Do_This)
- [ContextKeeper PRD](../docs/plans/PRD-MVP-UPDATED.md)
