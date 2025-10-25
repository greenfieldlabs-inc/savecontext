// Quick test to show what ContextKeeper knows about itself
console.log('🔍 ContextKeeper Self-Awareness Test\n');

const gitManager = require('./server/dist/git/GitManager.js').GitManager;
const contextBuilder = require('./server/dist/context/ContextBuilder.js').ContextBuilder;

async function test() {
  const projectPath = '/Users/shane/code/dev/contextkeeper';
  
  const git = new gitManager(projectPath);
  const context = new contextBuilder(projectPath);
  
  console.log('📁 Project Profile:');
  const profile = await context.getProjectProfile();
  console.log(`  Name: ${profile.name}`);
  console.log(`  Languages: ${profile.languages.join(', ')}`);
  console.log(`  Frameworks: ${profile.frameworks.join(', ') || 'None detected'}`);
  console.log(`  Structure: src=${profile.structure.hasSrc}, tests=${profile.structure.hasTests}`);
  
  console.log('\n🔧 Git Status:');
  const status = await git.getStatus();
  console.log(`  Branch: ${status.branch}`);
  console.log(`  Status: ${status.status}`);
  console.log(`  Has changes: ${status.hasChanges}`);
  
  console.log('\n📝 Recent Commits:');
  const commits = await git.getRecentCommits(3);
  commits.forEach(c => {
    console.log(`  ${c.hash}: ${c.message.split('\n')[0]}`);
  });
  
  console.log('\n✅ ContextKeeper is self-aware and tracking its own development!');
}

test().catch(console.error);
