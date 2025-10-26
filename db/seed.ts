// Seed script for development database
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create test user
  const testUser = await prisma.user.upsert({
    where: { email: 'test@contextkeeper.dev' },
    update: {},
    create: {
      email: 'test@contextkeeper.dev',
      emailVerified: new Date(),
      subscriptionStatus: 'pro',
    },
  });

  console.log('✅ Created test user:', testUser.email);

  // Generate API key for test user
  const apiKeyPlaintext = 'ck_test_12345678901234567890';
  const apiKeyHash = await bcrypt.hash(apiKeyPlaintext, 12);

  const apiKey = await prisma.apiKey.create({
    data: {
      userId: testUser.id,
      keyHash: apiKeyHash,
      name: 'Development Key',
    },
  });

  console.log('✅ Created API key:', apiKeyPlaintext);

  // Create sample session
  const session = await prisma.session.create({
    data: {
      userId: testUser.id,
      projectName: 'contextkeeper',
      toolUsed: 'claude-code',
      tokenCount: 5420,
    },
  });

  console.log('✅ Created sample session:', session.id);

  // Add session files
  await prisma.sessionFile.create({
    data: {
      sessionId: session.id,
      path: 'src/index.ts',
      content: 'console.log("Hello, ContextKeeper!");',
      lineCount: 1,
      language: 'typescript',
    },
  });

  // Add session tasks
  await prisma.sessionTask.createMany({
    data: [
      {
        sessionId: session.id,
        description: 'Implement cloud sync',
        completed: false,
        priority: 'high',
      },
      {
        sessionId: session.id,
        description: 'Add API key rotation',
        completed: true,
        priority: 'medium',
      },
    ],
  });

  // Add session memories
  await prisma.sessionMemory.createMany({
    data: [
      {
        sessionId: session.id,
        key: 'api_endpoint',
        value: 'https://api.contextkeeper.io',
        type: 'api',
      },
      {
        sessionId: session.id,
        key: 'db_schema_version',
        value: '1.0',
        type: 'schema',
      },
    ],
  });

  console.log('✅ Added session files, tasks, and memories');

  // Create usage stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.usageStats.create({
    data: {
      userId: testUser.id,
      date: today,
      sessionsCreated: 5,
      tokensUsed: 25000,
      apiCallsMade: 12,
      claudeCodeSessions: 3,
      cursorSessions: 2,
      factorySessions: 0,
    },
  });

  console.log('✅ Created usage stats');

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      userId: testUser.id,
      action: 'create',
      resource: 'session',
      resourceId: session.id,
      metadata: {
        source: 'seed_script',
      },
      ipAddress: '127.0.0.1',
      userAgent: 'seed-script',
    },
  });

  console.log('✅ Created audit log entry');

  console.log('\n🎉 Database seeded successfully!');
  console.log('\n📋 Test credentials:');
  console.log('   Email: test@contextkeeper.dev');
  console.log('   API Key:', apiKeyPlaintext);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
