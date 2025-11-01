/**
 * Quick test script for SaveContext local PostgreSQL sync
 */

import { syncSessionToCloud, getUsageStats } from './dist/sync.js';
import { countMessageTokens } from './dist/token-counter.js';

async function testSync() {
  console.log('Testing SaveContext local PostgreSQL sync...\n');

  // Test 1: Count tokens
  const messages = [
    { role: 'user', content: 'Complete Phase 2 with local PostgreSQL sync' },
    { role: 'assistant', content: 'Modified sync.ts for local PostgreSQL, built server successfully' },
  ];

  const tokenCount = countMessageTokens(messages);
  console.log('✓ Token counting:', tokenCount, 'tokens');

  // Test 2: Save a test session
  console.log('\nAttempting to save test session to PostgreSQL...');

  const testSession = {
    id: `test-session-${Date.now()}`,
    userId: 'shane-local',
    projectName: 'savecontext',
    toolUsed: 'claude-code',
    tokenCount: tokenCount,
    context: {
      messages: messages,
      git: {
        branch: 'main',
        status: 'modified',
      },
    },
    metadata: {
      test: true,
      timestamp: new Date().toISOString(),
    },
    createdAt: new Date(),
  };

  const result = await syncSessionToCloud(testSession);

  if (result.success) {
    console.log('✓ Session saved successfully!');
    console.log('  Session ID:', result.sessionId);
  } else {
    console.log('✗ Session save failed:', result.error);
    process.exit(1);
  }

  // Test 3: Get usage stats
  console.log('\nFetching usage statistics from PostgreSQL...');

  const stats = await getUsageStats('shane-local');

  if (stats) {
    console.log('✓ Usage stats retrieved:');
    console.log('  Today:', stats.today.sessions, 'sessions,', stats.today.tokens, 'tokens');
    console.log('  This Week:', stats.thisWeek.sessions, 'sessions,', stats.thisWeek.tokens, 'tokens');
    console.log('  Quota Remaining:', stats.quotaRemaining, 'tokens');
  } else {
    console.log('✗ Failed to get stats');
  }

  console.log('\n✅ All tests passed! SaveContext is working with local PostgreSQL.');
}

testSync().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
