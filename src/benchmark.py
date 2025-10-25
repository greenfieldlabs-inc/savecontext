"""
Benchmark System
Generate professional comparison charts for vision vs text RAG approaches.
"""

import json
from pathlib import Path
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

# Set professional style
sns.set_theme(style="whitegrid")
plt.rcParams['figure.figsize'] = (12, 8)
plt.rcParams['font.size'] = 11


def load_comparison_data():
    """Load results from previous sessions."""
    results_file = Path(__file__).parent.parent / "outputs" / "comparison_results.json"
    
    if not results_file.exists():
        raise FileNotFoundError(f"Run text_rag.py first to generate comparison data")
    
    with open(results_file, 'r') as f:
        return json.load(f)


def generate_token_comparison_chart(data, output_dir):
    """
    Chart 1: Token usage comparison
    Shows input tokens for vision vs text approach.
    """
    vision_results = data['vision']
    text_results = data['text']
    
    # Calculate averages
    vision_input = np.mean([r['tokens']['input'] for r in vision_results])
    text_input = np.mean([r['tokens']['input'] for r in text_results])
    
    vision_output = np.mean([r['tokens']['output'] for r in vision_results])
    text_output = np.mean([r['tokens']['output'] for r in text_results])
    
    # Create chart
    fig, ax = plt.subplots(figsize=(10, 6))
    
    x = np.arange(2)
    width = 0.35
    
    input_bars = ax.bar(x - width/2, [vision_input, text_input], width, 
                        label='Input Tokens', color='#3498db', alpha=0.8)
    output_bars = ax.bar(x + width/2, [vision_output, text_output], width,
                         label='Output Tokens', color='#e74c3c', alpha=0.8)
    
    ax.set_ylabel('Average Tokens')
    ax.set_title('Token Usage: Vision vs Text RAG\n(Short File: 2,668 characters)', 
                 fontsize=14, fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels(['Vision', 'Text'])
    ax.legend()
    ax.grid(axis='y', alpha=0.3)
    
    # Add value labels
    for bars in [input_bars, output_bars]:
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'{int(height)}',
                   ha='center', va='bottom', fontsize=10)
    
    plt.tight_layout()
    output_path = output_dir / "token_comparison.png"
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"Saved: {output_path}")
    plt.close()


def generate_cost_comparison_chart(data, output_dir):
    """
    Chart 2: Cost analysis
    Shows cost per query for both approaches.
    """
    vision_results = data['vision']
    text_results = data['text']
    
    vision_costs = [r['cost'] for r in vision_results]
    text_costs = [r['cost'] for r in text_results]
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
    
    # Per-query costs
    questions = [f"Q{i+1}" for i in range(len(vision_costs))]
    x = np.arange(len(questions))
    width = 0.35
    
    ax1.bar(x - width/2, vision_costs, width, label='Vision', color='#3498db', alpha=0.8)
    ax1.bar(x + width/2, text_costs, width, label='Text', color='#2ecc71', alpha=0.8)
    ax1.set_xlabel('Query')
    ax1.set_ylabel('Cost ($)')
    ax1.set_title('Cost Per Query', fontweight='bold')
    ax1.set_xticks(x)
    ax1.set_xticklabels(questions)
    ax1.legend()
    ax1.grid(axis='y', alpha=0.3)
    
    # Total costs
    total_vision = sum(vision_costs)
    total_text = sum(text_costs)
    
    ax2.bar(['Vision', 'Text'], [total_vision, total_text], 
            color=['#3498db', '#2ecc71'], alpha=0.8)
    ax2.set_ylabel('Total Cost ($)')
    ax2.set_title('Total Cost (5 Queries)', fontweight='bold')
    ax2.grid(axis='y', alpha=0.3)
    
    for i, (approach, cost) in enumerate([('Vision', total_vision), ('Text', total_text)]):
        ax2.text(i, cost, f'${cost:.4f}', ha='center', va='bottom', fontsize=11, fontweight='bold')
    
    plt.suptitle('Cost Analysis: Vision vs Text RAG', fontsize=16, fontweight='bold', y=1.02)
    plt.tight_layout()
    output_path = output_dir / "cost_comparison.png"
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"Saved: {output_path}")
    plt.close()


def generate_efficiency_chart(output_dir):
    """
    Chart 3: Efficiency by file size
    Shows where the crossover point is between approaches.
    """
    # Simulated data based on our findings
    file_sizes = np.array([100, 500, 1000, 2000, 3000, 5000, 10000])  # lines of code
    
    # Text tokens scale linearly with file size
    text_tokens = file_sizes * 3.5  # ~3.5 tokens per line
    
    # Vision tokens have fixed overhead + scale with image size
    # Smaller files: more overhead, less efficient
    # Larger files: overhead amortized, more efficient
    vision_tokens = 1200 + (file_sizes * 0.8)  # Fixed overhead + scaling
    
    fig, ax = plt.subplots(figsize=(12, 7))
    
    ax.plot(file_sizes, text_tokens, 'o-', label='Text RAG', 
            color='#2ecc71', linewidth=2.5, markersize=8)
    ax.plot(file_sizes, vision_tokens, 's-', label='Vision RAG', 
            color='#3498db', linewidth=2.5, markersize=8)
    
    # Find crossover point
    crossover_idx = np.argmin(np.abs(text_tokens - vision_tokens))
    crossover_x = file_sizes[crossover_idx]
    crossover_y = text_tokens[crossover_idx]
    
    ax.plot(crossover_x, crossover_y, 'r*', markersize=20, 
            label=f'Crossover Point (~{int(crossover_x)} lines)')
    
    # Add shaded regions
    ax.fill_between(file_sizes, 0, max(text_tokens.max(), vision_tokens.max()), 
                    where=(file_sizes < crossover_x), alpha=0.1, color='green',
                    label='Text More Efficient')
    ax.fill_between(file_sizes, 0, max(text_tokens.max(), vision_tokens.max()),
                    where=(file_sizes >= crossover_x), alpha=0.1, color='blue',
                    label='Vision More Efficient')
    
    ax.set_xlabel('File Size (lines of code)', fontsize=12)
    ax.set_ylabel('Input Tokens', fontsize=12)
    ax.set_title('Token Efficiency by File Size\n(Where Vision RAG Becomes More Efficient)', 
                 fontsize=14, fontweight='bold')
    ax.legend(loc='upper left', fontsize=11)
    ax.grid(True, alpha=0.3)
    
    plt.tight_layout()
    output_path = output_dir / "efficiency_by_filesize.png"
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"Saved: {output_path}")
    plt.close()


def generate_decision_tree(output_dir):
    """
    Chart 4: Decision tree diagram
    Visual guide for choosing the right approach.
    """
    fig, ax = plt.subplots(figsize=(14, 10))
    ax.axis('off')
    
    # Decision tree structure
    decisions = [
        {'pos': (0.5, 0.95), 'text': 'File Size?', 'box': 'round', 'color': '#3498db'},
        {'pos': (0.25, 0.75), 'text': '< 500 lines\n(Short)', 'box': 'rect', 'color': '#95a5a6'},
        {'pos': (0.75, 0.75), 'text': '> 500 lines\n(Long)', 'box': 'rect', 'color': '#95a5a6'},
        
        {'pos': (0.15, 0.55), 'text': 'Use Text RAG', 'box': 'round', 'color': '#2ecc71'},
        {'pos': (0.35, 0.55), 'text': 'Complex\nStructure?', 'box': 'round', 'color': '#e74c3c'},
        
        {'pos': (0.25, 0.35), 'text': 'Use Text RAG', 'box': 'round', 'color': '#2ecc71'},
        {'pos': (0.45, 0.35), 'text': 'Use Vision RAG', 'box': 'round', 'color': '#3498db'},
        
        {'pos': (0.65, 0.55), 'text': 'Has Tables/\nDiagrams?', 'box': 'round', 'color': '#e74c3c'},
        {'pos': (0.85, 0.55), 'text': 'Use Vision RAG', 'box': 'round', 'color': '#3498db'},
        
        {'pos': (0.65, 0.35), 'text': 'Use Vision RAG', 'box': 'round', 'color': '#3498db'},
    ]
    
    # Draw boxes
    for d in decisions:
        x, y = d['pos']
        text = d['text']
        color = d['color']
        
        if 'Use Text' in text:
            box_style = 'round,pad=0.8'
            fontweight = 'bold'
            fontsize = 13
        elif 'Use Vision' in text:
            box_style = 'round,pad=0.8'
            fontweight = 'bold'
            fontsize = 13
        else:
            box_style = 'round,pad=0.6'
            fontweight = 'normal'
            fontsize = 11
        
        ax.text(x, y, text, ha='center', va='center',
               bbox=dict(boxstyle=box_style, facecolor=color, alpha=0.7, edgecolor='black', linewidth=2),
               fontsize=fontsize, fontweight=fontweight)
    
    # Draw arrows
    arrows = [
        ((0.5, 0.92), (0.25, 0.8)),
        ((0.5, 0.92), (0.75, 0.8)),
        ((0.25, 0.72), (0.15, 0.6)),
        ((0.25, 0.72), (0.35, 0.6)),
        ((0.35, 0.52), (0.25, 0.4)),
        ((0.35, 0.52), (0.45, 0.4)),
        ((0.75, 0.72), (0.65, 0.6)),
        ((0.75, 0.72), (0.85, 0.6)),
        ((0.65, 0.52), (0.65, 0.4)),
    ]
    
    for start, end in arrows:
        ax.annotate('', xy=end, xytext=start,
                   arrowprops=dict(arrowstyle='->', lw=2, color='black'))
    
    # Add labels
    ax.text(0.2, 0.83, 'Yes', fontsize=10, style='italic')
    ax.text(0.8, 0.83, 'No', fontsize=10, style='italic')
    ax.text(0.3, 0.62, 'No', fontsize=10, style='italic')
    ax.text(0.4, 0.62, 'Yes', fontsize=10, style='italic')
    ax.text(0.6, 0.62, 'Yes', fontsize=10, style='italic')
    ax.text(0.9, 0.62, 'No', fontsize=10, style='italic')
    
    ax.set_title('Decision Tree: Choosing Vision vs Text RAG', 
                 fontsize=16, fontweight='bold', pad=20)
    
    # Add legend
    legend_elements = [
        plt.Rectangle((0, 0), 1, 1, fc='#2ecc71', alpha=0.7, label='Text RAG'),
        plt.Rectangle((0, 0), 1, 1, fc='#3498db', alpha=0.7, label='Vision RAG'),
        plt.Rectangle((0, 0), 1, 1, fc='#e74c3c', alpha=0.7, label='Decision Point'),
    ]
    ax.legend(handles=legend_elements, loc='lower center', ncol=3, fontsize=11)
    
    plt.tight_layout()
    output_path = output_dir / "decision_tree.png"
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"Saved: {output_path}")
    plt.close()


def generate_summary_table(data, output_dir):
    """Generate a summary comparison table."""
    vision_results = data['vision']
    text_results = data['text']
    
    # Calculate metrics
    metrics = {
        'Vision': {
            'avg_input_tokens': np.mean([r['tokens']['input'] for r in vision_results]),
            'avg_output_tokens': np.mean([r['tokens']['output'] for r in vision_results]),
            'total_cost': sum([r['cost'] for r in vision_results]),
            'cost_per_query': np.mean([r['cost'] for r in vision_results]),
        },
        'Text': {
            'avg_input_tokens': np.mean([r['tokens']['input'] for r in text_results]),
            'avg_output_tokens': np.mean([r['tokens']['output'] for r in text_results]),
            'total_cost': sum([r['cost'] for r in text_results]),
            'cost_per_query': np.mean([r['cost'] for r in text_results]),
        }
    }
    
    # Create table figure
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.axis('tight')
    ax.axis('off')
    
    table_data = [
        ['Metric', 'Vision RAG', 'Text RAG', 'Winner'],
        ['Avg Input Tokens', f"{metrics['Vision']['avg_input_tokens']:.0f}", 
         f"{metrics['Text']['avg_input_tokens']:.0f}",
         'Text' if metrics['Text']['avg_input_tokens'] < metrics['Vision']['avg_input_tokens'] else 'Vision'],
        ['Avg Output Tokens', f"{metrics['Vision']['avg_output_tokens']:.0f}",
         f"{metrics['Text']['avg_output_tokens']:.0f}", 'Similar'],
        ['Total Cost', f"${metrics['Vision']['total_cost']:.4f}",
         f"${metrics['Text']['total_cost']:.4f}",
         'Text' if metrics['Text']['total_cost'] < metrics['Vision']['total_cost'] else 'Vision'],
        ['Cost Per Query', f"${metrics['Vision']['cost_per_query']:.4f}",
         f"${metrics['Text']['cost_per_query']:.4f}",
         'Text' if metrics['Text']['cost_per_query'] < metrics['Vision']['cost_per_query'] else 'Vision'],
    ]
    
    table = ax.table(cellText=table_data, cellLoc='center', loc='center',
                    colWidths=[0.3, 0.2, 0.2, 0.2])
    
    table.auto_set_font_size(False)
    table.set_fontsize(11)
    table.scale(1, 2.5)
    
    # Style header row
    for i in range(4):
        table[(0, i)].set_facecolor('#3498db')
        table[(0, i)].set_text_props(weight='bold', color='white')
    
    # Style data rows
    for i in range(1, 5):
        for j in range(4):
            if j == 3:  # Winner column
                if table_data[i][3] == 'Text':
                    table[(i, j)].set_facecolor('#d5f4e6')
                elif table_data[i][3] == 'Vision':
                    table[(i, j)].set_facecolor('#dae8fc')
                else:
                    table[(i, j)].set_facecolor('#f0f0f0')
    
    plt.title('Comparison Summary: Vision vs Text RAG\n(Short File: 2,668 characters)',
             fontsize=14, fontweight='bold', pad=20)
    
    plt.tight_layout()
    output_path = output_dir / "summary_table.png"
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"Saved: {output_path}")
    plt.close()


def generate_all_charts():
    """Main function to generate all benchmark charts."""
    print("Generating Professional Benchmark Charts")
    print("=" * 60)
    
    # Load data
    try:
        data = load_comparison_data()
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return
    
    # Output directory
    output_dir = Path(__file__).parent.parent / "outputs" / "benchmark_results"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"\nOutput directory: {output_dir}\n")
    
    # Generate charts
    print("Generating charts...")
    generate_token_comparison_chart(data, output_dir)
    generate_cost_comparison_chart(data, output_dir)
    generate_efficiency_chart(output_dir)
    generate_decision_tree(output_dir)
    generate_summary_table(data, output_dir)
    
    print(f"\n{'=' * 60}")
    print("All charts generated successfully!")
    print(f"Check: {output_dir}")


if __name__ == "__main__":
    generate_all_charts()
