"""
Comprehensive End-to-End Benchmark
Tests Vision (Qwen) vs Text RAG across multiple codebases at scale.
Generates production-ready charts with real data.
"""

import json
import time
from pathlib import Path
from datetime import datetime
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

from src.code_to_image import code_to_image
from src.vision_query import query_code_image
from src.text_rag import query_code_text, chunk_code_file

sns.set_theme(style="whitegrid")


class ComprehensiveBenchmark:
    """
    Comprehensive benchmark runner for Vision vs Text RAG.
    """
    
    def __init__(self, output_dir="outputs/final_benchmark"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.results = []
        
    def find_test_files(self):
        """
        Find files across multiple repos at different size ranges.
        """
        repos = {
            'fastapi': Path('test_repos/fastapi/fastapi'),
            'flask': Path('test_repos/flask/src/flask'),
            'django': Path('test_repos/django/django'),
        }
        
        test_files = []
        
        for repo_name, repo_path in repos.items():
            if not repo_path.exists():
                continue
            
            py_files = list(repo_path.rglob("*.py"))
            
            for py_file in py_files:
                try:
                    lines = len(py_file.read_text().split('\n'))
                    
                    # Categorize by size
                    if 150 <= lines <= 200:
                        category = 'small'
                    elif 300 <= lines <= 400:
                        category = 'medium'
                    elif 500 <= lines <= 600:
                        category = 'large'
                    elif 1000 <= lines <= 1500:
                        category = 'xlarge'
                    elif lines >= 2000:
                        category = 'xxlarge'
                    else:
                        continue
                    
                    test_files.append({
                        'repo': repo_name,
                        'path': py_file,
                        'lines': lines,
                        'category': category,
                    })
                except:
                    continue
        
        # Select representative files from each category
        selected = {}
        for category in ['small', 'medium', 'large', 'xlarge', 'xxlarge']:
            category_files = [f for f in test_files if f['category'] == category]
            if category_files:
                # Pick one from each repo if possible
                for repo in ['fastapi', 'flask', 'django']:
                    repo_files = [f for f in category_files if f['repo'] == repo]
                    if repo_files:
                        selected[f"{repo}_{category}"] = repo_files[0]
                        break
        
        return list(selected.values())
    
    def benchmark_file(self, file_info, question="What does this code do? Summarize in 2-3 sentences."):
        """
        Benchmark both vision and text approaches on a single file.
        """
        file_path = file_info['path']
        print(f"\n{'='*80}")
        print(f"Testing: {file_info['repo']}/{file_path.name}")
        print(f"Size: {file_info['lines']} lines ({file_info['category']})")
        print(f"{'='*80}")
        
        result = {
            'repo': file_info['repo'],
            'file': file_path.name,
            'path': str(file_path),
            'lines': file_info['lines'],
            'category': file_info['category'],
            'timestamp': datetime.now().isoformat(),
        }
        
        # Test Vision (Qwen)
        print(f"\n[1/2] Vision (Qwen)...")
        try:
            image_path = self.output_dir / f"temp_{file_path.stem}.png"
            
            start = time.time()
            img = code_to_image(str(file_path), str(image_path))
            image_time = time.time() - start
            
            start = time.time()
            vision_result = query_code_image(
                str(image_path), 
                question,
                model="qwen/qwen-2-vl-72b-instruct"
            )
            query_time = time.time() - start
            
            result['vision'] = {
                'success': True,
                'image_size': f"{img.size[0]}x{img.size[1]}",
                'image_generation_time': image_time,
                'query_time': query_time,
                'total_time': image_time + query_time,
                'tokens': vision_result['tokens'],
                'cost': vision_result['cost'],
            }
            print(f"   Tokens: {vision_result['tokens']['input']} in, ${vision_result['cost']:.4f}")
            
            image_path.unlink()  # Clean up
            
        except Exception as e:
            result['vision'] = {'success': False, 'error': str(e)}
            print(f"   Failed: {e}")
        
        # Test Text
        print(f"\n[2/2] Text RAG...")
        try:
            code = file_path.read_text()
            
            start = time.time()
            text_result = query_code_text(code, question)
            query_time = time.time() - start
            
            result['text'] = {
                'success': True,
                'query_time': query_time,
                'tokens': text_result['tokens'],
                'cost': text_result['cost'],
            }
            print(f"   Tokens: {text_result['tokens']['input']} in, ${text_result['cost']:.4f}")
            
        except Exception as e:
            result['text'] = {'success': False, 'error': str(e)}
            print(f"   Failed: {e}")
        
        # Comparison
        if result['vision']['success'] and result['text']['success']:
            v_tokens = result['vision']['tokens']['input']
            t_tokens = result['text']['tokens']['input']
            
            if v_tokens < t_tokens:
                result['winner'] = 'Vision'
                result['savings_pct'] = ((t_tokens - v_tokens) / t_tokens) * 100
            else:
                result['winner'] = 'Text'
                result['savings_pct'] = ((v_tokens - t_tokens) / v_tokens) * 100
            
            print(f"\n   Winner: {result['winner']} ({result['savings_pct']:.1f}% more efficient)")
        
        return result
    
    def run_benchmark(self, max_files_per_category=1):
        """
        Run complete benchmark across all test files.
        """
        print("COMPREHENSIVE VISION vs TEXT BENCHMARK")
        print("="*80)
        print("\nFinding test files...")
        
        test_files = self.find_test_files()
        print(f"Found {len(test_files)} test files\n")
        
        for i, file_info in enumerate(test_files, 1):
            print(f"\n\nFILE {i}/{len(test_files)}")
            result = self.benchmark_file(file_info)
            self.results.append(result)
            
            time.sleep(1)  # Rate limiting
        
        # Save results
        results_file = self.output_dir / f"benchmark_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        print(f"\n\n{'='*80}")
        print(f"Results saved: {results_file}")
        
        return results_file
    
    def generate_charts(self):
        """
        Generate professional charts from benchmark results.
        """
        if not self.results:
            print("No results to chart!")
            return
        
        print(f"\n{'='*80}")
        print("Generating Charts...")
        print(f"{'='*80}\n")
        
        successful = [r for r in self.results if r.get('vision', {}).get('success') and r.get('text', {}).get('success')]
        
        if not successful:
            print("No successful comparisons!")
            return
        
        # Chart 1: Token Usage by File Size
        self._chart_tokens_by_size(successful)
        
        # Chart 2: Cost Comparison
        self._chart_cost_comparison(successful)
        
        # Chart 3: Winner by Category
        self._chart_winners(successful)
        
        # Chart 4: Summary Table
        self._chart_summary_table(successful)
        
        print(f"\nAll charts saved to: {self.output_dir}")
    
    def _chart_tokens_by_size(self, results):
        """Chart showing token usage scaling with file size."""
        fig, ax = plt.subplots(figsize=(12, 7))
        
        lines = [r['lines'] for r in results]
        vision_tokens = [r['vision']['tokens']['input'] for r in results]
        text_tokens = [r['text']['tokens']['input'] for r in results]
        
        ax.scatter(lines, vision_tokens, s=100, alpha=0.7, color='#3498db', label='Vision (Qwen)', marker='s')
        ax.scatter(lines, text_tokens, s=100, alpha=0.7, color='#2ecc71', label='Text RAG', marker='o')
        
        # Fit trend lines
        z_v = np.polyfit(lines, vision_tokens, 1)
        p_v = np.poly1d(z_v)
        z_t = np.polyfit(lines, text_tokens, 1)
        p_t = np.poly1d(z_t)
        
        x_smooth = np.linspace(min(lines), max(lines), 100)
        ax.plot(x_smooth, p_v(x_smooth), "--", color='#3498db', alpha=0.5, linewidth=2)
        ax.plot(x_smooth, p_t(x_smooth), "--", color='#2ecc71', alpha=0.5, linewidth=2)
        
        ax.set_xlabel('File Size (lines of code)', fontsize=12)
        ax.set_ylabel('Input Tokens', fontsize=12)
        ax.set_title('Token Scaling: Vision vs Text RAG\n(Real Data from FastAPI, Flask, Django)', 
                     fontsize=14, fontweight='bold')
        ax.legend(fontsize=11)
        ax.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(self.output_dir / "token_scaling.png", dpi=300, bbox_inches='tight')
        print("Saved: token_scaling.png")
        plt.close()
    
    def _chart_cost_comparison(self, results):
        """Chart showing cost comparison."""
        fig, ax = plt.subplots(figsize=(10, 6))
        
        categories = list(set(r['category'] for r in results))
        categories.sort(key=lambda x: ['small', 'medium', 'large', 'xlarge', 'xxlarge'].index(x))
        
        vision_costs = []
        text_costs = []
        
        for cat in categories:
            cat_results = [r for r in results if r['category'] == cat]
            vision_costs.append(np.mean([r['vision']['cost'] for r in cat_results]))
            text_costs.append(np.mean([r['text']['cost'] for r in cat_results]))
        
        x = np.arange(len(categories))
        width = 0.35
        
        ax.bar(x - width/2, vision_costs, width, label='Vision (Qwen)', color='#3498db', alpha=0.8)
        ax.bar(x + width/2, text_costs, width, label='Text RAG', color='#2ecc71', alpha=0.8)
        
        ax.set_ylabel('Cost per Query ($)', fontsize=12)
        ax.set_title('Cost Comparison by File Size Category', fontsize=14, fontweight='bold')
        ax.set_xticks(x)
        ax.set_xticklabels([c.capitalize() for c in categories])
        ax.legend(fontsize=11)
        ax.grid(axis='y', alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(self.output_dir / "cost_comparison.png", dpi=300, bbox_inches='tight')
        print("Saved: cost_comparison.png")
        plt.close()
    
    def _chart_winners(self, results):
        """Chart showing which approach wins by category."""
        fig, ax = plt.subplots(figsize=(10, 6))
        
        categories = ['small', 'medium', 'large', 'xlarge', 'xxlarge']
        vision_wins = []
        text_wins = []
        
        for cat in categories:
            cat_results = [r for r in results if r['category'] == cat]
            if not cat_results:
                vision_wins.append(0)
                text_wins.append(0)
                continue
            
            v_count = sum(1 for r in cat_results if r.get('winner') == 'Vision')
            t_count = sum(1 for r in cat_results if r.get('winner') == 'Text')
            vision_wins.append(v_count)
            text_wins.append(t_count)
        
        x = np.arange(len(categories))
        width = 0.35
        
        ax.bar(x - width/2, vision_wins, width, label='Vision Wins', color='#3498db', alpha=0.8)
        ax.bar(x + width/2, text_wins, width, label='Text Wins', color='#2ecc71', alpha=0.8)
        
        ax.set_ylabel('Number of Wins', fontsize=12)
        ax.set_title('Winner by File Size Category', fontsize=14, fontweight='bold')
        ax.set_xticks(x)
        ax.set_xticklabels([c.capitalize() for c in categories])
        ax.legend(fontsize=11)
        ax.grid(axis='y', alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(self.output_dir / "winners_by_category.png", dpi=300, bbox_inches='tight')
        print("Saved: winners_by_category.png")
        plt.close()
    
    def _chart_summary_table(self, results):
        """Summary statistics table."""
        fig, ax = plt.subplots(figsize=(12, 8))
        ax.axis('tight')
        ax.axis('off')
        
        # Calculate summary stats
        categories = ['small', 'medium', 'large', 'xlarge', 'xxlarge']
        table_data = [['Category', 'Avg Lines', 'Vision Tokens', 'Text Tokens', 'Vision Cost', 'Text Cost', 'Winner']]
        
        for cat in categories:
            cat_results = [r for r in results if r['category'] == cat]
            if not cat_results:
                continue
            
            avg_lines = int(np.mean([r['lines'] for r in cat_results]))
            avg_v_tokens = int(np.mean([r['vision']['tokens']['input'] for r in cat_results]))
            avg_t_tokens = int(np.mean([r['text']['tokens']['input'] for r in cat_results]))
            avg_v_cost = np.mean([r['vision']['cost'] for r in cat_results])
            avg_t_cost = np.mean([r['text']['cost'] for r in cat_results])
            
            winner = 'Vision' if avg_v_tokens < avg_t_tokens else 'Text'
            
            table_data.append([
                cat.capitalize(),
                str(avg_lines),
                str(avg_v_tokens),
                str(avg_t_tokens),
                f"${avg_v_cost:.4f}",
                f"${avg_t_cost:.4f}",
                winner
            ])
        
        table = ax.table(cellText=table_data, cellLoc='center', loc='center',
                        colWidths=[0.15, 0.12, 0.15, 0.15, 0.15, 0.15, 0.13])
        
        table.auto_set_font_size(False)
        table.set_fontsize(11)
        table.scale(1, 2.5)
        
        for i in range(len(table_data[0])):
            table[(0, i)].set_facecolor('#3498db')
            table[(0, i)].set_text_props(weight='bold', color='white')
        
        for i in range(1, len(table_data)):
            winner_col = len(table_data[0]) - 1
            if table_data[i][-1] == 'Vision':
                table[(i, winner_col)].set_facecolor('#d5f4e6')
            else:
                table[(i, winner_col)].set_facecolor('#f0f0f0')
        
        plt.title('Summary: Vision (Qwen) vs Text RAG\nReal Data from Production Codebases',
                 fontsize=14, fontweight='bold', pad=20)
        
        plt.tight_layout()
        plt.savefig(self.output_dir / "summary_table.png", dpi=300, bbox_inches='tight')
        print("Saved: summary_table.png")
        plt.close()


def main():
    """
    Run comprehensive benchmark and generate charts.
    """
    benchmark = ComprehensiveBenchmark()
    
    print("Starting comprehensive benchmark...")
    print("This will test Vision (Qwen) vs Text RAG across multiple repos")
    print("="*80)
    
    # Run benchmark
    results_file = benchmark.run_benchmark()
    
    # Generate charts
    benchmark.generate_charts()
    
    # Print summary
    print(f"\n{'='*80}")
    print("BENCHMARK COMPLETE")
    print(f"{'='*80}")
    print(f"\nResults: {results_file}")
    print(f"Charts: {benchmark.output_dir}/")


if __name__ == "__main__":
    main()
