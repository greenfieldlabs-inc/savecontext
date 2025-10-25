"""
Real Scale Benchmark
Test vision vs text on actual large files to find the true crossover point.
"""

import json
import time
from pathlib import Path
from code_to_image import code_to_image
from vision_query import query_code_image
from text_rag import query_code_text, chunk_code_file


def benchmark_file(file_path: Path, question: str = "What does this code do? Summarize in 2-3 sentences."):
    """
    Benchmark both approaches on a single file.
    Returns comparison data.
    """
    print(f"\n{'='*80}")
    print(f"Testing: {file_path.name}")
    print(f"{'='*80}")
    
    # Get file stats
    code = file_path.read_text()
    lines = len(code.split('\n'))
    chars = len(code)
    
    print(f"Size: {lines} lines, {chars} characters")
    
    results = {
        'file': str(file_path),
        'lines': lines,
        'characters': chars,
    }
    
    # Test Vision approach
    print(f"\n[1/2] Testing Vision approach...")
    try:
        # Generate image
        image_output = Path(__file__).parent.parent / "outputs" / "temp_test.png"
        start = time.time()
        img = code_to_image(str(file_path), str(image_output))
        image_gen_time = time.time() - start
        
        # Query image
        start = time.time()
        vision_result = query_code_image(str(image_output), question)
        query_time = time.time() - start
        
        results['vision'] = {
            'image_generation_time': image_gen_time,
            'query_time': query_time,
            'total_time': image_gen_time + query_time,
            'tokens': vision_result['tokens'],
            'cost': vision_result['cost'],
        }
        print(f"Vision: {vision_result['tokens']['input']} input tokens, ${vision_result['cost']:.4f}")
        
    except Exception as e:
        print(f"Vision failed: {e}")
        results['vision'] = {'error': str(e)}
    
    # Test Text approach
    print(f"\n[2/2] Testing Text approach...")
    try:
        chunks = chunk_code_file(str(file_path))
        code_text = chunks[0]
        
        start = time.time()
        text_result = query_code_text(code_text, question)
        query_time = time.time() - start
        
        results['text'] = {
            'query_time': query_time,
            'tokens': text_result['tokens'],
            'cost': text_result['cost'],
        }
        print(f"Text: {text_result['tokens']['input']} input tokens, ${text_result['cost']:.4f}")
        
    except Exception as e:
        print(f"Text failed: {e}")
        results['text'] = {'error': str(e)}
    
    # Comparison
    if 'vision' in results and 'text' in results and 'error' not in results['vision'] and 'error' not in results['text']:
        vision_tokens = results['vision']['tokens']['input']
        text_tokens = results['text']['tokens']['input']
        
        if vision_tokens < text_tokens:
            winner = 'Vision'
            savings = ((text_tokens - vision_tokens) / text_tokens) * 100
        else:
            winner = 'Text'
            savings = ((vision_tokens - text_tokens) / vision_tokens) * 100
        
        results['winner'] = winner
        results['token_savings_pct'] = savings
        
        print(f"\nWinner: {winner} ({savings:.1f}% more efficient)")
    
    return results


def run_scale_test():
    """
    Run benchmarks on files of increasing size.
    """
    print("SCALE BENCHMARK: Vision vs Text on Real Files")
    print("="*80)
    
    # Test files at different scales
    fastapi_root = Path(__file__).parent.parent / "test_repos" / "fastapi" / "fastapi"
    
    test_files = [
        # Small (~200 lines)
        fastapi_root / "exceptions.py",  # 177 lines
        
        # Medium (~300 lines) 
        fastapi_root / "encoders.py",  # 352 lines
        
        # At crossover point (~500 lines)
        fastapi_root / "openapi" / "utils.py",  # 558 lines
        
        # Large (~1000 lines)
        fastapi_root / "dependencies" / "utils.py",  # 1052 lines
        
        # Very large (~2000+ lines)
        fastapi_root / "param_functions.py",  # 2361 lines
    ]
    
    # Filter to only existing files
    test_files = [f for f in test_files if f.exists()]
    
    if not test_files:
        print("Error: Test files not found. Make sure FastAPI is cloned.")
        return
    
    print(f"\nTesting {len(test_files)} files at different scales\n")
    
    all_results = []
    
    for i, file_path in enumerate(test_files, 1):
        print(f"\n\nFILE {i}/{len(test_files)}")
        result = benchmark_file(file_path)
        all_results.append(result)
        
        # Brief pause between tests
        time.sleep(2)
    
    # Save results
    output_file = Path(__file__).parent.parent / "outputs" / "scale_benchmark_results.json"
    with open(output_file, 'w') as f:
        json.dump(all_results, f, indent=2)
    
    print(f"\n\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}\n")
    
    print(f"{'File':<35} {'Lines':<8} {'Winner':<10} {'Savings':<10}")
    print("-" * 80)
    
    for r in all_results:
        file_name = Path(r['file']).name
        lines = r['lines']
        winner = r.get('winner', 'Error')
        savings = f"{r.get('token_savings_pct', 0):.1f}%" if 'token_savings_pct' in r else 'N/A'
        print(f"{file_name:<35} {lines:<8} {winner:<10} {savings:<10}")
    
    print(f"\nFull results saved to: {output_file}")


if __name__ == "__main__":
    run_scale_test()
