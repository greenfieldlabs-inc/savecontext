import fs from 'fs/promises';
import path from 'path';

export interface ProjectProfile {
  name: string;
  languages: string[];
  frameworks: string[];
  dependencies: Record<string, string>;
  entryPoints: string[];
  testFramework: string | null;
  structure: {
    hasSrc: boolean;
    hasTests: boolean;
    hasDocs: boolean;
    hasConfig: boolean;
  };
}

export interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
  size?: number;
  modified?: string;
}

export class ContextBuilder {
  private projectPath: string;
  private ignorePatterns: string[] = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '__pycache__',
    '*.pyc',
    '.DS_Store',
    'coverage',
    '.env',
    '*.log',
    'outputs',  // From your vision experiments
    'test_repos',  // From your benchmarks
  ];
  
  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }
  
  async getProjectProfile(): Promise<ProjectProfile> {
    const profile: ProjectProfile = {
      name: path.basename(this.projectPath),
      languages: [],
      frameworks: [],
      dependencies: {},
      entryPoints: [],
      testFramework: null,
      structure: {
        hasSrc: false,
        hasTests: false,
        hasDocs: false,
        hasConfig: false,
      },
    };
    
    // Check for package.json (Node/JS project)
    try {
      const packagePath = path.join(this.projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
      
      profile.languages.push('JavaScript/TypeScript');
      profile.dependencies = packageJson.dependencies || {};
      
      // Detect frameworks
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      if (deps['next']) profile.frameworks.push('Next.js');
      if (deps['react']) profile.frameworks.push('React');
      if (deps['vue']) profile.frameworks.push('Vue');
      if (deps['express']) profile.frameworks.push('Express');
      if (deps['fastify']) profile.frameworks.push('Fastify');
      
      // Detect test framework
      if (deps['jest']) profile.testFramework = 'Jest';
      if (deps['vitest']) profile.testFramework = 'Vitest';
      if (deps['mocha']) profile.testFramework = 'Mocha';
      
      // Entry points
      if (packageJson.main) profile.entryPoints.push(packageJson.main);
      if (packageJson.scripts?.start) profile.entryPoints.push('npm start');
    } catch {
      // Not a Node project
    }
    
    // Check for Python project
    try {
      const requirementsPath = path.join(this.projectPath, 'requirements.txt');
      await fs.access(requirementsPath);
      profile.languages.push('Python');
      
      // Check for common Python files
      const pyFiles: string[] = [];
      const searchPyFiles = async (dir: string, depth: number = 0): Promise<void> => {
        if (depth > 3) return; // Limit depth
        try {
          const items = await fs.readdir(dir);
          for (const item of items) {
            if (this.ignorePatterns.some(p => item.includes(p))) continue;
            const fullPath = path.join(dir, item);
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
              await searchPyFiles(fullPath, depth + 1);
            } else if (item.endsWith('.py')) {
              pyFiles.push(path.relative(this.projectPath, fullPath));
            }
          }
        } catch {}
      };
      await searchPyFiles(this.projectPath);
      
      if (pyFiles.includes('manage.py')) profile.frameworks.push('Django');
      if (pyFiles.includes('app.py') || pyFiles.includes('application.py')) {
        const content = await fs.readFile(path.join(this.projectPath, pyFiles.find(f => f.includes('app.py') || f.includes('application.py'))!), 'utf-8');
        if (content.includes('Flask')) profile.frameworks.push('Flask');
        if (content.includes('FastAPI')) profile.frameworks.push('FastAPI');
      }
      
      // Test framework
      if (pyFiles.some(f => f.startsWith('test_') || f.includes('/test'))) {
        profile.testFramework = 'pytest';
      }
      
      // Entry points
      if (pyFiles.includes('main.py')) profile.entryPoints.push('main.py');
      if (pyFiles.includes('app.py')) profile.entryPoints.push('app.py');
    } catch {
      // Not a Python project or no requirements.txt
    }
    
    // Check for pyproject.toml (modern Python)
    try {
      const pyprojectPath = path.join(this.projectPath, 'pyproject.toml');
      const pyprojectContent = await fs.readFile(pyprojectPath, 'utf-8');
      if (!profile.languages.includes('Python')) {
        profile.languages.push('Python');
      }
      // Parse dependencies from pyproject.toml if needed
    } catch {
      // No pyproject.toml
    }
    
    // Check directory structure
    try {
      await fs.access(path.join(this.projectPath, 'src'));
      profile.structure.hasSrc = true;
    } catch {}
    
    try {
      await fs.access(path.join(this.projectPath, 'tests'));
      profile.structure.hasTests = true;
    } catch {
      try {
        await fs.access(path.join(this.projectPath, 'test'));
        profile.structure.hasTests = true;
      } catch {}
    }
    
    try {
      await fs.access(path.join(this.projectPath, 'docs'));
      profile.structure.hasDocs = true;
    } catch {}
    
    // Check for config files
    const configFiles = ['.env.example', 'config.json', 'config.yaml', '.eslintrc', 'tsconfig.json'];
    for (const configFile of configFiles) {
      try {
        await fs.access(path.join(this.projectPath, configFile));
        profile.structure.hasConfig = true;
        break;
      } catch {}
    }
    
    return profile;
  }
  
  async getFileStructure(options: { max_depth?: number; include_hidden?: boolean } = {}): Promise<FileNode> {
    const maxDepth = options.max_depth || 3;
    const includeHidden = options.include_hidden || false;
    
    const buildTree = async (dirPath: string, depth: number = 0): Promise<FileNode> => {
      const name = path.basename(dirPath);
      const relativePath = path.relative(this.projectPath, dirPath);
      
      if (depth >= maxDepth) {
        return {
          name,
          type: 'directory',
          path: relativePath,
          children: [],
        };
      }
      
      try {
        const stat = await fs.stat(dirPath);
        
        if (!stat.isDirectory()) {
          return {
            name,
            type: 'file',
            path: relativePath,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        }
        
        const items = await fs.readdir(dirPath);
        const children: FileNode[] = [];
        
        for (const item of items) {
          // Skip hidden files unless requested
          if (!includeHidden && item.startsWith('.')) continue;
          
          // Skip ignored patterns
          if (this.ignorePatterns.some(pattern => item === pattern || item.includes(pattern))) {
            continue;
          }
          
          const itemPath = path.join(dirPath, item);
          const child = await buildTree(itemPath, depth + 1);
          children.push(child);
        }
        
        return {
          name,
          type: 'directory',
          path: relativePath,
          children: children.sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) {
              return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          }),
        };
      } catch (error) {
        return {
          name,
          type: 'file',
          path: relativePath,
        };
      }
    };
    
    return buildTree(this.projectPath);
  }
  
  async explainCodebase(focusAreas?: string[]): Promise<string> {
    const profile = await this.getProjectProfile();
    const structure = await this.getFileStructure({ max_depth: 2 });
    
    let explanation = `# ${profile.name} Codebase Overview\n\n`;
    
    // Languages and frameworks
    if (profile.languages.length > 0) {
      explanation += `## Technology Stack\n`;
      explanation += `- **Languages**: ${profile.languages.join(', ')}\n`;
      if (profile.frameworks.length > 0) {
        explanation += `- **Frameworks**: ${profile.frameworks.join(', ')}\n`;
      }
      if (profile.testFramework) {
        explanation += `- **Testing**: ${profile.testFramework}\n`;
      }
      explanation += '\n';
    }
    
    // Project structure
    explanation += `## Project Structure\n`;
    if (profile.structure.hasSrc) {
      explanation += `- **Source code**: Located in \`src/\` directory\n`;
    }
    if (profile.structure.hasTests) {
      explanation += `- **Tests**: Test files present\n`;
    }
    if (profile.structure.hasDocs) {
      explanation += `- **Documentation**: \`docs/\` directory available\n`;
    }
    explanation += '\n';
    
    // Entry points
    if (profile.entryPoints.length > 0) {
      explanation += `## Entry Points\n`;
      profile.entryPoints.forEach(entry => {
        explanation += `- \`${entry}\`\n`;
      });
      explanation += '\n';
    }
    
    // Key dependencies (top 10)
    if (Object.keys(profile.dependencies).length > 0) {
      explanation += `## Key Dependencies\n`;
      const deps = Object.entries(profile.dependencies).slice(0, 10);
      deps.forEach(([name, version]) => {
        explanation += `- ${name}: ${version}\n`;
      });
      if (Object.keys(profile.dependencies).length > 10) {
        explanation += `- ... and ${Object.keys(profile.dependencies).length - 10} more\n`;
      }
      explanation += '\n';
    }
    
    // Focus areas if specified
    if (focusAreas && focusAreas.length > 0) {
      explanation += `## Focus Areas\n`;
      for (const area of focusAreas) {
        explanation += `\n### ${area}\n`;
        // This could be enhanced with specific analysis
        explanation += `Analysis for ${area} would go here...\n`;
      }
    }
    
    return explanation;
  }
}
